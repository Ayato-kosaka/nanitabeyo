// api/src/v1/restaurants/restaurants.repository.ts
//
// ❶ Prisma Client を用いた Database Access Layer
// ❂ Repository パターンで SQL クエリを管理
// ❸ Service から呼び出される専用メソッド群
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';

import {
  QueryRestaurantsDto,
} from '@shared/v1/dto';

import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';

@Injectable()
export class RestaurantsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                    GET /v1/restaurants - Query with coordinates   */
  /* ------------------------------------------------------------------ */
  async findRestaurantsWithBidTotals(dto: QueryRestaurantsDto): Promise<any[]> {
    const { lat, lng, radius, cursor } = dto;

    // Using raw SQL for geographic queries as specified in the sequence diagram
    const query = `
      SELECT 
        r.id,
        r.google_place_id,
        r.name,
        r.image_url,
        r.created_at,
        ST_X(r.location::geometry) as lng,
        ST_Y(r.location::geometry) as lat,
        COALESCE(SUM(rb.amount_cents), 0) AS total_cents
      FROM dev.restaurants r
      LEFT JOIN dev.restaurant_bids rb ON r.id = rb.restaurant_id
        AND rb.start_date <= CURRENT_DATE
        AND rb.end_date > CURRENT_DATE  
        AND rb.status = 'paid'
      WHERE ST_DWithin(
        r.location,
        ST_Point($1, $2)::geography,
        $3
      )
      ${cursor ? 'AND r.id > $4' : ''}
      GROUP BY r.id, r.google_place_id, r.name, r.image_url, r.created_at, r.location
      ORDER BY r.id
      LIMIT 41
    `;

    const params = cursor ? [lng, lat, radius, cursor] : [lng, lat, radius];

    return this.prisma.$queryRawUnsafe(query, ...params);
  }

  /* ------------------------------------------------------------------ */
  /*                    POST /v1/restaurants - Create from Google      */
  /* ------------------------------------------------------------------ */
  async findByGooglePlaceId(googlePlaceId: string) {
    return this.prisma.restaurants.findUnique({
      where: { google_place_id: googlePlaceId },
    });
  }

  async createRestaurant(
    tx: Prisma.TransactionClient,
    data: {
      google_place_id: string;
      name: string;
      location: string; // PostGIS POINT format: "lng lat"
      image_url?: string;
    },
  ) {
    // Use $executeRaw for geographic data insertion since location is Unsupported
    const result = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO dev.restaurants (google_place_id, name, location, image_url)
      VALUES (${data.google_place_id}, ${data.name}, ST_Point(${data.location})::geography, ${data.image_url})
      RETURNING id, google_place_id, name, image_url, created_at
    `;
    return result[0];
  }

  /* ------------------------------------------------------------------ */
  /*               GET /v1/restaurants/:id/dish-media                  */
  /* ------------------------------------------------------------------ */
  async findRestaurantDishMedia(
    restaurantId: string,
    cursor?: string,
  ): Promise<any[]> {
    const query = `
      SELECT 
        r.*,
        d.*,
        dm.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', dr.id,
              'comment', dr.comment,
              'rating', dr.rating,
              'price_cents', dr.price_cents,
              'currency_code', dr.currency_code,
              'created_at', dr.created_at
            )
          ) FILTER (WHERE dr.id IS NOT NULL),
          '[]'::json
        ) as dish_reviews
      FROM dev.restaurants r
      INNER JOIN dev.dishes d ON r.id = d.restaurant_id
      INNER JOIN dev.dish_media dm ON d.id = dm.dish_id
      LEFT JOIN dev.dish_reviews dr ON d.id = dr.dish_id
      WHERE r.id = $1
      ${cursor ? 'AND dm.id > $2' : ''}
      GROUP BY r.id, d.id, dm.id
      ORDER BY dm.created_at DESC
      LIMIT 41
    `;

    const params = cursor ? [restaurantId, cursor] : [restaurantId];
    return this.prisma.$queryRawUnsafe(query, ...params);
  }

  /* ------------------------------------------------------------------ */
  /*               GET /v1/restaurants/:id/restaurant-bids             */
  /* ------------------------------------------------------------------ */
  async findRestaurantBids(restaurantId: string, cursor?: string) {
    return this.prisma.restaurant_bids.findMany({
      where: {
        restaurant_id: restaurantId,
        ...(cursor && { id: { gt: cursor } }),
      },
      orderBy: { created_at: 'desc' },
      take: 41,
    });
  }

  /* ------------------------------------------------------------------ */
  /*                    GET /v1/restaurants/:id                        */
  /* ------------------------------------------------------------------ */
  async findRestaurantById(id: string) {
    return this.prisma.restaurants.findUnique({
      where: { id },
    });
  }

  /* ------------------------------------------------------------------ */
  /*               Helper: Check if restaurant exists                  */
  /* ------------------------------------------------------------------ */
  async restaurantExists(id: string): Promise<boolean> {
    const count = await this.prisma.restaurants.count({
      where: { id },
    });
    return count > 0;
  }
}
