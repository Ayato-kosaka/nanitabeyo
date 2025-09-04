// api/src/v1/restaurants/restaurants.repository.ts
//
// ❶ Repository for restaurants domain - database operations
// ❷ Following the pattern from dish-media/dish-media.repository.ts
// ❸ Handles database queries for restaurants, restaurant bids, and dish media

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { convertPrismaToSupabase_Restaurants } from '../../../../shared/converters/convert_restaurants';
import { convertPrismaToSupabase_RestaurantBids } from '../../../../shared/converters/convert_restaurant_bids';
import {
  QueryRestaurantsDto,
  QueryRestaurantDishMediaDto,
} from '@shared/v1/dto';

export type RestaurantWithMeta = {
  restaurant: any;
  meta: { totalCents: number; maxEndDate: string | null };
};

export type RestaurantDishMediaEntry = {
  id: string;
  dishes: {
    restaurants: any;
    dish_categories: any;
  };
  dish_media: any[];
  dish_reviews: any[];
};

@Injectable()
export class RestaurantsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                    餐厅搜索查询（周边 + 入札状况）                    */
  /* ------------------------------------------------------------------ */
  async searchNearbyRestaurants(
    dto: QueryRestaurantsDto,
  ): Promise<RestaurantWithMeta[]> {
    this.logger.debug('SearchNearbyRestaurants', 'searchNearbyRestaurants', {
      lat: dto.lat,
      lng: dto.lng,
      radius: dto.radius,
    });

    // 地理围栏查询：根据经纬度和半径查找餐厅
    const radiusInKm = dto.radius / 1000; // 转换为公里
    const radiusInDegrees = radiusInKm / 111; // 大致转换（1度约等于111公里）

    const rawResult = await this.prisma.prisma.$queryRaw<any[]>`
      SELECT 
        r.*,
        COALESCE(SUM(rb.amount_cents), 0) as total_cents,
        MAX(rb.end_date) as max_end_date,
        COUNT(DISTINCT dr.id) as review_count,
        COALESCE(AVG(dr.rating), 0) as average_rating
      FROM restaurants r
      LEFT JOIN restaurant_bids rb ON r.id = rb.restaurant_id 
        AND rb.start_date <= CURRENT_DATE 
        AND rb.end_date > CURRENT_DATE 
        AND rb.status = 'confirmed'
      LEFT JOIN dishes d ON r.id = d.restaurant_id
      LEFT JOIN dish_reviews dr ON d.id = dr.dish_id
      WHERE 
        r.latitude BETWEEN ${dto.lat - radiusInDegrees} AND ${dto.lat + radiusInDegrees}
        AND r.longitude BETWEEN ${dto.lng - radiusInDegrees} AND ${dto.lng + radiusInDegrees}
        AND (6371 * acos(cos(radians(${dto.lat})) * cos(radians(r.latitude)) 
            * cos(radians(r.longitude) - radians(${dto.lng})) + sin(radians(${dto.lat})) 
            * sin(radians(r.latitude)))) <= ${radiusInKm}
      GROUP BY r.id
      ORDER BY total_cents DESC, review_count DESC
      LIMIT 50
    `;

    return rawResult.map((row) => ({
      restaurant: {
        ...convertPrismaToSupabase_Restaurants(row),
        reviewCount: Number(row.review_count) || 0,
        averageRating: Number(row.average_rating) || 0,
      },
      meta: {
        totalCents: Number(row.total_cents) || 0,
        maxEndDate: row.max_end_date || null,
      },
    }));
  }

  /* ------------------------------------------------------------------ */
  /*                    根据 Google Place ID 查找餐厅                    */
  /* ------------------------------------------------------------------ */
  async findByGooglePlaceId(googlePlaceId: string) {
    this.logger.debug('FindByGooglePlaceId', 'findByGooglePlaceId', {
      googlePlaceId,
    });

    return await this.prisma.prisma.restaurants.findUnique({
      where: { google_place_id: googlePlaceId },
    });
  }

  /* ------------------------------------------------------------------ */
  /*                        创建餐厅（Google Place）                      */
  /* ------------------------------------------------------------------ */
  async createRestaurant(placeDetail: any) {
    this.logger.debug('CreateRestaurant', 'createRestaurant', {
      placeId: placeDetail.id,
      displayName: placeDetail.displayName?.text,
    });

    const restaurantData = {
      google_place_id: placeDetail.id,
      name: placeDetail.displayName?.text || '',
      name_language_code: 'ja',
      latitude: placeDetail.location?.latitude || 0,
      longitude: placeDetail.location?.longitude || 0,
      image_url: placeDetail.photos?.[0]?.name || '',
      address_components: placeDetail.formattedAddress
        ? { formatted_address: placeDetail.formattedAddress }
        : {},
      plus_code: placeDetail.plusCode || null,
      created_at: new Date(),
    };

    return await this.prisma.prisma.restaurants.create({
      data: restaurantData,
    });
  }

  /* ------------------------------------------------------------------ */
  /*                   根据 ID 查找餐厅的料理投稿                         */
  /* ------------------------------------------------------------------ */
  async getRestaurantDishMedia(
    restaurantId: string,
    dto: QueryRestaurantDishMediaDto,
  ): Promise<RestaurantDishMediaEntry[]> {
    this.logger.debug('GetRestaurantDishMedia', 'getRestaurantDishMedia', {
      restaurantId,
      cursor: dto.cursor,
    });

    const items = await this.prisma.prisma.dishes.findMany({
      where: { restaurant_id: restaurantId },
      include: {
        restaurants: true,
        dish_categories: true,
        dish_media: {
          include: {
            dish_media_likes: true,
          },
          orderBy: { created_at: 'desc' },
          take: 1, // 取每个料理的最新投稿
        },
        dish_reviews: {
          include: {
            users: {
              select: { username: true },
            },
          },
          orderBy: { created_at: 'desc' },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 41, // 限制为41个以支持分页
    });

    return items.map((item) => ({
      id: item.id,
      dishes: {
        restaurants: item.restaurants,
        dish_categories: item.dish_categories,
      },
      dish_media: item.dish_media,
      dish_reviews: item.dish_reviews,
    }));
  }

  /* ------------------------------------------------------------------ */
  /*                          查找餐厅是否存在                          */
  /* ------------------------------------------------------------------ */
  async restaurantExists(id: string): Promise<boolean> {
    const count = await this.prisma.prisma.restaurants.count({
      where: { id },
    });
    return count > 0;
  }
}
