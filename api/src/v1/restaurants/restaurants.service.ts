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
import {
  RestaurantsRepository,
  RestaurantWithMeta,
} from './restaurants.repository';
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

    return results;
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

    // 1. 先检查数据库中是否已存在
    const existingRestaurant = await this.repo.findByGooglePlaceId(
      dto.googlePlaceId,
    );
    if (existingRestaurant) {
      this.logger.debug('RestaurantExists', 'createRestaurant', {
        restaurantId: existingRestaurant.id,
      });
      return convertPrismaToSupabase_Restaurants(existingRestaurant);
    }

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
      const newRestaurant = await this.repo.createRestaurant(placeDetail);

      this.logger.debug('RestaurantCreated', 'createRestaurant', {
        restaurantId: newRestaurant.id,
        name: newRestaurant.name,
      });

      return convertPrismaToSupabase_Restaurants(newRestaurant);
    } catch (error) {
      this.logger.error('GooglePlaceDetailsFailed', 'createRestaurant', {
        googlePlaceId: dto.googlePlaceId,
        error: (error as Error).message,
      });
      throw new NotFoundException('Google Place not found or invalid');
    }
  }

  /* ------------------------------------------------------------------ */
  /*         GET /v1/restaurants/{id}/dish-media (餐厅料理投稿一览)        */
  /* ------------------------------------------------------------------ */
  async getRestaurantDishMedia(
    restaurantId: string,
    dto: QueryRestaurantDishMediaDto,
    viewerId?: string,
  ): Promise<QueryRestaurantDishMediaResponse> {
    this.logger.debug('GetRestaurantDishMedia', 'getRestaurantDishMedia', {
      restaurantId,
      cursor: dto.cursor,
      viewer: viewerId ?? 'anon',
    });

    // 验证餐厅是否存在
    const restaurantExists = await this.repo.restaurantExists(restaurantId);
    if (!restaurantExists) {
      throw new NotFoundException('Restaurant not found');
    }

    // 获取餐厅的料理投稿数据
    const items = await this.repo.getRestaurantDishMedia(restaurantId, dto);

    // 转换为响应格式
    const response = this.mapper.toRestaurantDishMediaResponse(items, viewerId);

    this.logger.debug(
      'GetRestaurantDishMediaResult',
      'getRestaurantDishMedia',
      {
        count: response.data.length,
      },
    );

    return response;
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
    const restaurant = await this.repo.findByGooglePlaceId(dto.googlePlaceId);

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
