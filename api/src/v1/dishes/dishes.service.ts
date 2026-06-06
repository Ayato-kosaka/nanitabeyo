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
import { DishCategoriesRepository } from '../dish-categories/dish-categories.repository';
import { RestaurantsRepository } from '../restaurants/restaurants.repository';
import { PrismaService } from '../../prisma/prisma.service';

// Import converters
import {
  convertPrismaToSupabase_Dishes,
  PrismaDishes,
  SupabaseDishes,
} from '../../../../shared/converters/convert_dishes';
import { SupabaseRestaurants } from '../../../../shared/converters/convert_restaurants';
import { SupabaseDishMedia } from '../../../../shared/converters/convert_dish_media';
import { SupabaseDishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { CreateDishMediaEntryJobPayload } from '../../internal/dishes/create-dish-media-entry.interface';
import {
  buildFileName,
  buildFullPath,
  getExt,
} from 'src/core/storage/storage.utils';
import { randomUUID } from 'node:crypto';

// Google Maps types for photo handling
import { protos } from '@googlemaps/places';

@Injectable()
export class DishesService {
  constructor(
    private readonly repo: DishesRepository,
    private readonly logger: AppLoggerService,
    private readonly locationsService: LocationsService,
    private readonly remoteConfigService: RemoteConfigService,
    private readonly cloudTasksService: CloudTasksService,
    private readonly dishCategoriesRepository: DishCategoriesRepository,
    private readonly restaurantsRepository: RestaurantsRepository,
    private readonly prisma: PrismaService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                     POST /v1/dishes (作成 or 取得)                 */
  /* ------------------------------------------------------------------ */
  async createOrGetDish(dto: CreateDishDto): Promise<CreateDishResponse> {
    this.logger.debug('CreateOrGetDish', 'createOrGetDish', dto);

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

    // DishCategory と Restaurant を取得し、ローカル言語を推測して dishName を決定
    const dishCategory =
      await this.dishCategoriesRepository.findDishCategoryById(
        dto.dishCategoryId,
      );
    if (!dishCategory) {
      this.logger.error('DishCategoryNotFound', 'createOrGetDish', {
        dishCategoryId: dto.dishCategoryId,
      });
      throw new Error('Dish category not found');
    }

    const restaurant = await this.prisma.prisma.$transaction(async (tx) => {
      return this.restaurantsRepository.findRestaurantById(
        tx,
        dto.restaurantId,
      );
    });
    if (!restaurant) {
      this.logger.error('RestaurantNotFound', 'createOrGetDish', {
        restaurantId: dto.restaurantId,
      });
      throw new Error('Restaurant not found');
    }

    // レストランの住所情報からローカル言語コードを推測
    const languageCode = this.locationsService.resolveLocalLanguageCode(
      restaurant.address_components as protos.google.maps.places.v1.Place.IAddressComponent[],
    );

    const dishNameFromLabels: string =
      (dishCategory.labels && dishCategory.labels[languageCode]) ||
      dishCategory.label_en;

    // 新規作成（推測名を注入。なければフォールバック）
    const newDish = await this.prisma.prisma.$transaction(async (tx) => {
      return this.repo.createOrGetDishForCategory(tx, {
        restaurant_id: dto.restaurantId,
        category_id: dto.dishCategoryId,
        name: dishNameFromLabels,
      });
    });

    this.logger.log('DishCreated', 'createOrGetDish', newDish);

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
      priceLevels: dto.priceLevels, // Now optional, can be undefined
      pageSize,
    });

    // #636 【バグ】contextualContents は experimental で返却保証が弱いため、places のみ必須とする
    if (!googlePlaces || !googlePlaces?.places) {
      throw new Error('No places found from Google Maps API');
    }

    const contextualContents = googlePlaces?.contextualContents;

    // #636 【設計】contextualContents と places の長さが一致しない場合は警告ログを出す
    const canUseContextual =
      !!contextualContents &&
      contextualContents.length === googlePlaces.places.length;
    if (contextualContents && !canUseContextual) {
      this.logger.warn(
        'ContextualContentsLengthMismatch',
        'bulkImportFromGoogle',
        {
          placesLength: googlePlaces.places.length,
          contextualContentsLength: contextualContents.length,
        },
      );
    } else if (!contextualContents) {
      this.logger.debug('ContextualContentsMissing', 'bulkImportFromGoogle', {
        placesLength: googlePlaces.places.length,
      });
    }

    const results: BulkImportDishesResponse = [];

    // 各レストランに対してデータ登録処理（並列処理）
    const processPromises = googlePlaces.places.map(async (place, index) => {
      try {
        const contextualContent = canUseContextual
          ? contextualContents[index]
          : undefined;

        // #636 【設計】photos: contextualContents.photos を優先、なければ place.photos にフォールバック
        const photos =
          contextualContent?.photos && contextualContent.photos.length > 0
            ? contextualContent.photos
            : place.photos || [];

        // #636 【設計】reviews: contextualContents.reviews を優先、なければ place.reviews にフォールバック
        const reviews =
          contextualContent?.reviews && contextualContent.reviews.length > 0
            ? contextualContent.reviews
            : place.reviews || [];

        // #636 【設計】フォールバック発生時のモニタリングログ（どちらを使ったか記録）
        if (
          (!contextualContent?.reviews ||
            contextualContent.reviews.length === 0) &&
          place.reviews &&
          place.reviews.length > 0
        ) {
          this.logger.log(
            'ContextualReviewsMissingFallbackToPlaceReviews',
            'bulkImportFromGoogle',
            {
              placeId: place.id || 'unknown',
              dishCategoryName: dto.categoryName,
              contextualReviewsCount: contextualContent?.reviews?.length || 0,
              placeReviewsCount: place.reviews.length,
            },
          );
        }

        if (
          (!contextualContent?.photos ||
            contextualContent.photos.length === 0) &&
          place.photos &&
          place.photos.length > 0
        ) {
          this.logger.warn(
            'ContextualPhotosMissingFallbackToPlacePhotos',
            'bulkImportFromGoogle',
            {
              placeId: place.id || 'unknown',
              dishCategoryName: dto.categoryName,
              contextualPhotosCount: contextualContent?.photos?.length || 0,
              placePhotosCount: place.photos.length,
            },
          );
        }

        // Check required fields with proper validation for latitude/longitude
        const missingFields: string[] = [];
        if (!place.id) missingFields.push('id');
        if (!place.displayName?.text) missingFields.push('displayName.text');
        if (typeof place.location?.latitude !== 'number')
          missingFields.push('location.latitude');
        if (typeof place.location?.longitude !== 'number')
          missingFields.push('location.longitude');
        if (!place.addressComponents) missingFields.push('addressComponents');

        if (missingFields.length > 0) {
          this.logger.error('InvalidPlaceData', 'bulkImportFromGoogle', {
            placeId: place.id || 'unknown',
            missingFields,
            place: JSON.stringify(place),
          });
          throw new Error(
            `Invalid place data - missing fields: ${missingFields.join(', ')}`,
          );
        }

        if (!photos || photos.length === 0) {
          this.logger.warn('NoPhotoForPlace', 'bulkImportFromGoogle', {
            placeId: place.id!,
          });
          return null; // 写真がない場合はスキップ
        }

        // PhotoMediaUri を複数候補から取得（バイナリ取得は行わない）
        const photoMedia = await this.locationsService.tryGetPhotoMedia(photos);
        if (!photoMedia) {
          throw new Error(`No photo URL found for place: ${place.id!}`);
        }

        const ext = getExt('image/jpeg');
        const mediaFileName = buildFileName(place.id!, ext);
        const mediaPath = buildFullPath({
          resourceType: 'google-maps',
          usageType: 'photo',
          finalFileName: mediaFileName,
        });

        const restaurant: SupabaseRestaurants = {
          id: 'unknown',
          google_place_id: place.id!,
          name: place.displayName!.text!,
          name_language_code: dto.languageCode,
          latitude: place.location!.latitude!,
          longitude: place.location!.longitude!,
          location: null,
          image_url: photoMedia.photoUri,
          image_path: mediaPath,
          address_components: JSON.parse(
            JSON.stringify(place.addressComponents),
          ),
          plus_code: place.plusCode
            ? JSON.parse(JSON.stringify(place.plusCode))
            : null,
          created_at: new Date().toISOString(),
        };

        const dish: SupabaseDishes = {
          id: 'unknown',
          restaurant_id: restaurant.id,
          category_id: dto.categoryId,
          name: dto.categoryName,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          lock_no: 0,
        };

        const dishMedia: SupabaseDishMedia = {
          id: randomUUID(),
          dish_id: dish.id,
          user_id: null, // Google からのインポートなので null
          media_path: mediaPath,
          media_type: 'image',
          thumbnail_path: mediaPath,
          video_duration_ms: null,
          media_processing_status: 'processing', // #511 【設計】後続のジョブでリサイズ処理を行う
          thumbnail_processing_status: 'processing',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          lock_no: 0,
        };

        const dishReviews: SupabaseDishReviews[] = reviews.map((review) => ({
          id: randomUUID(),
          dish_id: dish.id,
          user_id: null, // Google からのインポートなので null
          // 【設計】Google Places の originalText は投稿者が書いた元言語の本文。
          // dish_reviews.comment には翻訳済み text ではなく元本文を保存し、
          // original_language_code にはその元本文の言語を保存する。
          // UGC 投稿保存に揃える方針。
          comment: review.originalText?.text || '',
          comment_tsv: null,
          original_language_code: review.originalText?.languageCode || '',
          rating: review.rating || 0,
          price_cents: null,
          currency_code: null,
          created_dish_media_id: dishMedia.id,
          imported_user_name: review.authorAttribution?.displayName || null,
          imported_user_avatar: review.authorAttribution?.photoUri || null,
          created_at: new Date().toISOString(),
        }));

        // 非同期ジョブをキューに投入
        await this.enqueueCreateDishMediaEntryJob({
          restaurant,
          dish,
          dishMedia,
          dishReviews,
          placeId: place.id!,
          photoUri: photoMedia.photoUri,
        });

        const BulkImportDishesResponseEntry: BulkImportDishesResponse[0] = {
          restaurant: {
            ...restaurant,
            imageUrls: {
              sm: photoMedia.photoUri,
              md: photoMedia.photoUri,
            },
          },
          dish: {
            ...dish,
            reviewCount: dishReviews.length,
            averageRating:
              dishReviews.length > 0
                ? dishReviews.reduce((sum, r) => sum + r.rating, 0) /
                  dishReviews.length
                : 0,
          },
          dish_media: {
            ...dishMedia,
            media_processing_status: 'completed', // クライアント側には処理済みの画像を返す
            thumbnail_processing_status: 'completed',
            mediaUrl: photoMedia.photoUri,
            thumbnailImageUrl: photoMedia.photoUri,
            isMine: false, // インポートなので自分のものではない
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
        return BulkImportDishesResponseEntry;
      } catch (error) {
        this.logger.error('BulkImportPlaceError', 'bulkImportFromGoogle', {
          placeId: place.id || 'unknown',
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

  /**
   * 非同期ジョブをキューに投入
   */
  private async enqueueCreateDishMediaEntryJob({
    restaurant,
    dish,
    dishMedia,
    dishReviews,
    placeId,
    photoUri,
  }: {
    restaurant: SupabaseRestaurants;
    dish: SupabaseDishes;
    dishMedia: SupabaseDishMedia;
    dishReviews: SupabaseDishReviews[];
    placeId: string;
    photoUri: string;
  }) {
    // 非同期ジョブ用のペイロード作成
    const jobId = `dish-create-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const idempotencyKey = `${placeId}-${dish.category_id}`;

    const jobPayload: CreateDishMediaEntryJobPayload = {
      jobId,
      idempotencyKey,
      photoUri: [photoUri],
      restaurants: restaurant,
      dishes: dish,
      dish_media: dishMedia,
      dish_reviews: dishReviews,
    };

    // 非同期ジョブをキューに投入（写真の実体取得・保存のため）
    try {
      this.cloudTasksService.enqueueCreateDishMediaEntry(jobPayload).then(() =>
        this.logger.debug('AsyncJobEnqueued', 'bulkImportFromGoogle', {
          jobId,
          placeId,
        }),
      );
    } catch (error) {
      this.logger.error('AsyncJobEnqueueError', 'bulkImportFromGoogle', {
        jobId,
        placeId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // エンキューエラーでも同期レスポンスは継続
    }
  }
}
