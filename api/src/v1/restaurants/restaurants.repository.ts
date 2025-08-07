// api/src/v1/restaurants/restaurants.repository.ts
//
// 🎯 目的
//   • Prisma を "1 つのデータ取得 API" として隠蔽し、Service から直アクセスさせない
//   • 地理検索 / レストラン作成 / 入札データ取得 を 1 箇所に集約
//   • 返却は **ドメイン Entity** に近い形（型安全 & Service で再集計不要）
//

import { Injectable } from '@nestjs/common';
import { Prisma, restaurants, restaurant_bids } from '../../../../shared/prisma/client';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import { PrismaDishes } from '../../../../shared/converters/convert_dishes';
import { PrismaDishMedia } from '../../../../shared/converters/convert_dish_media';
import { PrismaDishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { PrismaRestaurantBids } from '../../../../shared/converters/convert_restaurant_bids';

import {
  QueryRestaurantsDto,
  QueryRestaurantDishMediaDto,
  QueryRestaurantBidsDto,
} from '@shared/v1/dto';

import { PrismaService } from '../../prisma/prisma.service';

/* -------------------------------------------------------------------------- */
/*                       返却型 (ドメイン Entity 例)                           */
/* -------------------------------------------------------------------------- */
export interface RestaurantWithBidTotal {
  restaurant: restaurants;
  meta: { totalCents: number };
}

export interface RestaurantDishMediaItem {
  restaurant: restaurants;
  dish: PrismaDishes;
  dish_media: PrismaDishMedia;
  dish_reviews: PrismaDishReviews[];
}

@Injectable()
export class RestaurantsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ------------------------------------------------------------------ */
  /*   1) 座標周辺レストラン、入札状況一覧                               */
  /* ------------------------------------------------------------------ */
  async findRestaurantsWithBidTotals({
    lat,
    lng,
    radius,
    cursor,
  }: QueryRestaurantsDto): Promise<RestaurantWithBidTotal[]> {
    // Haversine 距離 (PostgreSQL + PostGIS) での検索
    // 入札総額も同時に取得
    const meters = radius;

    return this.prisma.$queryRaw<RestaurantWithBidTotal[]>(
      Prisma.sql`
      SELECT
        r.id,
        r.google_place_id,
        r.name,
        r.location,
        r.image_url,
        r.created_at,
        COALESCE(SUM(
          CASE 
            WHEN rb.status = 'confirmed' 
            AND rb.start_date <= CURRENT_DATE 
            AND rb.end_date > CURRENT_DATE 
            THEN rb.amount_cents 
            ELSE 0 
          END
        ), 0) AS total_cents
      FROM restaurants r
        LEFT JOIN restaurant_bids rb ON rb.restaurant_id = r.id
      WHERE
        ST_DistanceSphere(r.location, ST_MakePoint(${lng}, ${lat})) <= ${meters}
        AND (${cursor} IS NULL OR r.id > ${cursor})
      GROUP BY r.id, r.google_place_id, r.name, r.location, r.image_url, r.created_at
      ORDER BY r.id
      LIMIT 50;
    `,
    );
  }

  /* ------------------------------------------------------------------ */
  /*   2) レストラン取得                                                 */
  /* ------------------------------------------------------------------ */
  async findRestaurantById(id: string): Promise<restaurants | null> {
    return this.prisma.restaurants.findUnique({
      where: { id },
    });
  }

  /* ------------------------------------------------------------------ */
  /*   3) Google Place ID でレストラン検索                               */
  /* ------------------------------------------------------------------ */
  async findRestaurantByGooglePlaceId(
    googlePlaceId: string,
  ): Promise<restaurants | null> {
    return this.prisma.restaurants.findUnique({
      where: { google_place_id: googlePlaceId },
    });
  }

  /* ------------------------------------------------------------------ */
  /*   4) レストラン作成                                                 */
  /* ------------------------------------------------------------------ */
  async createRestaurant(data: {
    googlePlaceId: string;
    name: string;
    location: any; // PostGIS geography type
    imageUrl?: string;
  }): Promise<restaurants> {
    // Use raw query since type issues with restaurants create
    const [result] = await this.prisma.$queryRaw<restaurants[]>`
      INSERT INTO restaurants (google_place_id, name, location, image_url)
      VALUES (${data.googlePlaceId}, ${data.name}, ${data.location}, ${data.imageUrl})
      RETURNING *;
    `;
    return result;
  }

  /* ------------------------------------------------------------------ */
  /*   5) レストラン料理投稿一覧                                         */
  /* ------------------------------------------------------------------ */
  async findRestaurantDishMedia(
    restaurantId: string,
    { cursor }: QueryRestaurantDishMediaDto,
  ): Promise<RestaurantDishMediaItem[]> {
    return this.prisma.$queryRaw<RestaurantDishMediaItem[]>(
      Prisma.sql`
      SELECT
        r.id AS restaurant_id,
        r.name AS restaurant_name,
        r.location AS restaurant_location,
        r.image_url AS restaurant_image_url,
        r.created_at AS restaurant_created_at,
        d.id AS dish_id,
        d.name AS dish_name,
        d.category_id,
        dm.id AS dish_media_id,
        dm.media_path,
        dm.media_type,
        dm.thumbnail_path,
        dm.created_at AS dish_media_created_at,
        json_agg(
          json_build_object(
            'id', dr.id,
            'user_id', dr.user_id,
            'rating', dr.rating,
            'comment', dr.comment,
            'price_cents', dr.price_cents,
            'currency_code', dr.currency_code,
            'created_at', dr.created_at
          ) ORDER BY dr.created_at DESC
        ) FILTER (WHERE dr.id IS NOT NULL) AS dish_reviews
      FROM restaurants r
        JOIN dishes d ON d.restaurant_id = r.id
        JOIN dish_media dm ON dm.dish_id = d.id
        LEFT JOIN dish_reviews dr ON dr.dish_id = d.id
      WHERE
        r.id = ${restaurantId}
        AND (${cursor} IS NULL OR dm.id > ${cursor})
      GROUP BY 
        r.id, r.name, r.location, r.image_url, r.created_at,
        d.id, d.name, d.category_id,
        dm.id, dm.media_path, dm.media_type, dm.thumbnail_path, dm.created_at
      ORDER BY 
        (SELECT COUNT(*) FROM dish_likes dl WHERE dl.dish_media_id = dm.id) DESC,
        dm.created_at DESC
      LIMIT 41;
    `,
    );
  }

  /* ------------------------------------------------------------------ */
  /*   6) レストラン入札履歴一覧                                         */
  /* ------------------------------------------------------------------ */
  async findRestaurantBids(
    restaurantId: string,
    { cursor }: QueryRestaurantBidsDto,
  ): Promise<restaurant_bids[]> {
    return this.prisma.restaurant_bids.findMany({
      where: {
        restaurant_id: restaurantId,
        ...(cursor && { id: { gt: cursor } }),
      },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  }
}
