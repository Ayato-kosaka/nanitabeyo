// api/src/v1/dishes/dishes.service.ts
//
// ❶ Controller から渡される DTO を受け取り Repository・外部API を編成
// ❷ 1 メソッド = 1 ユースケース（トランザクション／ロギング込み）
// ❸ Google Maps API との連携処理
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';

import { CreateDishDto, BulkImportDishesDto } from '@shared/v1/dto';
import { CreateDishResponse, BulkImportDishesResponse } from '@shared/v1/res';

import { DishesRepository } from './dishes.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { LocationsService } from '../locations/locations.service';
import { RemoteConfigService } from '../../core/remote-config/remote-config.service';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';

// Import converters
import { convertPrismaToSupabase_Dishes } from '../../../../shared/converters/convert_dishes';
import { convertPrismaToSupabase_Restaurants } from '../../../../shared/converters/convert_restaurants';
import { convertPrismaToSupabase_DishMedia } from '../../../../shared/converters/convert_dish_media';
import {
  convertPrismaToSupabase_DishReviews,
  SupabaseDishReviews,
} from '../../../../shared/converters/convert_dish_reviews';
import { StorageService } from 'src/core/storage/storage.service';

// Import job payload interface
import { BulkImportJobPayload } from '../../internal/dishes/bulk-import-job.interface';

@Injectable()
export class DishesService {
  constructor(
    private readonly repo: DishesRepository,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly storage: StorageService,
    private readonly locationsService: LocationsService,
    private readonly remoteConfigService: RemoteConfigService,
    private readonly cloudTasksService: CloudTasksService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                     POST /v1/dishes (作成 or 取得)                 */
  /* ------------------------------------------------------------------ */
  async createOrGetDish(dto: CreateDishDto): Promise<CreateDishResponse> {
    this.logger.debug('CreateOrGetDish', 'createOrGetDish', {
      restaurantId: dto.restaurantId,
      dishCategoryId: dto.dishCategoryId,
    });

    // 既存のdishを検索
    const existingDish = await this.repo.findDishByRestaurantAndCategory(
      dto.restaurantId,
      dto.dishCategoryId,
    );

    if (existingDish) {
      this.logger.debug('ExistingDishFound', 'createOrGetDish', {
        dishId: existingDish.id,
      });
      return convertPrismaToSupabase_Dishes(existingDish);
    }

    // 新規作成
    const newDish = await this.repo.createDish(dto);

    this.logger.log('DishCreated', 'createOrGetDish', {
      dishId: newDish.id,
      restaurantId: dto.restaurantId,
      categoryId: dto.dishCategoryId,
    });

    return convertPrismaToSupabase_Dishes(newDish);
  }

  /* ------------------------------------------------------------------ */
  /*              POST /v1/dishes/bulk-import (Google一括登録)            */
  /* ------------------------------------------------------------------ */
  async bulkImportFromGoogle(
    dto: BulkImportDishesDto,
  ): Promise<BulkImportDishesResponse> {
    this.logger.debug('BulkImportFromGoogle', 'bulkImportFromGoogle', dto);

    // Remote Config から検索件数設定を取得
    const restaurantSearchCount =
      await this.remoteConfigService.getRemoteConfigValue(
        'v1_search_result_restaurants_number',
      );
    const pageSize = parseInt(restaurantSearchCount, 10) || 5; // デフォルト値

    // Google Maps Text Search API を呼び出し
    const googlePlaces = await this.locationsService.searchRestaurants({
      location: dto.location,
      radius: dto.radius,
      dishCategoryName: dto.categoryName,
      minRating: dto.minRating,
      languageCode: dto.languageCode,
      priceLevels: dto.priceLevels,
      pageSize,
    });

    if (
      !googlePlaces ||
      !googlePlaces?.places ||
      !googlePlaces?.contextualContents
    ) {
      throw new Error('No places found from Google Maps API');
    }

    const results: BulkImportDishesResponse = [];

    // 各レストランに対してデータ登録処理（並列処理）
    const processPromises = googlePlaces.places.map(async (place, index) => {
      try {
        if (!place.id)
          throw new Error(`Place ID is missing for place at index ${index}`);
        const photoName =
          googlePlaces.contextualContents[index]?.photos?.[0]?.name;
        if (!photoName)
          throw new Error(`No photo name found for place: ${place.id}`);

        // PhotoMediaUri のみ取得（バイナリ取得は行わない）
        const photoMedia = await this.locationsService.getPhotoMedia(photoName);
        if (!photoMedia)
          throw new Error(`No photo URL found for place: ${place.id}`);

        // 同期処理: データベース登録（ストレージアップロードは除外）
        const result = await this.prisma.withTransaction(
          async (tx: Prisma.TransactionClient) => {
            // 1. レストラン登録/取得（update: {} で既存データを保持）
            const restaurant = await this.repo.createOrGetRestaurant(
              tx,
              place,
              photoMedia.photoUri,
            );

            // 2. 料理登録/取得
            const dish = await this.repo.createOrGetDishForCategory(
              tx,
              restaurant.id,
              dto.categoryId,
              dto.categoryName,
            );

            // 3. 料理メディア登録（photoUriのみ、ストレージアップロード無し）
            const dishMediaRecord = await this.repo.createDishMedia(
              tx,
              dish.id,
              photoMedia.photoUri, // photoUri を直接使用
            );
            const dishMedia =
              convertPrismaToSupabase_DishMedia(dishMediaRecord);

            // 4. レビュー登録（Google レビューがある場合）
            const dishReviews: SupabaseDishReviews[] = [];
            if (place.reviews && place.reviews.length > 0) {
              for (const review of place.reviews) {
                const dishReviewRecord = await this.repo.createDishReview(
                  tx,
                  dish.id,
                  dishMediaRecord.id,
                  review,
                );
                dishReviews.push(
                  convertPrismaToSupabase_DishReviews(dishReviewRecord),
                );
              }
            }

            // 非同期ジョブ用のペイロード作成
            const jobId = `dish-import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const idempotencyKey = `${restaurant.google_place_id}-${dish.id}-${Date.now()}`;

            const jobPayload: BulkImportJobPayload = {
              jobId,
              idempotencyKey,
              photoUri: [photoMedia.photoUri],
              restaurants: convertPrismaToSupabase_Restaurants(restaurant),
              dishes: convertPrismaToSupabase_Dishes(dish),
              dish_media: dishMedia,
              dish_reviews: dishReviews,
            };

            // 非同期ジョブをキューに投入（写真の実体取得・保存のため）
            try {
              await this.cloudTasksService.enqueueBulkImportJob(jobPayload, 'dish-que');
              this.logger.debug('AsyncJobEnqueued', 'bulkImportFromGoogle', {
                jobId,
                placeId: place.id,
              });
            } catch (error) {
              this.logger.error('AsyncJobEnqueueError', 'bulkImportFromGoogle', {
                jobId,
                placeId: place.id,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
              // エンキューエラーでも同期レスポンスは継続
            }

            return {
              restaurant: convertPrismaToSupabase_Restaurants(restaurant),
              dish: convertPrismaToSupabase_Dishes(dish),
              dish_media: {
                ...dishMedia,
                mediaImageUrl: photoMedia.photoUri,
                thumbnailImageUrl: photoMedia.photoUri,
                isSaved: false, // 初期状態では保存されていない
                isLiked: false, // 初期状態ではいいねされていない
                likeCount: 0, // 初期状態ではいいね数は0
              },
              dish_reviews: dishReviews.map((r) => ({
                ...r,
                username: r.imported_user_name || 'Anonymous', // ユーザー名がない場合は 'Anonymous' とする
                isLiked: false, // 初期状態ではいいねされていない
                likeCount: 0, // 初期状態ではいいね数は 0
              })),
            };
          },
        );

        return result;
      } catch (error) {
        this.logger.error('BulkImportPlaceError', 'bulkImportFromGoogle', {
          placeId: place.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // 1つのレストランでエラーが起きても処理を続行
        return null;
      }
    });

    // 並列処理を実行
    const processResults = await Promise.allSettled(processPromises);
    
    // 成功した結果のみを抽出
    const successfulResults = processResults
      .filter(
        (result): result is PromiseFulfilledResult<any> =>
          result.status === 'fulfilled' && result.value !== null,
      )
      .map((result) => result.value);

    results.push(...successfulResults);

    this.logger.log('BulkImportCompleted', 'bulkImportFromGoogle', {
      importedCount: results.length,
      totalPlaces: googlePlaces.places?.length,
    });

    return results;
  }
}
