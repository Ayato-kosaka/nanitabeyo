// api/src/v1/restaurants/restaurants.repository.ts
//
// ❶ Repository for restaurants domain - database operations
// ❷ Following the pattern from dish-media/dish-media.repository.ts
// ❸ Handles database queries for restaurants, restaurant bids, and dish media

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import {
  QueryRestaurantsDto,
  QueryRestaurantDishMediaDto,
} from '@shared/v1/dto';
import { DishMediaEntryEntity } from '../dish-media/dish-media.repository';

export type RestaurantWithMeta = {
  restaurant: PrismaRestaurants;
  meta: { totalCents: number; maxEndDate: string | null };
};

export type RestaurantDishMediaEntry = DishMediaEntryEntity & {
  dish: {
    reviewCount: number;
    averageRating: number;
  };
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

    const rawResult = await this.prisma.prisma.$queryRaw<
      (PrismaRestaurants & {
        total_cents: number;
        max_end_date: string | null;
      })[]
    >`
      SELECT 
        r.*,
        COALESCE(SUM(rb.amount_cents), 0) as total_cents,
        MAX(rb.end_date) as max_end_date,
      FROM restaurants r
      LEFT JOIN restaurant_bids rb ON r.id = rb.restaurant_id 
        AND rb.start_date <= CURRENT_DATE 
        AND rb.end_date > CURRENT_DATE 
        AND rb.status = 'paid'
      WHERE 
        r.latitude BETWEEN ${dto.lat - radiusInDegrees} AND ${dto.lat + radiusInDegrees}
        AND r.longitude BETWEEN ${dto.lng - radiusInDegrees} AND ${dto.lng + radiusInDegrees}
        AND (6371 * acos(cos(radians(${dto.lat})) * cos(radians(r.latitude)) 
            * cos(radians(r.longitude) - radians(${dto.lng})) + sin(radians(${dto.lat})) 
            * sin(radians(r.latitude)))) <= ${radiusInKm}
      GROUP BY r.id
      ORDER BY total_cents DESC
      LIMIT ${dto.limit ?? 20};
    `;

    return rawResult.map((row) => ({
      restaurant: row,
      meta: {
        totalCents: Number(row.total_cents) || 0,
        maxEndDate: row.max_end_date || null,
      },
    }));
  }

  /* ------------------------------------------------------------------ */
  /*               餐厅的菜品媒体查询（按餐厅和类别过滤）                    */
  /* ------------------------------------------------------------------ */
  async findRestaurantByGooglePlaceId(
    google_place_id: string,
  ): Promise<PrismaRestaurants | null> {
    return this.prisma.prisma.restaurants.findUnique({
      where: { google_place_id },
    });
  }

  /* ------------------------------------------------------------------ */
  /*                   餐厅评论统计（数量 + 平均评分）                       */
  /* ------------------------------------------------------------------ */
  async getRestaurantReviewStats(restaurant_id: string) {
    this.logger.debug('GetRestaurantReviewStats', 'getRestaurantReviewStats', {
      restaurant_id,
    });
    const result = await this.prisma.prisma.dish_reviews.aggregate({
      where: {
        dishes: { restaurant_id },
      },
      _count: { _all: true }, // レビュー件数
      _avg: { rating: true }, // rating の平均
    });
    const reviewCount = result._count?._all ?? 0;
    const averageRating = result._avg?.rating ?? 0;

    return {
      reviewCount,
      averageRating,
    };
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
