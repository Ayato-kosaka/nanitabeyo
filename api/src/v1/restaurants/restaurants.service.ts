// api/src/v1/restaurants/restaurants.service.ts
//
// ❶ Service for restaurants domain - business logic
// ❷ Following the pattern from dish-media/dish-media.service.ts
// ❸ Handles Google Place API integration, restaurant creation/search, dish media queries

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { ExternalApiService } from '../../core/external-api/external-api.service';
import { convertPrismaToSupabase_Restaurants } from '../../../../shared/converters/convert_restaurants';
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
} from '@shared/v1/res';
import { RestaurantsRepository } from './restaurants.repository';
import { DishesRepository } from '../dishes/dishes.repository';
import { DishMediaService } from '../dish-media/dish-media.service';
import { DishMediaRepository } from '../dish-media/dish-media.repository';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import { LocationsService } from '../locations/locations.service';
import { CloudTasksService } from 'src/core/cloud-tasks/cloud-tasks.service';
import { StorageService } from 'src/core/storage/storage.service';
import { RestaurantsAssembler } from './restaurants.assembler';
import { protos } from '@googlemaps/places';

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
  /*              GET /v1/restaurants/search (nearby restaurant search)               */
  /* ------------------------------------------------------------------ */
  async searchRestaurants(
    dto: QueryRestaurantsDto,
  ): Promise<QueryRestaurantsResponse> {
    this.logger.debug('SearchRestaurants', 'searchRestaurants', {
      lat: dto.lat,
      lng: dto.lng,
      radius: dto.radius,
    });

    // Query nearby restaurants and bidding status from database
    const results = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.searchNearbyRestaurants(tx, dto),
    );

    this.logger.debug('SearchRestaurantsResult', 'searchRestaurants', {
      count: results.length,
    });

    return results.map((r) => ({
      restaurant: this.assembler.enrichRestaurantsWithImageUrls(r.restaurant),
      meta: r.meta,
    }));
  }

  /* ------------------------------------------------------------------ */
  /*             POST /v1/restaurants (Google Place ID creation)           */
  /* ------------------------------------------------------------------ */
  async createRestaurant(
    dto: CreateRestaurantDto,
  ): Promise<CreateRestaurantResponse> {
    this.logger.debug('CreateRestaurant', 'createRestaurant', {
      dto,
    });

    // 対象の Google Place ID の restaurant が存在するか確認
    let restaurant = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.findRestaurantByGooglePlaceId(tx, dto.googlePlaceId),
    );
    let restaurantReviewStats: Pick<
      CreateRestaurantResponse['meta'],
      'reviewCount' | 'averageRating'
    > = {
      reviewCount: 0,
      averageRating: 0,
    };
    let restaurantBidStats: Pick<
      CreateRestaurantResponse['meta'],
      'totalCents' | 'maxEndDate'
    > = {
      totalCents: 0,
      maxEndDate: null,
    };
    let imageSignedUrl: string | undefined;

    if (restaurant) {
      // 既にレストランが存在する場合はレビュー・入札統計情報を取得して返すのみ
      restaurantReviewStats = await this.prisma.withTransaction(
        (tx: Prisma.TransactionClient) =>
          this.repo.getRestaurantReviewStats(tx, restaurant!.id),
      );
      const bidStats = await this.prisma.withTransaction(
        (tx: Prisma.TransactionClient) =>
          this.repo.getRestaurantBidStats(tx, restaurant!.id),
      );
      restaurantBidStats = {
        totalCents: bidStats.totalCents,
        maxEndDate: bidStats.maxEndDate
          ? bidStats.maxEndDate.toISOString()
          : null,
      };
    } else {
      // 対象の Google Place ID の restaurant の現地の言語コードを特定
      let restaurantLanguageCode: string;
      try {
        const fieldMask = 'addressComponents';
        const placeDetail = await this.externalApi.callPlaceDetails(
          fieldMask,
          dto.googlePlaceId,
          'en',
        );
        if (!placeDetail.addressComponents)
          throw new Error(
            'No address components for restaurant language code detection',
          );
        restaurantLanguageCode = this.locationsService.resolveLocalLanguageCode(
          placeDetail.addressComponents,
        );
      } catch (error) {
        throw new Error(
          'Failed to determine restaurant language code: ' +
            (error as Error).message,
        );
      }

      // Google Place Details API を呼び出して店舗情報を取得
      try {
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
          dto.googlePlaceId,
          restaurantLanguageCode,
        );

        // Check required fields with proper validation for latitude/longitude
        const missingFields: string[] = [];
        if (!placeDetail.id) missingFields.push('id');
        if (!placeDetail.displayName?.text)
          missingFields.push('displayName.text');
        if (typeof placeDetail.location?.latitude !== 'number')
          missingFields.push('location.latitude');
        if (typeof placeDetail.location?.longitude !== 'number')
          missingFields.push('location.longitude');
        if (!placeDetail.addressComponents)
          missingFields.push('addressComponents');
        if (!placeDetail.photos) missingFields.push('photos');

        if (missingFields.length > 0) {
          this.logger.error('InvalidPlaceData', 'createRestaurant', {
            placeId: placeDetail.id || 'unknown',
            missingFields,
            place: JSON.stringify(placeDetail),
          });
          throw new Error(
            `Invalid place data - missing fields: ${missingFields.join(', ')}`,
          );
        }

        // 写真の取得とストレージパスの構築
        const photoMedia = await this.locationsService.tryGetPhotoMedia(
          placeDetail.photos!,
          false,
        );
        let imagePath: string | null = null;
        if (photoMedia) {
          const result = await this.storageService.uploadFile({
            buffer: photoMedia.buffer,
            mimeType: 'image/jpeg',
            resourceType: 'google-maps',
            usageType: 'photo',
            identifier: dto.googlePlaceId,
          });
          imagePath = result.path;
          imageSignedUrl = result.signedUrl;
        }

        // restaurant テーブル登録
        const restaurantData: PrismaRestaurants = {
          id: 'unknown', // Will be assigned by database
          google_place_id: dto.googlePlaceId,
          name: placeDetail.displayName!.text!,
          name_language_code: restaurantLanguageCode,
          latitude: placeDetail.location!.latitude!,
          longitude: placeDetail.location!.longitude!,
          image_url: '', // 【非推奨カラム】
          image_path: imagePath,
          address_components: JSON.parse(
            JSON.stringify(placeDetail.addressComponents),
          ),
          plus_code: placeDetail.plusCode
            ? JSON.parse(JSON.stringify(placeDetail.plusCode))
            : null,
          created_at: new Date(),
        };

        restaurant = await this.prisma.withTransaction(
          (tx: Prisma.TransactionClient) =>
            this.dishesRepository.createOrGetRestaurant(
              tx,
              restaurantData,
              dto.googlePlaceId,
            ),
        );

        // 画像のリサイズタスクをキューイング
        if (imagePath && restaurant) {
          // Enqueue image resize tasks for multiple sizes
          await this.cloudTasksService.enqueueResizeImage({
            table: 'restaurants',
            column: 'image_path',
            recordId: restaurant.id,
            size: 256,
            aspectRatio: 9 / 16,
            originalPath: imagePath,
          });
          await this.cloudTasksService.enqueueResizeImage({
            table: 'restaurants',
            column: 'image_path',
            recordId: restaurant.id,
            size: 64,
            aspectRatio: 9 / 16,
            originalPath: imagePath,
          });
        }

        this.logger.debug('RestaurantCreated', 'createRestaurant', {
          restaurantId: restaurant.id,
          name: restaurant.name,
          googlePlaceId: restaurant.google_place_id,
        });
      } catch (error) {
        this.logger.error('GooglePlaceDetailsFailed', 'createRestaurant', {
          googlePlaceId: dto.googlePlaceId,
          error: (error as Error).message,
        });
        throw new NotFoundException('Google Place not found or invalid');
      }
    }

    return {
      restaurant: {
        ...convertPrismaToSupabase_Restaurants(restaurant),
        imageUrls: imageSignedUrl
          ? {
              sm: imageSignedUrl,
              md: imageSignedUrl,
            }
          : undefined,
      },
      meta: {
        ...restaurantReviewStats,
        ...restaurantBidStats,
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /*         GET /v1/restaurants/{id}/dish-media (restaurant dish media list)        */
  /* ------------------------------------------------------------------ */
  async getRestaurantDishMedia(
    restaurantId: string,
    dto: QueryRestaurantDishMediaDto,
    userId: string,
  ): Promise<{
    response: QueryRestaurantDishMediaResponse;
  }> {
    this.logger.debug('GetRestaurantDishMedia', 'getRestaurantDishMedia', {
      restaurantId,
      cursor: dto.cursor,
      viewer: userId ?? 'anon',
    });

    // Validate restaurant exists
    const restaurantExists = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.restaurantExists(tx, restaurantId),
    );
    if (!restaurantExists) {
      throw new NotFoundException('Restaurant not found');
    }

    // Get dish media by restaurant with pagination
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

    return {
      response: {
        data: dishMediaEntryItemsResult.items,
        nextCursor: dishMediaByRestaurant.nextCursor,
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /*    GET /v1/restaurants/by-google-place-id (Google Place ID query)  */
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

    // Query restaurant from database
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

    return this.assembler.enrichRestaurantsWithImageUrls(restaurant);
  }
}
