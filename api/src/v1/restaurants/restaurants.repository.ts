// api/src/v1/restaurants/restaurants.repository.ts
//
// ❶ Repository for restaurants domain - database operations
// ❷ Following the pattern from dish-media/dish-media.repository.ts
// ❸ Handles database queries for restaurants, restaurant bids, and dish media

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import { Prisma } from '../../../../shared/prisma/client';
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
  /*                    Restaurant search queries (nearby + bidding status)                    */
  /* ------------------------------------------------------------------ */
  async searchNearbyRestaurants(
    tx: Prisma.TransactionClient,
    dto: QueryRestaurantsDto,
  ): Promise<RestaurantWithMeta[]> {
    this.logger.debug('SearchNearbyRestaurants', 'searchNearbyRestaurants', {
      lat: dto.lat,
      lng: dto.lng,
      radius: dto.radius,
    });

    // Geographic fence query: find restaurants based on latitude/longitude and radius
    const radiusInKm = dto.radius / 1000; // Convert to kilometers
    const radiusInDegrees = radiusInKm / 111; // Rough conversion (1 degree ≈ 111 km)

    const rawResult = await tx.$queryRaw<
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
  /*               Restaurant dish media queries (filter by restaurant and category)                    */
  /* ------------------------------------------------------------------ */
  async findRestaurantByGooglePlaceId(
    tx: Prisma.TransactionClient,
    google_place_id: string,
  ): Promise<PrismaRestaurants | null> {
    return tx.restaurants.findUnique({
      where: { google_place_id },
    });
  }

  /* ------------------------------------------------------------------ */
  /*                   Restaurant review statistics (count + average rating)                       */
  /* ------------------------------------------------------------------ */
  async getRestaurantReviewStats(
    tx: Prisma.TransactionClient, 
    restaurant_id: string
  ) {
    this.logger.debug('GetRestaurantReviewStats', 'getRestaurantReviewStats', {
      restaurant_id,
    });
    const result = await tx.dish_reviews.aggregate({
      where: {
        dishes: { restaurant_id },
      },
      _count: { _all: true }, // Review count
      _avg: { rating: true }, // Average rating
    });
    const reviewCount = result._count?._all ?? 0;
    const averageRating = result._avg?.rating ?? 0;

    return {
      reviewCount,
      averageRating,
    };
  }

  /* ------------------------------------------------------------------ */
  /*                          Check if restaurant exists                          */
  /* ------------------------------------------------------------------ */
  async restaurantExists(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
    const count = await tx.restaurants.count({
      where: { id },
    });
    return count > 0;
  }
}
