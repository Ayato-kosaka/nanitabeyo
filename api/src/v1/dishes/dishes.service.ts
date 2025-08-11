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

// Import job payload interface
import { 
  BulkImportJobPayload,
} from '../../internal/bulk-import/bulk-import-job.interface';

@Injectable()
export class DishesService {
  constructor(
    private readonly repo: DishesRepository,
    private readonly prisma: PrismaService,
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

    if (
      !googlePlaces ||
      !googlePlaces?.places ||
      !googlePlaces?.contextualContents
    ) {
      throw new Error('No places found from Google Maps API');
    }

    // 同期処理: 写真プレビューURL生成のみ（軽量レスポンス）
    const previewResults: BulkImportDishesResponse = [];

    // 各レストランに対してプレビューデータ生成（並列処理）
    const processPromises = googlePlaces.places.map(async (place, index) => {
      try {
        if (!place.id)
          throw new Error(`Place ID is missing for place at index ${index}`);
        
        const photoName =
          googlePlaces.contextualContents?.[index]?.photos?.[0]?.name;
        if (!photoName)
          throw new Error(`No photo name found for place: ${place.id}`);

        // PhotoMediaUri のみ取得（バイナリ取得は行わない）
        const photoMedia = await this.locationsService.getPhotoMedia(photoName);
        if (!photoMedia)
          throw new Error(`No photo URL found for place: ${place.id}`);

        // プレビュー用の軽量レスポンス作成（実際のDBデータではなく、表示用の仮データ）
        return {
          restaurant: {
            id: place.id, // プレビュー用の仮ID
            google_place_id: place.id,
            name: place.displayName?.text || 'Unknown Restaurant',
            latitude: place.location?.latitude || 0,
            longitude: place.location?.longitude || 0,
            image_url: photoMedia.photoUri,
          },
          dish: {
            id: `${place.id}-${dto.categoryId}`, // プレビュー用の仮ID
            restaurant_id: place.id,
            category_id: dto.categoryId,
            name: dto.categoryName,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          dish_media: {
            id: `${place.id}-${dto.categoryId}-media`, // プレビュー用の仮ID
            dish_id: `${place.id}-${dto.categoryId}`,
            media_url: photoMedia.photoUri,
            media_type: 'photo',
            mediaImageUrl: photoMedia.photoUri,
            thumbnailImageUrl: photoMedia.photoUri,
            isSaved: false,
            isLiked: false,
            likeCount: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          dish_reviews: (place.reviews || []).map((review, reviewIndex) => ({
            id: `${place.id}-${dto.categoryId}-review-${reviewIndex}`, // プレビュー用の仮ID
            dish_media_id: `${place.id}-${dto.categoryId}-media`,
            rating: review.rating || 0,
            text: review.text?.text || null,
            username: review.authorAttribution?.displayName || 'Anonymous',
            imported_user_name: review.authorAttribution?.displayName || 'Anonymous',
            author_url: review.authorAttribution?.uri || null,
            profile_photo_url: review.authorAttribution?.photoUri || null,
            relative_time_description: review.relativePublishTimeDescription || null,
            time: this.parseTimestamp(review.publishTime) || 0,
            original_language_code: review.originalText?.languageCode || dto.languageCode,
            isLiked: false,
            likeCount: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })),
        };
      } catch (error) {
        this.logger.error('BulkImportPlaceError', 'bulkImportFromGoogle', {
          placeId: place.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return null;
      }
    });

    // 並列処理を実行
    const processResults = await Promise.allSettled(processPromises);

    // 成功した結果のみを抽出
    const results = processResults
      .filter(
        (result): result is PromiseFulfilledResult<any> =>
          result.status === 'fulfilled' && result.value !== null,
      )
      .map((result) => result.value);

    // 非同期ジョブをCloud Tasksに投入（Google Places APIの生データをそのまま渡す）
    if (results.length > 0) {
      const jobId = `bulk-import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const idempotencyKey = `${dto.location}-${dto.categoryId}-${Date.now()}`;
      
      const jobPayload: BulkImportJobPayload = {
        jobId,
        idempotencyKey,
        places: googlePlaces.places,
        contextualContents: googlePlaces.contextualContents,
        categoryId: dto.categoryId,
        categoryName: dto.categoryName,
        languageCode: dto.languageCode,
      };

      try {
        await this.cloudTasksService.enqueueBulkImportJob(jobPayload);
        
        this.logger.log('BulkImportJobEnqueued', 'bulkImportFromGoogle', {
          jobId,
          idempotencyKey,
          placesCount: googlePlaces.places.length,
        });
      } catch (error) {
        this.logger.error('BulkImportJobEnqueueError', 'bulkImportFromGoogle', {
          jobId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // エンキューエラーでも同期レスポンスは返す
      }
    }

    this.logger.log('BulkImportSyncCompleted', 'bulkImportFromGoogle', {
      previewResultsCount: results.length,
      totalPlaces: googlePlaces.places?.length,
    });

    return results;
  }

  /**
   * タイムスタンプを数値に変換
   */
  private parseTimestamp(timestamp: any): number {
    if (!timestamp) return 0;

    // ITimestamp オブジェクトの場合
    if (typeof timestamp === 'object' && timestamp.seconds) {
      return Number(timestamp.seconds);
    }

    // 文字列の場合
    if (typeof timestamp === 'string') {
      return Math.floor(Date.parse(timestamp) / 1000) || 0;
    }

    // 数値の場合
    if (typeof timestamp === 'number') {
      return timestamp;
    }

    return 0;
  }
}
