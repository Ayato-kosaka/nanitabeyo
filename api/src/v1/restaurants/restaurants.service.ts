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
import { RestaurantsMapper } from './restaurants.mapper';
import { DishesRepository } from '../dishes/dishes.repository';
import { DishMediaService } from '../dish-media/dish-media.service';
import { DishMediaRepository } from '../dish-media/dish-media.repository';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly repo: RestaurantsRepository,
    private readonly mapper: RestaurantsMapper,
    private readonly externalApi: ExternalApiService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly dishesRepository: DishesRepository,
    private readonly dishMediaService: DishMediaService,
    private readonly dishMediaRepository: DishMediaRepository,
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
      restaurant: convertPrismaToSupabase_Restaurants(r.restaurant),
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
      googlePlaceId: dto.googlePlaceId,
    });

    // 1. Check if restaurant already exists
    let restaurant = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.findRestaurantByGooglePlaceId(tx, dto.googlePlaceId),
    );
    let restaurantReviewStats = {
      reviewCount: 0,
      averageRating: 0,
    };
    if (restaurant) {
      restaurantReviewStats = await this.prisma.withTransaction(
        (tx: Prisma.TransactionClient) =>
          this.repo.getRestaurantReviewStats(tx, restaurant!.id),
      );
    } else {
      // 2. Call Google Place Details API to get detailed information
      try {
        const fieldMask = [
          'id',
          'displayName',
          'location',
          'addressComponents',
          'plusCode',
        ].join(',');
        const placeDetail = await this.externalApi.callPlaceDetails(
          fieldMask,
          dto.googlePlaceId,
          dto.languageCode, // Use dynamic language code from request
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

        // 3. Create restaurant record
        const restaurantData: PrismaRestaurants = {
          id: 'unknown', // Will be assigned by database
          google_place_id: dto.googlePlaceId,
          name: placeDetail.displayName!.text!,
          name_language_code: 'ja', // Japanese priority as set above
          latitude: placeDetail.location!.latitude!,
          longitude: placeDetail.location!.longitude!,
          image_url: placeDetail.photos?.[0]?.name || '', // TODO: 引数から受け取る。
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

        this.logger.debug('RestaurantCreated', 'createRestaurant', {
          restaurantId: restaurant.id,
          name: restaurant.name,
          googlePlaceId: restaurant.google_place_id,
        });

        // Fetch review stats for the newly created restaurant
        restaurantReviewStats = await this.prisma.withTransaction(
          (tx: Prisma.TransactionClient) =>
            this.repo.getRestaurantReviewStats(tx, restaurant!.id),
        );
      } catch (error) {
        this.logger.error('GooglePlaceDetailsFailed', 'createRestaurant', {
          googlePlaceId: dto.googlePlaceId,
          error: (error as Error).message,
        });
        throw new NotFoundException('Google Place not found or invalid');
      }
    }

    return {
      ...convertPrismaToSupabase_Restaurants(restaurant!),
      ...restaurantReviewStats,
    };
  }

  /* ------------------------------------------------------------------ */
  /*         GET /v1/restaurants/{id}/dish-media (restaurant dish media list)        */
  /* ------------------------------------------------------------------ */
  async getRestaurantDishMedia(
    restaurantId: string,
    dto: QueryRestaurantDishMediaDto,
    userId?: string,
  ): Promise<QueryRestaurantDishMediaResponse> {
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
    const dishMediaByRestaurant =
      await this.dishMediaRepository.findDishMediaByRestaurant(
        restaurantId,
        dto,
      );

    const dishMediaIds = dishMediaByRestaurant.items.map(
      (l) => l.dish_media_id,
    );

    const dishMediaEntries =
      await this.dishMediaService.fetchDishMediaEntryItems(dishMediaIds, {
        userId,
      });

    this.logger.debug(
      'GetRestaurantDishMediaResult',
      'getRestaurantDishMedia',
      {
        count: dishMediaEntries.length,
      },
    );

    return this.mapper.toRestaurantDishMediaResponse({
      data: dishMediaEntries,
      nextCursor: dishMediaByRestaurant.nextCursor,
    });
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

    return convertPrismaToSupabase_Restaurants(restaurant);
  }
}
