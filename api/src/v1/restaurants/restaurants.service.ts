// api/src/v1/restaurants/restaurants.service.ts
//
// ❶ Service for restaurants domain - business logic
// ❷ Following the pattern from dish-media/dish-media.service.ts
// ❸ Handles Google Place API integration, restaurant creation/search, dish media queries

import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { ExternalApiService } from '../../core/external-api/external-api.service';
import { Prisma } from '../../../../shared/prisma/client';
import {
  QueryRestaurantsDto,
  CreateRestaurantDto,
  QueryRestaurantDishMediaDto,
  QueryRestaurantsByGooglePlaceIdDto,
} from '@shared/v1/dto';
import {
  QueryRestaurantsResponse,
  CreateRestaurantResponse,
  QueryRestaurantDishMediaResponse,
  QueryRestaurantsByGooglePlaceIdResponse,
  GetRestaurantByIdResponse,
  ErrorCode,
} from '@shared/v1/res';
import { RestaurantsRepository } from './restaurants.repository';
import { DishesRepository } from '../dishes/dishes.repository';
import { DishMediaService } from '../dish-media/dish-media.service';
import { DishMediaRepository } from '../dish-media/dish-media.repository';
import { LocationsService } from '../locations/locations.service';
import { CloudTasksService } from 'src/core/cloud-tasks/cloud-tasks.service';
import { StorageService } from 'src/core/storage/storage.service';
import { RestaurantsAssembler } from './restaurants.assembler';
import { isFoodAndDrinkPlaceForUser } from '../../../../shared/utils/google_places_restaurant_type';
import { google } from '@googlemaps/places/build/protos/protos';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly repo: RestaurantsRepository,
    private readonly assembler: RestaurantsAssembler,
    private readonly externalApi: ExternalApiService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly dishesRepository: DishesRepository,
    private readonly dishMediaService: DishMediaService,
    private readonly dishMediaRepository: DishMediaRepository,
    private readonly locationsService: LocationsService,
    private readonly cloudTasksService: CloudTasksService,
    private readonly storageService: StorageService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*  共通ヘルパー                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Google Place ID から既存レストランを検索する
   * - トランザクションの扱いは既存実装に合わせて PrismaService 側に委譲
   */
  private async findRestaurantByGooglePlaceId(
    googlePlaceId: string,
  ): Promise<PrismaRestaurants | null> {
    return this.prisma.withTransaction((tx: Prisma.TransactionClient) =>
      this.repo.findRestaurantByGooglePlaceId(tx, googlePlaceId),
    );
  }

  /**
   * レストランのレビュー / 入札メタ情報を取得
   * - 既存実装同様、トランザクションは個別に実行（挙動を変えない）
   */
  private async fetchRestaurantMeta(
    restaurantId: string,
  ): Promise<CreateRestaurantResponse['meta']> {
    const reviewStats = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.getRestaurantReviewStats(tx, restaurantId),
    );
    const bidStats = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.getRestaurantBidStats(tx, restaurantId),
    );

    return {
      reviewCount: reviewStats.reviewCount,
      averageRating: reviewStats.averageRating,
      totalCents: bidStats.totalCents,
      maxEndDate: bidStats.maxEndDate
        ? bidStats.maxEndDate.toISOString()
        : null,
    };
  }

  /**
   * Google Place のローカル言語コードを解決する
   * - 仕様により、ここでの異常は素の Error を投げる挙動を維持（エラーハンドリング方針は今は変えない）
   */
  private async resolveRestaurantLanguage(googlePlaceId: string): Promise<{
    languageCode: string;
    placeDetailForLocalLang: google.maps.places.v1.IPlace;
  }> {
    try {
      const fieldMask = 'addressComponents,types';
      const placeDetailForLocalLang = await this.externalApi.callPlaceDetails(
        fieldMask,
        googlePlaceId,
        'en',
      );

      if (!placeDetailForLocalLang.addressComponents) {
        throw new Error(
          'No address components for restaurant language code detection',
        );
      }

      const languageCode = this.locationsService.resolveLocalLanguageCode(
        placeDetailForLocalLang.addressComponents,
      );

      return { languageCode, placeDetailForLocalLang };
    } catch (error) {
      // 既存挙動を維持：ここでは HttpException ではなく Error
      throw new Error(
        'Failed to determine restaurant language code: ' +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /**
   * Place の types から飲食店かどうかを判定し、NG の場合は 422 を投げる
   */
  private ensureIsFoodAndDrink(
    placeDetailForLocalLang: google.maps.places.v1.IPlace,
    googlePlaceId: string,
  ): void {
    if (
      !isFoodAndDrinkPlaceForUser({
        types: placeDetailForLocalLang.types ?? [],
      })
    ) {
      throw new UnprocessableEntityException({
        code: ErrorCode.PLACE_NOT_FOOD_AND_DRINK,
        message:
          'The specified Google Place is not a restaurant or food & drink venue.',
        data: {
          googlePlaceId,
          types: placeDetailForLocalLang.types ?? [],
        },
      });
    }
  }

  /**
   * レストラン作成用に Place 詳細を取得し、必須フィールドをバリデーションする
   * - 不足フィールドがあれば Error を投げる（既存挙動を維持）
   */
  private async fetchAndValidatePlaceDetail(
    googlePlaceId: string,
    languageCode: string,
  ): Promise<google.maps.places.v1.IPlace> {
    const fieldMask = [
      'id',
      'displayName',
      'location',
      'addressComponents',
      'plusCode',
      'photos',
    ].join(',');

    const placeDetail = await this.externalApi.callPlaceDetails(
      fieldMask,
      googlePlaceId,
      languageCode,
    );

    // 必須フィールドの存在チェック（型だけでなく値も確認）
    const missingFields: string[] = [];

    if (!placeDetail.id) missingFields.push('id');
    if (!placeDetail.displayName?.text) missingFields.push('displayName.text');
    if (typeof placeDetail.location?.latitude !== 'number')
      missingFields.push('location.latitude');
    if (typeof placeDetail.location?.longitude !== 'number')
      missingFields.push('location.longitude');
    if (!placeDetail.addressComponents) missingFields.push('addressComponents');
    if (!placeDetail.photos) missingFields.push('photos');

    if (missingFields.length > 0) {
      // ここは既存実装同様、詳細な place をログに出している（PII 対応は別課題として後回し）
      this.logger.error('InvalidPlaceData', 'createRestaurant', {
        placeId: placeDetail.id || 'unknown',
        missingFields,
        place: JSON.stringify(placeDetail),
      });
      throw new Error(
        `Invalid place data - missing fields: ${missingFields.join(', ')}`,
      );
    }

    return placeDetail;
  }

  /**
   * Google Place の写真を Storage にアップロードする
   * - 写真がない場合は何もしない
   * - 新規作成時は Resize が終わっていないため、UploadResult.signedUrl を返す
   */
  private async uploadRestaurantImageIfAny(
    placeDetail: google.maps.places.v1.IPlace,
    googlePlaceId: string,
  ): Promise<{ imagePath: string | null; imageSignedUrl?: string }> {
    const photoMedia = await this.locationsService.tryGetPhotoMedia(
      placeDetail.photos!,
      false,
    );

    if (!photoMedia) {
      return { imagePath: null, imageSignedUrl: undefined };
    }

    const result = await this.storageService.uploadFile({
      buffer: photoMedia.buffer,
      mimeType: 'image/jpeg',
      resourceType: 'google-maps',
      usageType: 'photo',
      identifier: googlePlaceId,
    });

    return {
      imagePath: result.path,
      imageSignedUrl: result.signedUrl,
    };
  }

  /**
   * restaurants テーブルにレコードを登録
   * - Prisma.restaurantsCreateInput を利用し、id など DB が付与する値は指定しない
   */
  private async createRestaurantRecord(params: {
    googlePlaceId: string;
    languageCode: string;
    placeDetail: google.maps.places.v1.IPlace;
    imagePath: string | null;
    name?: string;
  }): Promise<PrismaRestaurants> {
    const { googlePlaceId, languageCode, placeDetail, imagePath, name } =
      params;

    const restaurantData: Prisma.restaurantsCreateInput = {
      google_place_id: googlePlaceId,
      // #1671 ユーザーが確認した店名があればそれを使う。無ければ従来どおり Google の表示名
      name: name || placeDetail.displayName!.text!, // バリデーション済みのため非 null アサーション
      name_language_code: languageCode,
      latitude: placeDetail.location!.latitude!,
      longitude: placeDetail.location!.longitude!,
      // 【非推奨カラム】だがスキーマ上必須であれば空文字で維持
      image_url: '',
      image_path: imagePath,
      // as を利用して Prisma.JsonValue にキャスト（JSON として保持する前提）
      address_components:
        placeDetail.addressComponents as unknown as Prisma.InputJsonValue,
      plus_code: placeDetail.plusCode
        ? (placeDetail.plusCode as unknown as Prisma.InputJsonValue)
        : undefined,
      // created_at は DB デフォルトがあれば省略可能だが、既存互換のため残す
      created_at: new Date(),
    };

    return this.prisma.withTransaction((tx: Prisma.TransactionClient) =>
      this.dishesRepository.createOrGetRestaurant(
        tx,
        restaurantData,
        googlePlaceId,
      ),
    );
  }

  /**
   * レストラン画像のリサイズタスクを Cloud Tasks に enqueue する
   * - 画像がない場合は何もしない
   */
  private async enqueueImageResizeIfNeeded(
    restaurantId: string,
    imagePath: string | null,
  ): Promise<void> {
    if (!imagePath) return;

    // 既存実装通りに 256 / 64 の 2 パターンをキューイング
    await this.cloudTasksService.enqueueResizeImage({
      table: 'restaurants',
      column: 'image_path',
      recordId: restaurantId,
      size: 256,
      aspectRatio: 9 / 16,
      originalPath: imagePath,
    });
    await this.cloudTasksService.enqueueResizeImage({
      table: 'restaurants',
      column: 'image_path',
      recordId: restaurantId,
      size: 64,
      aspectRatio: 9 / 16,
      originalPath: imagePath,
    });
  }

  /**
   * レスポンス用のレストランデータを組み立てる
   * - 基本は assembler.enrichRestaurantsWithImageUrls に統一
   * - 新規作成時のみ、UploadResult.signedUrl で imageUrls を上書きする
   */
  private buildRestaurantWithImageOverride(
    restaurant: PrismaRestaurants,
    options?: { uploadedSignedUrl?: string },
  ) {
    // まずは既存の assembler ロジックで統一的に変換
    const base = this.assembler.enrichRestaurantsWithImageUrls(restaurant);

    // 新規作成時など、アップロード直後に signedUrl を優先したい場合のみ上書き
    if (options?.uploadedSignedUrl) {
      return {
        ...base,
        imageUrls: {
          sm: options.uploadedSignedUrl,
          md: options.uploadedSignedUrl,
        },
      };
    }

    return base;
  }

  /* ------------------------------------------------------------------ */
  /* GET /v1/restaurants/search (nearby restaurant search)               */
  /* ------------------------------------------------------------------ */
  async searchRestaurants(
    dto: QueryRestaurantsDto,
  ): Promise<QueryRestaurantsResponse> {
    this.logger.debug('SearchRestaurants', 'searchRestaurants', {
      lat: dto.lat,
      lng: dto.lng,
      radius: dto.radius,
    });

    // 近隣レストラン + 入札状況を DB から取得
    const results = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.searchNearbyRestaurants(tx, dto),
    );

    this.logger.debug('SearchRestaurantsResult', 'searchRestaurants', {
      count: results.length,
    });

    // レスポンス変換は assembler に統一
    return results.map((r) => ({
      restaurant: this.assembler.enrichRestaurantsWithImageUrls(r.restaurant),
      meta: r.meta,
    }));
  }

  /* ------------------------------------------------------------------ */
  /* POST /v1/restaurants (Google Place ID creation)                     */
  /* ------------------------------------------------------------------ */
  async createRestaurant(
    dto: CreateRestaurantDto,
  ): Promise<CreateRestaurantResponse> {
    this.logger.debug('CreateRestaurant', 'createRestaurant', {
      dto,
    });

    // 1. 対象の Google Place ID の restaurant が存在するか確認
    const existingRestaurant = await this.findRestaurantByGooglePlaceId(
      dto.googlePlaceId,
    );

    if (existingRestaurant) {
      // 既存レストランの場合はメタ情報を取得して返すだけ
      const meta = await this.fetchRestaurantMeta(existingRestaurant.id);

      return {
        restaurant: this.buildRestaurantWithImageOverride(existingRestaurant),
        meta,
      };
    }

    // 2. 新規作成フロー
    // 2-1. 対象の Google Place ID の restaurant の現地の言語コードを特定
    const { languageCode: restaurantLanguageCode, placeDetailForLocalLang } =
      await this.resolveRestaurantLanguage(dto.googlePlaceId);

    // 2-2. types による飲食店判定
    this.ensureIsFoodAndDrink(placeDetailForLocalLang, dto.googlePlaceId);

    // 2-3. Place 詳細を取得して DB 登録まで実行
    let restaurant: PrismaRestaurants;
    let imageSignedUrl: string | undefined;

    try {
      const placeDetail = await this.fetchAndValidatePlaceDetail(
        dto.googlePlaceId,
        restaurantLanguageCode,
      );

      const { imagePath, imageSignedUrl: uploadedSignedUrl } =
        await this.uploadRestaurantImageIfAny(placeDetail, dto.googlePlaceId);

      imageSignedUrl = uploadedSignedUrl;

      restaurant = await this.createRestaurantRecord({
        googlePlaceId: dto.googlePlaceId,
        languageCode: restaurantLanguageCode,
        placeDetail,
        imagePath,
        name: dto.name,
      });

      await this.enqueueImageResizeIfNeeded(restaurant.id, imagePath);

      this.logger.debug('RestaurantCreated', 'createRestaurant', {
        restaurantId: restaurant.id,
        name: restaurant.name,
        googlePlaceId: restaurant.google_place_id,
      });
    } catch (error) {
      // 既存実装と同様、Place 詳細取得〜登録処理でのエラーは 404 にマッピング
      this.logger.error('GooglePlaceDetailsFailed', 'createRestaurant', {
        googlePlaceId: dto.googlePlaceId,
        error: (error as Error).message,
      });
      throw new NotFoundException('Google Place not found or invalid');
    }

    // 新規作成直後はレビュー/入札は 0 のことが多いが、
    // 既存実装との相性を保ちつつ meta は常に fetch する
    const meta = await this.fetchRestaurantMeta(restaurant.id);

    return {
      restaurant: this.buildRestaurantWithImageOverride(restaurant, {
        // 新規作成時のみ、Resize 前の signedUrl を返す仕様
        uploadedSignedUrl: imageSignedUrl,
      }),
      meta,
    };
  }

  /* ------------------------------------------------------------------ */
  /* GET /v1/restaurants/{id}/dish-media (restaurant dish media list)    */
  /* ------------------------------------------------------------------ */
  async getRestaurantDishMedia(
    restaurantId: string,
    dto: QueryRestaurantDishMediaDto,
    userId: string,
  ): Promise<QueryRestaurantDishMediaResponse> {
    this.logger.debug('GetRestaurantDishMedia', 'getRestaurantDishMedia', {
      restaurantId,
      cursor: dto.cursor,
      viewer: userId, // ログイン必須 API のため、冗長な 'anon' フォールバックは削除
    });

    // 対象レストランが存在するか検証
    const restaurantExists = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.restaurantExists(tx, restaurantId),
    );
    if (!restaurantExists) {
      throw new NotFoundException('Restaurant not found');
    }

    // レストランに紐づく dish media をページング取得
    const dishMediaByRestaurant = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.dishMediaRepository.findDishMediaByRestaurant(
          tx,
          restaurantId,
          dto,
        ),
    );

    const dishMediaIds = dishMediaByRestaurant.items.map(
      (l) => l.dish_media_id,
    );

    const dishMediaEntryItemsResult =
      await this.dishMediaService.fetchDishMediaEntryItems(dishMediaIds, {
        userId,
      });

    this.logger.debug(
      'GetRestaurantDishMediaResult',
      'getRestaurantDishMedia',
      {
        count: dishMediaEntryItemsResult.items.length,
      },
    );

    // 戻り値の型は Promise<QueryRestaurantDishMediaResponse> に統一
    return {
      data: dishMediaEntryItemsResult.items,
      nextCursor: dishMediaByRestaurant.nextCursor,
    };
  }

  /* ------------------------------------------------------------------ */
  /* GET /v1/restaurants/:id (restaurant by ID)                          */
  /* ------------------------------------------------------------------ */
  async getRestaurantById(
    restaurantId: string,
  ): Promise<GetRestaurantByIdResponse> {
    this.logger.debug('GetRestaurantById', 'getRestaurantById', {
      restaurantId,
    });

    // #644 【設計】restaurant.id でレストラン情報を取得
    const restaurant = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.findRestaurantById(tx, restaurantId),
    );

    if (!restaurant) {
      this.logger.debug('RestaurantNotFound', 'getRestaurantById', {
        restaurantId,
      });
      throw new NotFoundException('Restaurant not found');
    }

    // レビュー統計情報を取得
    const reviewStats = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.getRestaurantReviewStats(tx, restaurant.id),
    );

    // 入札統計情報を取得
    const bidStats = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.getRestaurantBidStats(tx, restaurant.id),
    );

    this.logger.debug('RestaurantFound', 'getRestaurantById', {
      restaurantId: restaurant.id,
      name: restaurant.name,
      reviewCount: reviewStats.reviewCount,
      averageRating: reviewStats.averageRating,
    });

    return {
      restaurant: this.assembler.enrichRestaurantsWithImageUrls(restaurant),
      meta: {
        reviewCount: reviewStats.reviewCount,
        averageRating: reviewStats.averageRating,
        totalCents: bidStats.totalCents,
        maxEndDate: bidStats.maxEndDate
          ? bidStats.maxEndDate.toISOString()
          : null,
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* GET /v1/restaurants/by-google-place-id (Google Place ID query)      */
  /* ------------------------------------------------------------------ */
  async getRestaurantByGooglePlaceId(
    dto: QueryRestaurantsByGooglePlaceIdDto,
  ): Promise<QueryRestaurantsByGooglePlaceIdResponse | null> {
    this.logger.debug(
      'GetRestaurantByGooglePlaceId',
      'getRestaurantByGooglePlaceId',
      {
        googlePlaceId: dto.googlePlaceId,
      },
    );

    // DB からレストランを検索
    const restaurant = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.findRestaurantByGooglePlaceId(tx, dto.googlePlaceId),
    );

    if (!restaurant) {
      this.logger.debug('RestaurantNotFound', 'getRestaurantByGooglePlaceId', {
        googlePlaceId: dto.googlePlaceId,
      });
      return null;
    }

    this.logger.debug('RestaurantFound', 'getRestaurantByGooglePlaceId', {
      restaurantId: restaurant.id,
      name: restaurant.name,
    });

    // ここも assembler に統一
    return this.assembler.enrichRestaurantsWithImageUrls(restaurant);
  }
}
