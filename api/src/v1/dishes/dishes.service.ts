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
import { randomUUID } from 'node:crypto';
import { log } from 'node:console';

// Google Maps types for photo handling
import { google } from '@googlemaps/places/build/protos/protos';

interface PhotoCandidate {
  name?: string | null;
  widthPx?: number | null;
  heightPx?: number | null;
}

@Injectable()
export class DishesService {
  constructor(
    private readonly repo: DishesRepository,
    private readonly logger: AppLoggerService,
    private readonly locationsService: LocationsService,
    private readonly remoteConfigService: RemoteConfigService,
    private readonly cloudTasksService: CloudTasksService,
  ) {}

  /**
   * 写真候補を選択する優先順位ロジック
   */
  private selectBestPhoto(photos: PhotoCandidate[]): PhotoCandidate | null {
    if (!photos || photos.length === 0) {
      return null;
    }

    // フィルタリングとソート
    const validPhotos = photos.filter(
      (photo) => photo.name && photo.widthPx && photo.heightPx,
    );

    if (validPhotos.length === 0) {
      // フォールバック: 名前のある最初の写真を使用
      return photos.find((photo) => photo.name) || null;
    }

    // 優先順位ロジック
    const sortedPhotos = validPhotos.sort((a, b) => {
      // ① widthPx > 600 を満たすものを優先
      const aWideEnough = (a.widthPx || 0) > 600;
      const bWideEnough = (b.widthPx || 0) > 600;

      if (aWideEnough && !bWideEnough) return -1;
      if (!aWideEnough && bWideEnough) return 1;

      // ② アスペクト比が 9:16 に近いもの（差の小さい順）
      const targetRatio = 9 / 16;
      const aRatio = (a.widthPx || 1) / (a.heightPx || 1);
      const bRatio = (b.widthPx || 1) / (b.heightPx || 1);
      const aDiff = Math.abs(aRatio - targetRatio);
      const bDiff = Math.abs(bRatio - targetRatio);

      if (Math.abs(aDiff - bDiff) > 0.01) {
        return aDiff - bDiff;
      }

      // ③ widthPx の大きい順
      return (b.widthPx || 0) - (a.widthPx || 0);
    });

    return sortedPhotos[0] || validPhotos[0];
  }

  /**
   * 複数の写真候補から成功するまで順次試行
   */
  private async tryGetPhotoMedia(
    photos: PhotoCandidate[],
  ): Promise<{ photoUri: string } | null> {
    if (!photos || photos.length === 0) {
      return null;
    }

    // 優先順位に基づいて写真を選択・ソート
    const allCandidates = [...photos];
    const bestPhoto = this.selectBestPhoto(allCandidates);

    if (bestPhoto) {
      // ベスト写真を最初に移動
      const otherPhotos = allCandidates.filter(
        (p) => p.name !== bestPhoto.name,
      );
      allCandidates.splice(0, allCandidates.length, bestPhoto, ...otherPhotos);
    }

    // 順次試行
    for (const photo of allCandidates) {
      if (!photo.name) continue;

      try {
        const result = await this.locationsService.getPhotoMedia(
          photo.name,
          photo.widthPx || undefined,
          photo.heightPx || undefined,
        );

        if (result) {
          this.logger.debug('PhotoMediaSuccess', 'tryGetPhotoMedia', {
            photoName: photo.name,
            widthPx: photo.widthPx,
            heightPx: photo.heightPx,
          });
          return result;
        }
      } catch (error) {
        this.logger.warn('PhotoMediaFallback', 'tryGetPhotoMedia', {
          photoName: photo.name,
          widthPx: photo.widthPx,
          heightPx: photo.heightPx,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // 次の候補を試行
        continue;
      }
    }

    return null;
  }

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
        if (
          !place.id ||
          !place.displayName?.text ||
          !place.location?.latitude ||
          !place.location?.longitude
        )
          throw new Error(`Invalid place data: ${JSON.stringify(place)}`);

        const reviews = contextualContent.reviews || [];
        const photos = contextualContent.photos || [];

        if (!photos || photos.length === 0) {
          this.logger.warn('NoPhotoForPlace', 'bulkImportFromGoogle', {
            placeId: place.id,
          });
          return null; // 写真がない場合はスキップ
        }

        // PhotoMediaUri を複数候補から取得（バイナリ取得は行わない）
        const photoMedia = await this.tryGetPhotoMedia(photos);
        if (!photoMedia) {
          throw new Error(`No photo URL found for place: ${place.id}`);
        }

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
          name_language_code: dto.languageCode,
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
          id: randomUUID(),
          dish_id: dish.id,
          user_id: null, // Google からのインポートなので null
          media_path: mediaPath,
          media_type: 'image',
          thumbnail_path: mediaPath,
          created_at: new Date(),
          updated_at: new Date(),
          lock_no: 0,
        };

        const dishReviews: PrismaDishReviews[] = reviews.map((review) => ({
          id: randomUUID(),
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
        }));

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
