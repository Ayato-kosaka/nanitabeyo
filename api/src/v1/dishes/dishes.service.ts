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

// Import converters
import { convertPrismaToSupabase_Dishes } from '../../../../shared/converters/convert_dishes';
import { convertPrismaToSupabase_Restaurants } from '../../../../shared/converters/convert_restaurants';
import { convertPrismaToSupabase_DishMedia } from '../../../../shared/converters/convert_dish_media';
import {
  convertPrismaToSupabase_DishReviews,
  SupabaseDishReviews,
} from '../../../../shared/converters/convert_dish_reviews';
import { StorageService } from 'src/core/storage/storage.service';

@Injectable()
export class DishesService {
  constructor(
    private readonly repo: DishesRepository,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly storage: StorageService,
    private readonly locationsService: LocationsService,
  ) { }

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

    // Google Maps Text Search API を呼び出し
    const googlePlaces = await this.locationsService.searchRestaurants(
      dto.location,
      dto.radius,
      dto.categoryName,
    );

    if (
      !googlePlaces ||
      !googlePlaces?.places ||
      !googlePlaces?.contextualContents
    ) {
      throw new Error('No places found from Google Maps API');
    }

    const results: BulkImportDishesResponse = [];

    // 各レストランに対してデータ登録
    for (const [index, place] of googlePlaces.places.entries()) {
      try {
        if (!place.id)
          throw new Error(`Place ID is missing for place at index ${index}`);
        const photoName =
          googlePlaces.contextualContents[index]?.photos?.[0]?.name;
        if (!photoName)
          throw new Error(`No photo name found for place: ${place.id}`);
        const photoMedia = await this.locationsService.getPhotoMedia(photoName);
        if (!photoMedia)
          throw new Error(`No photo URL found for place: ${place.id}`);

        const dishMediaUpload = await this.storage.uploadFile({
          buffer: photoMedia.buffer,
          mimeType: 'image/jpeg', // Assuming JPEG, adjust if necessary
          resourceType: 'google-maps',
          usageType: 'photo',
          identifier: place.id,
        });

        const result = await this.prisma.withTransaction(
          async (tx: Prisma.TransactionClient) => {
            // 1. レストラン登録/取得
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

            // 3. 料理メディア登録
            const dishMediaRecord = await this.repo.createDishMedia(
              tx,
              dish.id,
              dishMediaUpload.path,
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

        results.push(result);
      } catch (error) {
        this.logger.error('BulkImportPlaceError', 'bulkImportFromGoogle', {
          placeId: place.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // 1つのレストランでエラーが起きても処理を続行
      }
    }

    this.logger.log('BulkImportCompleted', 'bulkImportFromGoogle', {
      importedCount: results.length,
      totalPlaces: googlePlaces.places?.length,
    });

    return results;
  }
}
