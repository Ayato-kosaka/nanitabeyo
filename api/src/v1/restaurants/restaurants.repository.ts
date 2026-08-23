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
import { QueryRestaurantsDto, QuerySavedRestaurantsDto } from '@shared/v1/dto';
import { DishMediaEntryEntity } from '../dish-media/dish-media.repository';
import { roundToOneDecimal } from '../../core/utils/backend-utils';

export type RestaurantWithMeta = {
  restaurant: PrismaRestaurants;
  meta: {
    reviewCount: number;
    averageRating: number;
    totalCents: number;
    maxEndDate: string | null;
  };
};

export type SavedRestaurantWithMeta = {
  restaurant: PrismaRestaurants;
  meta: {
    reviewCount: number;
    averageRating: number;
    lastSavedAt: Date | null;
  };
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
  /*            近隣かつ「保存済み」のレストランを取得する。            */
  /* ------------------------------------------------------------------ */
  async searchNearbySavedRestaurants(
    dto: QuerySavedRestaurantsDto,
    userId: string,
  ): Promise<SavedRestaurantWithMeta[]> {
    this.logger.debug(
      'SearchNearbySavedRestaurants',
      'searchNearbySavedRestaurants',
      {
        lat: dto.lat,
        lng: dto.lng,
        radius: dto.radius,
        userId,
        limit: dto.limit,
      },
    );

    // 半径（m）→（km）
    const radiusInKm = dto.radius / 1000;
    // 緯度・経度のざっくりとしたバウンディングボックス用の度数（1度 ≒ 111km）
    const radiusInDegrees = radiusInKm / 111;

    // 生 SQL で集計。Prisma のテンプレートタグにより ${} 内はバインドパラメータとして扱われる。
    // - reactions / dish_media / dishes を辿って「保存された dish_media の属するレストラン」を抽出
    // - 保存日時（reactions.created_at）の降順でソート
    // - 距離フィルタは searchNearbyRestaurants と同じロジック（地球半径 6371km の球面三角法）
    const rawResult = await this.prisma.prisma.$queryRaw<
      (Pick<
        PrismaRestaurants,
        | 'id'
        | 'google_place_id'
        | 'name'
        | 'name_language_code'
        | 'latitude'
        | 'longitude'
        | 'image_url'
        | 'image_path'
        | 'address_components'
        | 'plus_code'
        | 'created_at'
      > & {
        review_count: number;
        average_rating: number;
        last_saved_at: Date | null;
      })[]
    >`
    WITH params AS (
      -- クエリ全体で共通して使うパラメータを WITH 句でまとめる
      SELECT
        ${dto.lat}::double precision    AS lat,
        ${dto.lng}::double precision    AS lng,
        ${radiusInKm}::double precision AS radius_km,
        ${userId}::uuid             AS user_id
    ),
    saved_restaurants AS (
      -- ユーザーが「保存」した dish_media 経由でレストランを特定する
      SELECT
        d.restaurant_id,
        -- 同じレストランが複数の dish_media 経由で保存されていても 1 行にまとめる
        MAX(rct.created_at) AS last_saved_at
      FROM reactions rct
      JOIN dish_media dm
        ON rct.target_id::uuid = dm.id
      JOIN dishes d
        ON d.id = dm.dish_id
      JOIN params p
        ON TRUE
      WHERE
        rct.user_id     = p.user_id
        AND rct.action_type = 'save'
        AND rct.target_type = 'dish_media'
      GROUP BY d.restaurant_id
    )
    SELECT
      r.id,
      r.google_place_id,
      r.name,
      r.name_language_code,
      r.latitude,
      r.longitude,
      r.image_url,
      r.image_path,
      r.address_components,
      r.plus_code,
      r.created_at,
      COUNT(dr.id)::int                    AS review_count,
      COALESCE(AVG(dr.rating), 0)::double precision AS average_rating,
      sr.last_saved_at
    FROM saved_restaurants sr
    JOIN restaurants r
      ON r.id = sr.restaurant_id
    JOIN params p
      ON TRUE
    -- レビュー集計用に dishes / dish_reviews を LEFT JOIN
    LEFT JOIN dishes d
      ON d.restaurant_id = r.id
    LEFT JOIN dish_reviews dr
      ON dr.dish_id = d.id
    WHERE
      -- 粗いバウンディングボックスで先に絞り込み（インデックスがあれば活用されやすい）
      r.latitude BETWEEN p.lat - ${radiusInDegrees} AND p.lat + ${radiusInDegrees}
      AND r.longitude BETWEEN p.lng - ${radiusInDegrees} AND p.lng + ${radiusInDegrees}
      -- 正確な距離フィルタ（地球半径 6371km・球面三角法）
      AND (
        6371 * acos(
          cos(radians(p.lat)) * cos(radians(r.latitude))
          * cos(radians(r.longitude) - radians(p.lng))
          + sin(radians(p.lat)) * sin(radians(r.latitude))
        )
      ) <= p.radius_km
    GROUP BY
      r.id,
      sr.last_saved_at
    -- 「保存」日時の新しい順にソート
    ORDER BY
      sr.last_saved_at DESC
    LIMIT ${dto.limit ?? 20}
    OFFSET ${dto.offset ?? 0};
  `;

    // メタ情報を詰め替えてドメイン層で扱いやすい形にして返す
    return rawResult.map((row) => ({
      restaurant: {
        id: row.id,
        google_place_id: row.google_place_id,
        name: row.name,
        name_language_code: row.name_language_code,
        latitude: row.latitude,
        longitude: row.longitude,
        image_url: row.image_url,
        image_path: row.image_path,
        address_components: row.address_components,
        plus_code: row.plus_code,
        created_at: row.created_at,
      },
      meta: {
        reviewCount: row.review_count,
        averageRating: roundToOneDecimal(row.average_rating),
        lastSavedAt: row.last_saved_at,
      },
    }));
  }

  /* ------------------------------------------------------------------ */
  /*                    Restaurant search queries (nearby + bidding status)                    */
  /* ------------------------------------------------------------------ */
  async searchNearbyRestaurants(
    tx: Prisma.TransactionClient,
    // #1375 4 巡目: `orderByDistance` はキャプション住所での照合用。住所は «店そのもの» を
    // 指しているので、入札額順で 100 件に切ると肝心の店が落ちる（独立レビュー指摘 #3）。
    // API の公開 DTO には出さず、サーバ内部の呼び出しだけが指定できる形にしておく
    dto: QueryRestaurantsDto & { orderByDistance?: boolean },
  ): Promise<RestaurantWithMeta[]> {
    this.logger.debug('SearchNearbyRestaurants', 'searchNearbyRestaurants', {
      lat: dto.lat,
      lng: dto.lng,
      radius: dto.radius,
    });

    // Geographic fence query: find restaurants based on latitude/longitude and radius
    const radiusInKm = dto.radius / 1000; // Convert to kilometers
    const radiusInDegrees = radiusInKm / 111; // Rough conversion (1 degree ≈ 111 km)

    // #1395 店名の部分一致（自前 restaurants テーブル。Google Places は呼ばない）。
    // ユーザー入力の % / _ / \ は LIKE のワイルドカードとして解釈されてしまうので、
    // バインドする前にエスケープする（ESCAPE '\' は ILIKE の既定）。
    const nameQuery = dto.q?.trim() ? dto.q.trim() : null;
    const escapedNameQuery = nameQuery
      ? nameQuery.replace(/[\\%_]/g, (c) => `\\${c}`)
      : null;
    const nameFilter = escapedNameQuery
      ? Prisma.sql`AND r.name ILIKE ${'%' + escapedNameQuery + '%'}`
      : Prisma.empty;
    // 店名で絞ったときは入札額順ではなく距離順にする。
    // 店舗選択 UI で「一蘭」と打った結果が入札額で並ぶのは不自然なため
    // 距離式は SELECT に出さない（返却行に余計な列を混ぜないため）。
    // GROUP BY r.id に対して r の列だけから成る式は関数従属なので ORDER BY に直接書ける
    const orderBy =
      escapedNameQuery || dto.orderByDistance
        ? Prisma.sql`ORDER BY (6371 * acos(cos(radians(${dto.lat})) * cos(radians(r.latitude))
            * cos(radians(r.longitude) - radians(${dto.lng})) + sin(radians(${dto.lat}))
            * sin(radians(r.latitude)))) ASC`
        : Prisma.sql`ORDER BY total_cents DESC`;

    const rawResult = await tx.$queryRaw<
      (Pick<
        PrismaRestaurants,
        | 'id'
        | 'google_place_id'
        | 'name'
        | 'name_language_code'
        | 'latitude'
        | 'longitude'
        | 'image_url'
        | 'image_path'
        | 'address_components'
        | 'plus_code'
        | 'created_at'
      > & {
        review_count: number;
        average_rating: number;
        total_cents: number;
        max_end_date: string | null;
      })[]
    >(Prisma.sql`
      SELECT
        r.id,
        r.google_place_id,
        r.name,
        r.name_language_code,
        r.latitude,
        r.longitude,
        r.image_url,
        r.image_path,
        r.address_components,
        r.plus_code,
        r.created_at,
        COALESCE(SUM(rb.amount_cents), 0)::double precision as total_cents,
        MAX(rb.end_date) as max_end_date,
        COUNT(dr.id)::int AS review_count,
        COALESCE(AVG(dr.rating), 0)::double precision AS average_rating
      FROM restaurants r
      LEFT JOIN restaurant_bids rb ON r.id = rb.restaurant_id 
        AND rb.start_date <= CURRENT_DATE 
        AND rb.end_date > CURRENT_DATE 
        AND rb.status = 'paid'
      LEFT JOIN dishes d 
        ON d.restaurant_id = r.id
      LEFT JOIN dish_reviews dr 
        ON dr.dish_id = d.id
      WHERE 
        r.latitude BETWEEN ${dto.lat - radiusInDegrees} AND ${dto.lat + radiusInDegrees}
        AND r.longitude BETWEEN ${dto.lng - radiusInDegrees} AND ${dto.lng + radiusInDegrees}
        AND (6371 * acos(cos(radians(${dto.lat})) * cos(radians(r.latitude)) 
            * cos(radians(r.longitude) - radians(${dto.lng})) + sin(radians(${dto.lat})) 
            * sin(radians(r.latitude)))) <= ${radiusInKm}
        ${nameFilter}
      GROUP BY r.id
      ${orderBy}
      LIMIT ${dto.limit ?? 20};
    `);

    return rawResult.map((row) => ({
      restaurant: row,
      meta: {
        reviewCount: row.review_count,
        averageRating: roundToOneDecimal(row.average_rating),
        totalCents: Number(row.total_cents) || 0,
        maxEndDate: row.max_end_date || null,
      },
    }));
  }

  /* ------------------------------------------------------------------ */
  /*                   Restaurant detail queries (by ID)                    */
  /* ------------------------------------------------------------------ */
  async findRestaurantById(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<PrismaRestaurants | null> {
    return tx.restaurants.findUnique({
      where: { id },
    });
  }

  /* ------------------------------------------------------------------ */
  /*               Restaurant detail queries (by Google Place ID)               */
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
    restaurant_id: string,
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
    const averageRating = roundToOneDecimal(result._avg?.rating ?? 0);

    return {
      reviewCount,
      averageRating,
    };
  }

  /* ------------------------------------------------------------------ */
  /*        Restaurant bid statistics (totalCents + maxEndDate)         */
  /* ------------------------------------------------------------------ */
  async getRestaurantBidStats(
    tx: Prisma.TransactionClient,
    restaurant_id: string,
  ) {
    this.logger.debug('GetRestaurantBidStats', 'getRestaurantBidStats', {
      restaurant_id,
    });

    const result = await tx.restaurant_bids.aggregate({
      where: {
        restaurant_id,
        start_date: { lte: new Date() },
        end_date: { gt: new Date() },
        status: 'paid',
      },
      _sum: { amount_cents: true }, // total amount
      _max: { end_date: true }, // latest end date
    });

    const totalCents = result._sum?.amount_cents
      ? Number(result._sum.amount_cents)
      : 0;
    const maxEndDate = result._max?.end_date ?? null;

    return {
      totalCents,
      maxEndDate,
    };
  }

  /* ------------------------------------------------------------------ */
  /*                          Check if restaurant exists                          */
  /* ------------------------------------------------------------------ */
  async restaurantExists(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<boolean> {
    const count = await tx.restaurants.count({
      where: { id },
    });
    return count > 0;
  }
}
