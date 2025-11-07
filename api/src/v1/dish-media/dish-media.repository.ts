// api/src/modules/dish-media/dish-media.repository.ts
//
// 🎯 目的
//   • Prisma を “1 つのデータ取得 API” として隠蔽し、Service から直アクセスさせない
//   • 地理検索 / 重複チェック / トランザクション更新 を 1 箇所に集約
//   • 返却は **ドメイン Entity** に近い形（型安全 & Service で再集計不要）
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import { PrismaDishes } from '../../../../shared/converters/convert_dishes';
import { PrismaDishMedia } from '../../../../shared/converters/convert_dish_media';
import { PrismaDishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { PrismaDishMediaViews } from '../../../../shared/converters/convert_dish_media_views';
import { PrismaDishMediaImpressions } from '../../../../shared/converters/convert_dish_media_impressions';
import { PrismaDishMediaAnalysisResults } from '../../../../shared/converters/convert_dish_media_analysis_results';
import { AppLoggerService } from 'src/core/logger/logger.service';

import {
  CreateDishMediaDto,
  SearchDishMediaDto,
  QueryRestaurantDishMediaDto,
  ReactionActionType,
} from '@shared/v1/dto';

import { PrismaService } from '../../prisma/prisma.service';
import { roundToOneDecimal, shuffle } from '../../core/utils/backend-utils';
import { CLS_KEY_APP_VERSION } from 'src/core/cls/cls.constants';
import { ClsService } from 'nestjs-cls';

/* -------------------------------------------------------------------------- */
/*                       返却型 (ドメイン Entity 例)                           */
/* -------------------------------------------------------------------------- */
export interface DishMediaEntryEntity {
  restaurant: PrismaRestaurants;
  dish: PrismaDishes & {
    reviewCount: number;
    averageRating: number;
  };
  dish_media: PrismaDishMedia & {
    isSaved: boolean;
    isLiked: boolean;
    likeCount: number;
  };
  dish_reviews: (PrismaDishReviews & {
    username: string;
    isLiked: boolean;
    likeCount: number;
  })[];
}

@Injectable()
export class DishMediaRepository {
  private readonly reactionKey = (type: string, id: string, action: string) =>
    `${type}:${id}:${action}`;
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly cls: ClsService,
  ) { }

  /* ------------------------------------------------------------------ */
  /*   料理メディアを位置 + カテゴリ + 未閲覧 で取得（返却数固定）    */
  /* ------------------------------------------------------------------ */
  async findDishMediaIds(
    tx: Prisma.TransactionClient,
    { location, radius, categoryId, limit = 5 }: SearchDishMediaDto,
    userId: string,
  ): Promise<string[]> {
    // Haversine 距離 (PostgreSQL + PostGIS) の簡易例
    // RAW を使うときはバインド変数で SQL Injection を防止
    const [userLat, userLon] = location.split(',').map(Number);
    const nowTs = new Date().toISOString();
    const pageSeed = crypto.randomUUID(); // ランダム順序を毎回ランダムにしたい。

    const GUMBLE_TAU = 0.216; // 0.3–0.5 * σ（base_score の標準偏差）で後で調整する
    const NEW_MAX = Math.max(1, Math.round(limit / 5)); // 新着枠の最大件数
    const REGIONAL_MAX = limit - NEW_MAX; // 地域人気枠の最大件数

    const rows = await tx.$queryRaw<
      Array<{
        bucket: 'new' | 'regional';
        dish_media_id: string;
        dish_id: string;
        restaurant_id: string;
        distance_km: number;
        is_open_at: boolean;
        base_score: number;
        noisy_score: number;
        rank_in_bucket: number;
        impr_total: number;
        view_total: number;
        skip_total: number;
        save_total: number;
        like_total: number;
        open_map_total: number;
        avg_watch_rate: number | null;
        skip_rate: number | null;
        save_rate: number | null;
        like_rate: number | null;
        open_map_rate: number | null;
        created_at: string;
      }>
    >`
    WITH
    -- ========== パラメタ ==========
    params AS (
      SELECT
        CAST(${userId}  AS uuid)   AS user_id,
        CAST(${userLat}  AS double precision) AS user_lat,
        CAST(${userLon}  AS double precision) AS user_lon,
        CAST(${radius}  AS double precision) AS radius_m,
        -- CAST(${'openAt'}  AS timestamptz)      AS open_at,
        CAST(${categoryId}  AS text)           AS category_id,
        -- CAST(${'priceMin'}  AS numeric)          AS price_min,
        -- CAST(${'priceMax'}  AS numeric)          AS price_max,
        CAST(${limit} AS integer) AS limit_count,
        CAST(${GUMBLE_TAU}  AS double precision) AS gumbel_tau, -- ランキングに “ゆらぎ（探索）” をどれだけ入れるかの強さ。
        CAST(${pageSeed}  AS text)             AS page_seed,
        CAST(${nowTs}  AS timestamptz)      AS now_ts,
        -- geography のユーザ位置
        ST_SetSRID(ST_MakePoint(${userLon}, ${userLat}), 4326)::geography AS user_geog,
        -- 距離減衰パラメタ
        GREATEST(2.0, 0.3 * (${radius}::double precision / 1000.0)) AS d0,
        -- 最大 KNN 候補数
        GREATEST(1000, 50 * CAST(${limit} AS integer)) AS knn_limit
    ),
    -- ========== 重み ==========
    weights AS (
      SELECT
        1.00 AS w_skip_rate,
        1.20 AS w_avg_watch_rate,
        1.40 AS w_save_rate,
        1.30 AS w_open_map_rate,
        0.60 AS w_like_rate,
        0.50 AS w_is_open_at,
        0.30 AS w_distance,
        0.50 AS w_impr_total
    ),
    -- ========== 候補集合（Stage0: 地理フィルタ） ==========
    candidates_radius AS (
      SELECT
        r.id AS restaurant_id,
        r.location AS rest_geog
      FROM restaurants r
      WHERE ST_DWithin(
              r.location,
              (SELECT user_geog FROM params),
              (SELECT radius_m FROM params)
            )
    ),
    nearby_restaurants AS (
      SELECT cr.restaurant_id, cr.rest_geog
      FROM candidates_radius cr
      ORDER BY cr.rest_geog <-> (SELECT user_geog FROM params)  -- KNN
      LIMIT (SELECT knn_limit FROM params)
    ),
    -- ========== 候補集合（Stage0: ハードフィルタ） ==========
    base_candidates AS (
      SELECT
        dm.id            AS dish_media_id,
        dm.dish_id       AS dish_id,
        d.restaurant_id  AS restaurant_id,
        d.category_id    AS category_id,
        nr.rest_geog     AS rest_geog,
        dm.created_at    AS media_created_at,
        dm.video_duration_ms
      FROM nearby_restaurants nr
      JOIN dishes d      ON d.restaurant_id = nr.restaurant_id
      JOIN dish_media dm ON dm.dish_id      = d.id
      -- 価格帯の絞り込みはMVPでは未対応
      WHERE 1=1
        -- カテゴリ
        AND d.category_id = (SELECT category_id FROM params) 
    ),
    -- 距離計算
    geo AS (
      SELECT
        bc.*,
        ST_Distance(
          bc.rest_geog,
          (SELECT user_geog FROM params)
        ) / 1000.0 AS distance_km
      FROM base_candidates bc
    ),
    -- 営業時間（あればフィルタ・無ければ true）
    open_flags AS (
      SELECT
        g.*,
        /* ▼ 営業時間テーブルがある場合の例
        EXISTS (
          SELECT 1 FROM restaurant_open_hours roh
          WHERE roh.restaurant_id = g.restaurant_id
            AND roh.opens_at <= (SELECT open_at FROM params)
            AND roh.closes_at >  (SELECT open_at FROM params)
        ) AS is_open_at
        */
        FALSE AS is_open_at
      FROM geo g
    ),
    -- 疲労EXISTS除外（同一メディアを直近24h出さない）
    fatigue_filtered AS (
      SELECT ofl.*
      FROM open_flags ofl
      WHERE NOT EXISTS (
        SELECT 1
        FROM dish_media_impressions dmi
        WHERE dmi.dish_media_id = ofl.dish_media_id
          AND (SELECT user_id FROM params) IS NOT NULL
          AND dmi.user_id = (SELECT user_id FROM params)
          AND dmi.created_at >= (SELECT now_ts FROM params) - INTERVAL '24 hours'
      )
    ),
    -- ========== 指標結合（Stage2: Pre-Rank特徴） ==========
    features AS (
      SELECT
        ff.*,
        ar.impr_total, ar.view_total, ar.skip_total, ar.completion_total,
        ar.watch_ms_total, ar.save_total, ar.like_total, ar.open_map_total,
        -- レート（イプシロン平滑）
        CASE
          WHEN ar.impr_total > 0 AND ff.video_duration_ms > 0
            THEN LEAST(1.0, GREATEST(0.0, ar.watch_ms_total::double precision
                        / (ar.impr_total::double precision * ff.video_duration_ms::double precision)))
          ELSE NULL
        END AS avg_watch_rate,
        CASE WHEN ar.view_total > 0
          THEN LEAST(1.0, GREATEST(0.0, ar.skip_total::double precision / ar.view_total::double precision))
          ELSE NULL
        END AS skip_rate,
        CASE WHEN ar.impr_total > 0
          THEN ar.save_total::double precision     / ar.impr_total::double precision
          ELSE NULL
        END AS save_rate,
        CASE WHEN ar.impr_total > 0
          THEN ar.like_total::double precision     / ar.impr_total::double precision
          ELSE NULL
        END AS like_rate,
        CASE WHEN ar.impr_total > 0
          THEN ar.open_map_total::double precision / ar.impr_total::double precision
          ELSE NULL
        END AS open_map_rate
      FROM fatigue_filtered ff
      LEFT JOIN dish_media_analysis_results ar
        ON ar.dish_media_id = ff.dish_media_id
    ),
    -- ========== Pre-Rank スコア（軽量式） ==========
    pre_rank AS (
      SELECT
        f.*,
        0.30 * EXP(- f.distance_km / (SELECT d0 FROM params)) AS distance_contrib,
        (
          -- w1*(1 - skip_rate) + w2*avg_watch_rate + w3*save_rate + w4*open_map_rate + w5*like_rate
          (SELECT w_skip_rate FROM weights) * COALESCE(1.0 - f.skip_rate, 0.5) +
          (SELECT w_avg_watch_rate FROM weights) * COALESCE(f.avg_watch_rate, 0.2) +
          (SELECT w_save_rate FROM weights) * COALESCE(f.save_rate, 0.01) +
          (SELECT w_open_map_rate FROM weights) * COALESCE(f.open_map_rate, 0.01) +
          (SELECT w_like_rate FROM weights) * COALESCE(f.like_rate, 0.02) +
          (SELECT w_is_open_at FROM weights) * (CASE WHEN f.is_open_at THEN 1 ELSE 0 END) +
          (SELECT w_distance FROM weights) * EXP(- f.distance_km / (SELECT d0 FROM params)) +
          -- impr_total が少ない場合、正しくない可能性があるので、優先表示する。
          CASE
            WHEN COALESCE(f.impr_total, 0) < 15 THEN (SELECT w_impr_total FROM weights)
            ELSE 0.0
          END
        ) AS base_score
      FROM features f
    ),
    -- ========== 新着/地域 人気 のバケット分け ==========
    bucketed AS (
      SELECT
        pr.*,
        CASE
          WHEN 1 = 1
               -- AND pr.media_created_at >= (SELECT now_ts FROM params) - INTERVAL '7 days' -- 期間条件はユーザが集まるまで外す
               AND COALESCE(pr.impr_total,0) < 100 THEN 'new'
          ELSE 'regional'
        END AS bucket
      FROM pre_rank pr
    ),
    -- ========== バケット毎に上位抽出 ==========
    pre_top_each AS (
      SELECT *
      FROM (
        SELECT
          b.*,
          ROW_NUMBER() OVER (PARTITION BY b.bucket ORDER BY b.base_score DESC, b.dish_media_id) AS rk_pre
        FROM bucketed b
      ) t
      WHERE (t.bucket = 'new'      AND t.rk_pre <= 100)
         OR (t.bucket = 'regional' AND t.rk_pre <= 500)
    ),
    -- ========== 同店一意（Stage4: Re-Rank のハード制約部分） ==========
    unique_per_restaurant AS (
      SELECT *
      FROM (
        SELECT
          p.*,
          ROW_NUMBER() OVER (
            PARTITION BY p.bucket, p.restaurant_id
            ORDER BY p.base_score DESC, p.dish_media_id
          ) AS rn_rest
        FROM pre_top_each p
      ) z
      WHERE z.rn_rest = 1
    ),
    
    -- ========== Gumbel ノイズ付与（Stage5: ページ組成の揺らし） ==========
    noisy AS (
      SELECT
        u.*,
        -- 安定乱数（userId+mediaId+seed）→ [0,1) → Gumbel
        (
          -- 0..1 の一様乱数（md5の先頭8桁→32bit→double）
          GREATEST(1e-9, LEAST(0.999999999,
            (
              (('x'||SUBSTR(md5( (SELECT page_seed FROM params) || ':' || COALESCE((SELECT user_id FROM params)::text,'anon') || ':' || u.dish_media_id::text ),1,8))::bit(32))::int
            ) / 4294967296.0
          ))
        ) AS u01,
        (SELECT gumbel_tau FROM params) AS tau
      FROM unique_per_restaurant u
    ),
    noisy_scored AS (
      SELECT
        n.*,
        (n.base_score + n.tau * (-LN(-LN(n.u01)))) AS noisy_score
      FROM noisy n
    ),
    -- ========== バケット毎に上位5を抽出 ==========
    topk_each AS (
      SELECT *
      FROM (
        SELECT
          ns.*,
          ROW_NUMBER() OVER (PARTITION BY ns.bucket ORDER BY ns.noisy_score DESC, ns.base_score DESC, ns.dish_media_id) AS rk
        FROM noisy_scored ns
      ) q
      WHERE q.rk <= (SELECT limit_count FROM params)
    )
    SELECT
      bucket,
      dish_media_id,
      dish_id,
      restaurant_id,
      distance_km,
      is_open_at,
      base_score,
      noisy_score,
      (rk)::int AS rank_in_bucket,
      (impr_total)::int     AS impr_total,
      (view_total)::int     AS view_total,
      (skip_total)::int     AS skip_total,
      (save_total)::int     AS save_total,
      (like_total)::int     AS like_total,
      (open_map_total)::int AS open_map_total,
      avg_watch_rate, skip_rate, save_rate, like_rate, open_map_rate,
      media_created_at AS created_at
    FROM topk_each
    ORDER BY bucket, rank_in_bucket;
    `;

    this.logger.debug('findDishMediaIdsResult', 'findDishMediaIds', rows);

    // rows の bucket を見て、新着1件、地域人気4件 に分ける。（但し、片方が不足する場合は、もう片方で補完）
    const newQueue = rows
      .filter((r) => r.bucket === 'new')
      .map((r) => r.dish_media_id);
    const regionalQueue = rows
      .filter((r) => r.bucket === 'regional')
      .map((r) => r.dish_media_id);
    const resultDishMediaIds: string[] = [];
    // Helper: キューから n 件取り出す
    const takeFrom = <T>(q: T[], n: number) => {
      const picked: T[] = [];
      while (picked.length < n && q.length > 0) {
        picked.push(q.shift()!); // 先頭を“消費”して重複回避
      }
      return picked;
    };
    // new から最大 NEW_MAX 件取り出す
    const newPicked = takeFrom(newQueue, NEW_MAX);
    resultDishMediaIds.push(...newPicked);
    // new 不足なら regional で補完
    if (newPicked.length < NEW_MAX) {
      const deficit = NEW_MAX - newPicked.length;
      resultDishMediaIds.push(...takeFrom(regionalQueue, deficit));
    }
    // regional から最大 REGIONAL_MAX 件取り出す
    const regionalPicked = takeFrom(regionalQueue, REGIONAL_MAX);
    resultDishMediaIds.push(...regionalPicked);
    // regional 不足なら new で補完
    if (regionalPicked.length < REGIONAL_MAX) {
      const deficit = REGIONAL_MAX - regionalPicked.length;
      resultDishMediaIds.push(...takeFrom(newQueue, deficit));
    }

    // 抽出された dishMediaIds をランダム順にして返す
    return shuffle(resultDishMediaIds);
  }

  /* ------------------------------------------------------------------ */
  /*    レストランの料理メディアを取得（各料理のメディア1件、いいね数が最大のもの） */
  /* ------------------------------------------------------------------ */
  async findDishMediaByRestaurant(
    tx: Prisma.TransactionClient,
    restaurantId: string,
    { limit = 42, cursor: cursorStr }: QueryRestaurantDishMediaDto,
  ) {
    const cursor = cursorStr
      ? {
        likeCount: Number(cursorStr.split('_')[0]),
        mediaId: cursorStr.split('_')[1],
      }
      : null;
    const cursorWhere = cursor
      ? Prisma.sql`
          AND (
            ranked.like_count < ${cursor.likeCount}
            OR (ranked.like_count = ${cursor.likeCount} AND ranked.dish_media_id < ${cursor.mediaId})
          )
        `
      : Prisma.empty;

    const rows = await tx.$queryRaw<
      { dish_media_id: string; dish_id: string; like_count: number }[]
    >(Prisma.sql`
      WITH media_like_counts AS (
        SELECT
          dm.id        AS dish_media_id,
          dm.dish_id   AS dish_id,
          COUNT(dml.id) AS like_count
        FROM dish_media dm
        JOIN dishes d
          ON d.id = dm.dish_id
        LEFT JOIN dish_media_likes dml
          ON dml.dish_media_id = dm.id
        WHERE d.restaurant_id = ${restaurantId}::uuid
        GROUP BY dm.id, dm.dish_id
      ),
      ranked AS (
        SELECT
          mlc.*,
          ROW_NUMBER() OVER (
            PARTITION BY mlc.dish_id
            ORDER BY mlc.like_count DESC, mlc.dish_media_id DESC
          ) AS rn
        FROM media_like_counts mlc
      )
      SELECT
        ranked.dish_media_id,
        ranked.dish_id,
        ranked.like_count
      FROM ranked
      WHERE ranked.rn = 1
        ${cursorWhere}
      ORDER BY ranked.like_count DESC, ranked.dish_media_id DESC
      LIMIT ${limit};
    `);

    // 次ページ用カーソル（取得できた最後の行の複合キーをそのまま返す）
    const last = rows[rows.length - 1];
    const nextCursor: string | null = last
      ? `${last.like_count}_${last.dish_media_id}`
      : null;

    return { items: rows, nextCursor };
  }

  /* ------------------------------------------------------------------ */
  /*   ユーザーがレビューした料理レビューを取得する                     */
  /* ------------------------------------------------------------------ */
  async findDishReviewsByUser(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<DishMediaEntryEntity['dish_reviews']> {
    this.logger.debug(
      'FindDishMediaEntryByReviewedUser',
      'findDishMediaEntryByReviewedUser',
      {
        userId,
        cursor,
        limit,
      },
    );

    const whereClause: any = {
      user_id: userId,
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const reviews = await this.prisma.prisma.dish_reviews.findMany({
      where: whereClause,
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        users: true,
      },
    });

    const { reactionSet, reviewLikeCountMap } =
      await this.buildReactionAggregates(
        reviews.map((review) => review.created_dish_media_id),
        reviews.map((review) => review.id),
        userId,
      );

    return reviews.map((review) => ({
      ...review,
      username:
        review.imported_user_name ?? review.users?.display_name ?? 'unknown',
      isLiked: reactionSet.has(
        this.reactionKey('dish_reviews', review.id, 'like'),
      ),
      likeCount: reviewLikeCountMap.get(review.id) ?? 0,
    }));
  }

  /* ------------------------------------------------------------------ */
  /*        ユーザーが「いいね」した dish_media を取得                 */
  /* ------------------------------------------------------------------ */
  async findDishMediaByLikedUser(
    userId: string,
    isAnonymous: boolean,
    cursor?: string,
    limit = 42,
  ): Promise<{ dish_media_id: string; created_at: Date }[]> {
    this.logger.debug('findDishMediaByLikedUser', 'findDishMediaByLikedUser', {
      userId,
      cursor,
      isAnonymous,
      limit,
    });

    let result: { dish_media_id: string; created_at: Date }[] = [];
    if (isAnonymous) {
      // 匿名ユーザーの場合は reactions テーブルから取得
      const whereClause: Prisma.reactionsWhereInput = {
        user_id: userId,
        target_type: 'dish_media',
        action_type: 'like',
      };
      if (cursor) {
        whereClause.created_at = { lt: new Date(cursor) };
      }

      const likes = await this.prisma.prisma.reactions.findMany({
        where: whereClause,
        orderBy: { created_at: 'desc' },
        take: limit,
        select: { target_id: true, created_at: true },
      });

      result = likes.map((r) => ({
        dish_media_id: r.target_id,
        created_at: r.created_at,
      }));
    } else {
      // 通常ユーザーの場合は dish_media_likes テーブルから取得
      const whereClause: Prisma.dish_media_likesWhereInput = {
        user_id: userId,
      };
      if (cursor) {
        whereClause.created_at = { lt: new Date(cursor) };
      }

      const likes = await this.prisma.prisma.dish_media_likes.findMany({
        where: whereClause,
        orderBy: { created_at: 'desc' },
        take: limit,
        select: { dish_media_id: true, created_at: true },
      });

      result = likes.map((r) => ({
        dish_media_id: r.dish_media_id,
        created_at: r.created_at,
      }));
    }

    this.logger.debug(
      'findDishMediaByLikedUserResult',
      'findDishMediaByLikedUser',
      { count: result.length },
    );

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*        ユーザーが「保存」した dish_media を取得                  */
  /* ------------------------------------------------------------------ */
  async findDishMediaBySavedUser(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{ dish_media_id: string; created_at: Date }[]> {
    this.logger.debug('findDishMediaBySavedUser', 'findDishMediaBySavedUser', {
      userId,
      cursor,
      limit,
    });

    const whereClause: any = {
      user_id: userId,
      target_type: 'dish_media',
      action_type: 'save',
    };
    if (cursor) {
      whereClause.created_at = { lt: new Date(cursor) };
    }

    const saves = await this.prisma.prisma.reactions.findMany({
      where: whereClause,
      orderBy: { created_at: 'desc' },
      take: limit,
      select: { target_id: true, created_at: true },
    });

    const result = saves.map((r) => ({
      dish_media_id: r.target_id,
      created_at: r.created_at,
    }));

    this.logger.debug(
      'findDishMediaBySavedUserResult',
      'findDishMediaBySavedUser',
      { count: result.length },
    );

    return result;
  }

  /**
   * dishMediaIds から DishMediaEntryEntity 配列を構築
   *  - dish_media 本体 / dishes.restaurants
   *  - user の like/save 状態 (dish_media_likes + reactions)
   *  - review の like 状態 & likeCount
   *  - 順序は入力 dishMediaIds の順を維持
   */
  async getDishMediaEntriesByIds(
    dishMediaIds: string[],
    option: {
      userId?: string;
      reviewLimit?: number;
    },
  ): Promise<DishMediaEntryEntity[]> {
    const { userId, reviewLimit = 6 } = option;
    if (dishMediaIds.length === 0) return [];

    const dishMedias = await this.prisma.prisma.dish_media.findMany({
      where: { id: { in: dishMediaIds } },
      include: {
        dish_media_likes: { where: { user_id: userId } }, // User がいいねしているか
        _count: { select: { dish_media_likes: true } }, // いいね数を取得
        dishes: {
          include: {
            restaurants: true,
            dish_reviews: {
              orderBy: { created_at: 'desc' },
              take: reviewLimit,
              include: { users: true },
            },
          },
        },
      },
    });

    // Get all dish IDs to calculate aggregates
    const dishIds = dishMedias.map((m) => m.dish_id);

    // Calculate review count and average rating per dish
    const avgByDish = await this.prisma.prisma.dish_reviews.groupBy({
      by: ['dish_id'],
      where: { dish_id: { in: dishIds } },
      _avg: { rating: true },
      _count: { dish_id: true },
    });

    const dishStatsMap = new Map<
      string,
      { averageRating: number; reviewCount: number }
    >(
      avgByDish.map((row) => {
        const avg = row._avg.rating ?? 0;
        return [
          row.dish_id,
          {
            averageRating: roundToOneDecimal(avg), // ROUND(AVG, 1)
            reviewCount: row._count.dish_id,
          },
        ];
      }),
    );

    const dishMediaMap = new Map(dishMedias.map((m) => [m.id, m]));
    const allReviewIds = dishMedias.flatMap((m) =>
      m.dishes.dish_reviews.map((r) => r.id),
    );

    const { reactionSet, reviewLikeCountMap } =
      await this.buildReactionAggregates(dishMediaIds, allReviewIds, userId);

    return dishMediaIds
      .filter((dishMediaId) => {
        const dishMedia = dishMediaMap.get(dishMediaId);
        if (!dishMedia) {
          this.logger.warn('DishMediaNotFound', 'getDishMediaEntriesByIds', {
            dishMediaId,
          });
          return false;
        }
        return true;
      }) //
      .map((dishMediaId) => {
        const dishMedia = dishMediaMap.get(dishMediaId)!;
        const dishStats = dishStatsMap.get(dishMedia.dish_id);
        const dishReviews = dishMedia.dishes.dish_reviews;

        return {
          restaurant: dishMedia.dishes.restaurants,
          dish: {
            ...dishMedia.dishes,
            reviewCount: dishStats?.reviewCount ?? 0,
            averageRating: dishStats?.averageRating ?? 0,
          },
          dish_media: {
            ...(dishMedia as PrismaDishMedia),
            isSaved: reactionSet.has(
              this.reactionKey('dish_media', dishMedia.id, 'save'),
            ),
            isLiked:
              dishMedia.dish_media_likes.length > 0 ||
              reactionSet.has(
                this.reactionKey('dish_media', dishMedia.id, 'like'),
              ),
            likeCount: dishMedia._count.dish_media_likes, // 【設計】likeCount に reactions(匿名ユーザー)は含めない
          },
          dish_reviews: dishReviews.map((review) => ({
            ...review,
            username:
              review.imported_user_name ??
              review.users?.display_name ??
              'unknown',
            isLiked: reactionSet.has(
              this.reactionKey('dish_reviews', review.id, 'like'),
            ),
            likeCount: reviewLikeCountMap.get(review.id) ?? 0,
          })),
        };
      });
  }

  // --- new helper ---
  private async buildReactionAggregates(
    dishMediaIds: string[],
    reviewIds: string[],
    userId?: string,
  ): Promise<{
    reactionSet: Set<string>;
    reviewLikeCountMap: Map<string, number>;
  }> {
    const reviewLikeCounts = reviewIds.length
      ? await this.prisma.prisma.reactions.groupBy({
        by: ['target_id'],
        where: {
          target_type: 'dish_reviews',
          target_id: { in: reviewIds },
          action_type: 'like',
        },
        _count: { target_id: true },
      })
      : [];
    const reviewLikeCountMap = new Map(
      reviewLikeCounts.map((r) => [r.target_id, r._count.target_id]),
    );

    if (!userId) {
      return {
        reactionSet: new Set<string>(),
        reviewLikeCountMap,
      };
    }

    const targetIds = [...dishMediaIds, ...reviewIds];
    const userReactions = targetIds.length
      ? await this.prisma.prisma.reactions.findMany({
        where: {
          user_id: userId,
          target_id: { in: targetIds },
        },
        select: { target_type: true, target_id: true, action_type: true },
      })
      : [];
    const reactionSet = new Set(
      userReactions.map((r) =>
        this.reactionKey(r.target_type, r.target_id, r.action_type),
      ),
    );

    return { reactionSet, reviewLikeCountMap };
  }

  /* ------------------------------------------------------------------ */
  /*                            Dish 存在確認                        */
  /* ------------------------------------------------------------------ */
  async dishExists(dishId: string): Promise<boolean> {
    const cnt = await this.prisma.prisma.dishes.count({
      where: { id: dishId },
    });
    return cnt > 0;
  }

  /* ------------------------------------------------------------------ */
  /*        dish_media 投稿 (トランザクション内で呼び出し)           */
  /* ------------------------------------------------------------------ */
  async createDishMedia(
    tx: Prisma.TransactionClient,
    dto: CreateDishMediaDto,
    creatorId: string,
    thumbnailPath: string,
  ) {
    // 画像は既に Storage へアップ済みとして mediaPath を受け取る
    const newMedia = await tx.dish_media.create({
      data: {
        dish_id: dto.dishId,
        user_id: creatorId,
        media_path: dto.mediaPath,
        media_type: dto.mediaType,
        thumbnail_path: thumbnailPath,
        video_duration_ms: dto.videoDurationMs,
      },
    });

    return newMedia;
  }

  /* ------------------------------------------------------------------ */
  /*        dish_media_views 作成 + dish_media_analysis_results 更新   */
  /* ------------------------------------------------------------------ */
  async createDishMediaView(
    tx: Prisma.TransactionClient,
    data: Omit<PrismaDishMediaViews, 'id'>,
  ) {
    // 1. dish_media_views を一件挿入
    const view = await tx.dish_media_views.create({ data });

    // 2. dish_media_analysis_results を更新または挿入
    await tx.dish_media_analysis_results.upsert({
      where: { dish_media_id: data.dish_media_id },
      create: {
        dish_media_id: data.dish_media_id,
        impr_total: BigInt(0),
        view_total: BigInt(1),
        skip_total: data.is_skipped ? BigInt(1) : BigInt(0),
        completion_total: data.is_completed ? BigInt(1) : BigInt(0),
        watch_ms_total: BigInt(data.watch_ms),
        save_total: BigInt(0),
        like_total: BigInt(0),
        open_map_total: BigInt(0),
        created_at: new Date(),
        updated_at: new Date(),
      },
      update: {
        view_total: { increment: BigInt(1) },
        skip_total: data.is_skipped ? { increment: BigInt(1) } : undefined,
        completion_total: data.is_completed
          ? { increment: BigInt(1) }
          : undefined,
        watch_ms_total: { increment: BigInt(data.watch_ms) },
        updated_at: new Date(),
      },
    });

    return view;
  }

  /**
   * Reaction の追加・削除を切り替え、analysis_results を増減分更新
   * @param tx トランザクションクライアント
   * @param willReact 追加(true) or 削除(false)
   * @param isAnonymous 匿名ユーザーかどうか
   * @param reaction Reaction 情報
   */
  async toggleReaction(
    tx: Prisma.TransactionClient,
    willReact: boolean,
    isAnonymous: boolean,
    reaction: {
      user_id: string;
      target_id: string;
      action_type: ReactionActionType;
    },
  ): Promise<void> {
    if (reaction.action_type === 'like' && !isAnonymous) {
      // like の場合、認証ユーザーは dish_media_likes を操作
      if (willReact) {
        // 既に存在する場合はエラーとする。dish_media_analysis_results の冪等性を保証するため。
        await tx.dish_media_likes.create({
          data: {
            dish_media_id: reaction.target_id,
            user_id: reaction.user_id,
          },
        });
      } else {
        // 存在しない場合はエラーとする。dish_media_analysis_results の冪等性を保証するため。
        await tx.dish_media_likes.delete({
          where: {
            dish_media_id_user_id: {
              dish_media_id: reaction.target_id,
              user_id: reaction.user_id,
            },
          },
        });
      }
    } else {
      // save / open_map の場合、または匿名ユーザーの like は reactions を操作
      if (willReact) {
        const appVersion = this.cls.get<string>(CLS_KEY_APP_VERSION) ?? 'unknown';
        await tx.reactions.create({
          data: {
            user_id: reaction.user_id,
            target_type: 'dish_media',
            target_id: reaction.target_id,
            action_type: reaction.action_type,
            created_at: new Date(),
            created_version: appVersion,
            lock_no: 0,
          },
        });
      } else {
        await tx.reactions.delete({
          where: {
            user_id_target_type_target_id_action_type: {
              user_id: reaction.user_id,
              target_type: 'dish_media',
              target_id: reaction.target_id,
              action_type: reaction.action_type,
            },
          },
        });
      }
    }

    // dish_media_analysis_results を更新または挿入
    const columnMap: Record<
      ReactionActionType,
      keyof PrismaDishMediaAnalysisResults
    > = {
      save: 'save_total',
      like: 'like_total',
      open_map: 'open_map_total',
    };
    await tx.dish_media_analysis_results.upsert({
      where: { dish_media_id: reaction.target_id },
      create: {
        dish_media_id: reaction.target_id,
        [columnMap[reaction.action_type]]: willReact ? BigInt(1) : BigInt(0),
        created_at: new Date(),
        updated_at: new Date(),
      },
      update: {
        [columnMap[reaction.action_type]]: willReact
          ? { increment: BigInt(1) }
          : { decrement: BigInt(1) },
        updated_at: new Date(),
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /*              Impression エンドポイント（増分更新）                 */
  /* ------------------------------------------------------------------ */

  /**
   * Impression を追加し、analysis_results を増分更新
   * @param tx トランザクションクライアント
   * @param dishsMediaId dish_media.id
   * @param userId ユーザーID
   * @param sessionId セッションID
   * @param source ソース
   */
  async addImpression(
    tx: Prisma.TransactionClient,
    dishMediaImpression: Omit<PrismaDishMediaImpressions, 'created_at'>,
  ): Promise<void> {
    // dish_media_impressions に挿入（upsert で冪等性を保証）
    // Note: 既存のスキーマには session_id でのユニーク制約がないため、
    // ここでは dish_media_id + session_id の組み合わせで重複チェック
    const existing = await tx.dish_media_impressions.findFirst({
      where: {
        dish_media_id: dishMediaImpression.dish_media_id,
        session_id: dishMediaImpression.session_id,
      },
    });

    if (!existing) {
      // 新規作成の場合のみ挿入
      await tx.dish_media_impressions.create({ data: dishMediaImpression });

      // impr_total を +1
      await tx.dish_media_analysis_results.upsert({
        where: { dish_media_id: dishMediaImpression.dish_media_id },
        create: {
          dish_media_id: dishMediaImpression.dish_media_id,
          impr_total: BigInt(1),
          created_at: new Date(),
          updated_at: new Date(),
        },
        update: {
          impr_total: { increment: BigInt(1) },
          updated_at: new Date(),
        },
      });
    } else {
      // 既存の場合は何もしない（冪等性）
      this.logger.debug(
        'ImpressionAlreadyExists',
        'addImpression',
        dishMediaImpression,
      );
    }
  }
}
