// api/src/v1/dishes/dishes.service.ts
//
// ❶ Controller から渡される DTO を受け取り Repository・外部API を編成
// ❷ 1 メソッド = 1 ユースケース（トランザクション／ロギング込み）
// ❸ Google Maps API との連携処理
//

import { Injectable } from '@nestjs/common';

import { CreateDishDto, BulkImportDishesDto } from '@shared/v1/dto';
import { CreateDishResponse, BulkImportDishesResponse } from '@shared/v1/res';

import { DishesRepository } from './dishes.repository';
import { AppLoggerService } from '../../core/logger/logger.service';
import { LocationsService } from '../locations/locations.service';
import { RemoteConfigService } from '../../core/remote-config/remote-config.service';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';

// Import converters
import {
  convertPrismaToSupabase_Dishes,
  PrismaDishes,
} from '../../../../shared/converters/convert_dishes';
import {
  convertPrismaToSupabase_Restaurants,
  PrismaRestaurants,
} from '../../../../shared/converters/convert_restaurants';
import {
  convertPrismaToSupabase_DishMedia,
  PrismaDishMedia,
} from '../../../../shared/converters/convert_dish_media';
import {
  convertPrismaToSupabase_DishReviews,
  PrismaDishReviews,
} from '../../../../shared/converters/convert_dish_reviews';
import { CreateDishMediaEntryJobPayload } from '../../internal/dishes/create-dish-media-entry.interface';
import {
  buildFileName,
  buildFullPath,
  getExt,
} from 'src/core/storage/storage.utils';
import { env } from 'src/core/config/env';

@Injectable()
export class DishesService {
  constructor(
    private readonly repo: DishesRepository,
    private readonly logger: AppLoggerService,
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

    const contextualContents = googlePlaces?.contextualContents;
    if (!googlePlaces || !googlePlaces?.places || !contextualContents) {
      throw new Error('No places found from Google Maps API');
    }

    const results: BulkImportDishesResponse = [];

    // 各レストランに対してデータ登録処理（並列処理）
    const processPromises = googlePlaces.places.map(async (place, index) => {
      try {
        const contextualContent = contextualContents[index];
        const photoName = contextualContent.photos?.[0]?.name;
        if (
          !place.id ||
          !place.displayName?.text ||
          !place.location?.latitude ||
          !place.location?.longitude ||
          !contextualContent.reviews ||
          !photoName
        )
          throw new Error(`Invalid place data: ${JSON.stringify(place)}`);

        // PhotoMediaUri のみ取得（バイナリ取得は行わない）
        const photoMedia = await this.locationsService.getPhotoMedia(photoName);
        if (!photoMedia)
          throw new Error(`No photo URL found for place: ${place.id}`);

        const ext = getExt('image/jpeg');
        const mediaFileName = buildFileName(place.id, ext);
        const mediaPath = buildFullPath({
          env: env.API_NODE_ENV,
          resourceType: 'google-maps',
          usageType: 'photo',
          finalFileName: mediaFileName,
        });

        const restaurant: PrismaRestaurants = {
          id: 'unknown',
          google_place_id: place.id,
          name: place.displayName.text,
          latitude: place.location!.latitude,
          longitude: place.location!.longitude,
          image_url: photoMedia.photoUri,
          created_at: new Date(),
        };

        const dish: PrismaDishes = {
          id: 'unknown',
          restaurant_id: restaurant.id,
          category_id: dto.categoryId,
          name: dto.categoryName,
          created_at: new Date(),
          updated_at: new Date(),
          lock_no: 0,
        };

        const dishMedia: PrismaDishMedia = {
          id: 'unknown',
          dish_id: dish.id,
          user_id: null, // Google からのインポートなので null
          media_path: mediaPath,
          media_type: 'image',
          thumbnail_path: mediaPath,
          created_at: new Date(),
          updated_at: new Date(),
          lock_no: 0,
        };

        const dishReviews: PrismaDishReviews[] = contextualContent.reviews.map(
          (review) => ({
            id: 'unknown',
            dish_id: dish.id,
            user_id: null, // Google からのインポートなので null
            comment: review.originalText?.text || '',
            original_language_code: review.originalText?.languageCode || '',
            rating: review.rating || 0,
            price_cents: null,
            currency_code: null,
            created_dish_media_id: dishMedia.id,
            imported_user_name: review.authorAttribution?.displayName || null,
            imported_user_avatar: review.authorAttribution?.photoUri || null,
            created_at: new Date(),
          }),
        );

        // 非同期ジョブ用のペイロード作成
        const jobId = `dish-create-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const idempotencyKey = `${restaurant.google_place_id}-${dish.id}-${Date.now()}`;

        const jobPayload: CreateDishMediaEntryJobPayload = {
          jobId,
          idempotencyKey,
          photoUri: [photoMedia.photoUri],
          restaurants: convertPrismaToSupabase_Restaurants(restaurant),
          dishes: convertPrismaToSupabase_Dishes(dish),
          dish_media: convertPrismaToSupabase_DishMedia(dishMedia),
          dish_reviews: dishReviews.map((r) => ({
            ...convertPrismaToSupabase_DishReviews(r),
          })),
        };

        // 非同期ジョブをキューに投入（写真の実体取得・保存のため）
        try {
          await this.cloudTasksService.enqueueCreateDishMediaEntry(jobPayload);
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
            ...convertPrismaToSupabase_DishMedia(dishMedia),
            mediaImageUrl: photoMedia.photoUri,
            thumbnailImageUrl: photoMedia.photoUri,
            isSaved: false, // 初期状態では保存されていない
            isLiked: false, // 初期状態ではいいねされていない
            likeCount: 0, // 初期状態ではいいね数は0
          },
          dish_reviews: dishReviews.map((r) => ({
            ...convertPrismaToSupabase_DishReviews(r),
            username: r.imported_user_name || 'Anonymous', // ユーザー名がない場合は 'Anonymous' とする
            isLiked: false, // 初期状態ではいいねされていない
            likeCount: 0, // 初期状態ではいいね数は 0
          })),
        };
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
