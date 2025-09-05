// api/src/v1/restaurants/restaurants.service.ts
//
// ❶ Service for restaurants domain - business logic
// ❷ Following the pattern from dish-media/dish-media.service.ts
// ❃ Handles Google Place API integration, restaurant creation/search, dish media queries

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { ExternalApiService } from '../../core/external-api/external-api.service';
import { convertPrismaToSupabase_Restaurants } from '../../../../shared/converters/convert_restaurants';
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

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly repo: RestaurantsRepository,
    private readonly mapper: RestaurantsMapper,
    private readonly externalApi: ExternalApiService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*              GET /v1/restaurants/search (周边餐厅搜索)               */
  /* ------------------------------------------------------------------ */
  async searchRestaurants(
    dto: QueryRestaurantsDto,
  ): Promise<QueryRestaurantsResponse> {
    this.logger.debug('SearchRestaurants', 'searchRestaurants', {
      lat: dto.lat,
      lng: dto.lng,
      radius: dto.radius,
    });

    // 从数据库查询周边餐厅和入札状况
    const results = await this.repo.searchNearbyRestaurants(dto);

    this.logger.debug('SearchRestaurantsResult', 'searchRestaurants', {
      count: results.length,
    });

    return results.map((r) => ({
      restaurant: convertPrismaToSupabase_Restaurants(r.restaurant),
      meta: r.meta,
    }));
  }

  /* ------------------------------------------------------------------ */
  /*             POST /v1/restaurants (Google Place ID 创建)           */
  /* ------------------------------------------------------------------ */
  async createRestaurant(
    dto: CreateRestaurantDto,
  ): Promise<CreateRestaurantResponse> {
    this.logger.debug('CreateRestaurant', 'createRestaurant', {
      googlePlaceId: dto.googlePlaceId,
    });

    // 1. レストランが既に存在するか確認
    let restaurant = await this.repo.findRestaurantByGooglePlaceId(
      dto.googlePlaceId,
    );
    let restaurantReviewStats = {
      reviewCount: 0,
      averageRating: 0,
    };
    if (restaurant) {
      restaurantReviewStats = await this.repo.getRestaurantReviewStats(
        restaurant.id,
      );
    } else {
      // 2. 调用 Google Place Details API 获取详细信息
      try {
        const fieldMask =
          'id,displayName,formattedAddress,location,nationalPhoneNumber,websiteUri,rating,userRatingCount,priceLevel,regularOpeningHours,photos,types';
        const placeDetail = await this.externalApi.callPlaceDetails(
          fieldMask,
          dto.googlePlaceId,
          'ja', // 日语优先
        );

        // 3. 创建餐厅记录
        // TODO: restaurant = await this.DishesRepository.createOrGetRestaurant(placeDetail);

        this.logger.debug('RestaurantCreated', 'createRestaurant', {
          // restaurantId: restaurant.id,
          // name: restaurant.name,
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
      ...convertPrismaToSupabase_Restaurants(restaurant!),
      ...restaurantReviewStats,
    };
  }

  /* ------------------------------------------------------------------ */
  /*         GET /v1/restaurants/{id}/dish-media (餐厅料理投稿一览)        */
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

    // 验证餐厅是否存在
    const restaurantExists = await this.repo.restaurantExists(restaurantId);
    if (!restaurantExists) {
      throw new NotFoundException('Restaurant not found');
    }

    // TODO: const dishMediaByRestaurant = await this.DishMediaRepository.findDishMediaByRestaurant(restaurantId, dto);

    // const dishMediaIds = dishMediaByRestaurant.map((l) => l.dish_media_id);

    // const dishMediaEntries =
    //   await this.dishMediaService.fetchDishMediaEntryItems(dishMediaIds, {
    //     userId,
    //   });

    this.logger.debug(
      'GetRestaurantDishMediaResult',
      'getRestaurantDishMedia',
      {
        // count: dishMediaEntries.length,
      },
    );

    // return this.mapper.toRestaurantDishMediaResponse({
    //   data: dishMediaEntries,
    //   nextCursor: dishMediaByRestaurant.nextCursor,
    // });
    return {} as QueryRestaurantDishMediaResponse;
  }

  /* ------------------------------------------------------------------ */
  /*    GET /v1/restaurants/by-google-place-id (Google Place ID 查询)  */
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

    // 从数据库查询餐厅
    const restaurant = await this.repo.findRestaurantByGooglePlaceId(
      dto.googlePlaceId,
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
