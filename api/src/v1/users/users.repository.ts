// api/src/v1/users/users.repository.ts
//
// Repository for users data access
//

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaUsers } from '../../../../shared/converters/convert_users';
import { PrismaDishes } from '../../../../shared/converters/convert_dishes';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import { Prisma } from '../../../../shared/prisma/client';
import { QueryMyDishesDto, MyDishSort, MyDishStatus } from '@shared/v1/dto';
import { MY_DISH_MAP_PINS_LIMIT } from '@shared/v1/res';
import { roundToOneDecimal } from '../../core/utils/backend-utils';
import {
  MyDishCursor,
  buildMyDishKeysetPredicate,
  buildMyDishOrderBy,
  hasRatingFilter,
  isBranchSkippableByCursor,
} from './my-dishes.query';

/** #1395 一覧 1 行ぶんの生データ（DishMediaEntry の組み立ては Service 側で行う） */
export type MyDishRowEntity = {
  key: string;
  status: MyDishStatus;
  occurredAt: Date;
  savedAt: Date | null;
  eatenAt: Date | null;
  reviewId: string | null;
  /** 代表メディア（#1395 m-7 の規則で解決済み）。写真なし記録では null */
  mediaId: string | null;
  distanceMeters: number | null;
  restaurant: PrismaRestaurants;
  dish: PrismaDishes & { reviewCount: number; averageRating: number };
  /** カーソル生成用（sort ごとに必要な要素だけ使う） */
  cursorSource: {
    row_key: string;
    occurred_at: Date;
    rating: number | null;
    distance_meters: number | null;
    feature_score: number | null;
  };
};

/** #1395 Map ピン 1 件ぶんの生データ */
export type MyDishPinEntity = {
  restaurant: PrismaRestaurants;
  counts: { want: number; eaten: number };
  latestOccurredAt: Date;
  /** 代表メディアのサムネイル組み立てに必要な最小限の列 */
  representativeMedia: {
    id: string;
    thumbnail_path: string;
    thumbnail_processing_status: string;
    thumbnail_external_url: string | null;
  } | null;
};

type RestaurantColumns = {
  r_id: string;
  r_google_place_id: string;
  r_name: string;
  r_name_language_code: string;
  r_latitude: number;
  r_longitude: number;
  r_image_url: string;
  r_image_path: string | null;
  r_address_components: Prisma.JsonValue;
  r_plus_code: Prisma.JsonValue | null;
  r_created_at: Date;
};

type DishColumns = {
  d_id: string;
  d_restaurant_id: string;
  d_category_id: string;
  d_name: string | null;
  d_created_at: Date;
  d_updated_at: Date;
  d_lock_no: number;
};

type MyDishRawRow = RestaurantColumns &
  DishColumns & {
    row_key: string;
    row_status: MyDishStatus;
    review_id: string | null;
    dish_id: string;
    occurred_at: Date;
    saved_at: Date | null;
    rating: number | null;
    distance_meters: number | null;
    feature_score: number | null;
    media_id: string | null;
    review_count: number;
    average_rating: number;
  };

type MyDishPinRawRow = RestaurantColumns & {
  want_count: number;
  eaten_count: number;
  latest_occurred_at: Date;
  media_id: string | null;
  media_thumbnail_path: string | null;
  media_thumbnail_processing_status: string | null;
  media_thumbnail_external_url: string | null;
};

const toRestaurant = (row: RestaurantColumns): PrismaRestaurants => ({
  id: row.r_id,
  google_place_id: row.r_google_place_id,
  name: row.r_name,
  name_language_code: row.r_name_language_code,
  latitude: row.r_latitude,
  longitude: row.r_longitude,
  image_url: row.r_image_url,
  image_path: row.r_image_path,
  address_components: row.r_address_components,
  plus_code: row.r_plus_code,
  created_at: row.r_created_at,
});

/** レストランの列を SELECT に展開する（生 SQL を 2 本で共有する） */
const RESTAURANT_COLUMNS_SQL = Prisma.sql`
  r.id                 AS r_id,
  r.google_place_id    AS r_google_place_id,
  r.name               AS r_name,
  r.name_language_code AS r_name_language_code,
  r.latitude           AS r_latitude,
  r.longitude          AS r_longitude,
  r.image_url          AS r_image_url,
  r.image_path         AS r_image_path,
  r.address_components AS r_address_components,
  r.plus_code          AS r_plus_code,
  r.created_at         AS r_created_at`;

@Injectable()
export class UsersRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ================================================================== */
  /*                       #1395 my-dishes                              */
  /* ================================================================== */

  /**
   * 一覧と Map ピンが**共有する**候補行 SQL を組み立てる。
   *
   * 返すのは
   * - `ctes`      : `my_save_ids` / `my_saved_dishes`（WITH 句へそのまま差し込む）
   * - `candidates`: `(want 枝) UNION ALL (eaten 枝)`
   * の 2 つ。フィルタ条件がここ 1 箇所に集まるので、2 エンドポイントで重複実装にならない。
   *
   * ## 設計上の要点
   *
   * **(1) `reactions.target_id::uuid` は MATERIALIZED フェンスの内側でだけキャストする（M-1）**
   * `dish_categories.id` は TEXT（Wikidata QID）で、`reactions.target_id` には
   * `Q1338822` のような **`::uuid` にすると必ず落ちる値が実在する**。
   * `target_type='dish_media'` を先に適用してくれることをプランナに期待するのではなく、
   * `MATERIALIZED` で最適化フェンスを張り、**構造的に**非 UUID がキャストへ届かないようにする。
   * `idx_reactions_profile_cursor (user_id, target_type, action_type, created_at DESC, id)` が
   * そのまま効く。
   *
   * **(2) カーソル・from/to・LIMIT を UNION ALL の各枝の内側へ押し込む（B-2）**
   * CTE を複数回参照すると PostgreSQL 12+ でも materialize されるため、
   * 1 ページ取るたびにユーザーの `dish_reviews` 全行（約 964MB のテーブル）を読むことになる。
   * 各枝を keyset 順に並べて `LIMIT $limit+1` し、マージ後にもう一度 limit する。
   *
   * **(3) want 行の除外は CTE ではなく `dish_reviews` の実体に対する `NOT EXISTS`（B-2）**
   * `idx_dish_reviews_user_dish (user_id, dish_id)`（20260819T0400）を使う。
   *
   * **(4) ブロックは効かせない（m-6）**
   * `reactions(action_type='block')` は「勧めてくるな」であって「自分の記録を消せ」ではないので、
   * 推薦クエリの `blocked_categories` CTE をここへコピーしない。
   */
  private buildMyDishesCandidates(
    userId: string,
    dto: QueryMyDishesDto,
    options: { cursor: MyDishCursor | null; branchLimit: number | null },
  ): { ctes: Prisma.Sql; candidates: Prisma.Sql } | null {
    const sort: MyDishSort = dto.sort ?? '-occurredAt';
    const statuses: MyDishStatus[] = dto.status?.length
      ? dto.status
      : ['want', 'eaten'];

    // #1395 m-4: 評価フィルタは want 行を必ず全消しする（want は rating を持たない）。
    // 無駄に枝を投げないよう、サーバ側でも want 枝を落とす。
    const ratingFilterActive = hasRatingFilter(dto);

    const includeWant =
      statuses.includes('want') &&
      !ratingFilterActive &&
      !isBranchSkippableByCursor('want', options.cursor);
    const includeEaten =
      statuses.includes('eaten') &&
      !isBranchSkippableByCursor('eaten', options.cursor);

    if (!includeWant && !includeEaten) return null;

    const hasArea =
      dto.lat !== undefined && dto.lng !== undefined && dto.radius !== undefined;

    // エリア絞り込みは ST_DWithin + 既存の GIST 索引（idx_restaurants_location）を使う。
    // 既存 searchNearbySavedRestaurants のバウンディングボックス + acos は
    // restaurants.latitude / longitude に btree が無く索引を活かせていないため踏襲しない。
    const areaFilter = hasArea
      ? Prisma.sql`AND ST_DWithin(r.location, ST_MakePoint(${dto.lng}::double precision, ${dto.lat}::double precision)::geography, ${dto.radius}::double precision)`
      : Prisma.empty;
    const distanceExpr = hasArea
      ? Prisma.sql`ST_Distance(r.location, ST_MakePoint(${dto.lng}::double precision, ${dto.lat}::double precision)::geography)::double precision`
      : Prisma.sql`NULL::double precision`;

    const categoryFilter = dto.categoryIds?.length
      ? Prisma.sql`AND d.category_id = ANY(${dto.categoryIds}::text[])`
      : Prisma.empty;

    // #1375 追補「時間帯・シチュエーションは絞り込みではなく並び替え」。
    // 既存 dish-categories.repository.ts と同じく dish_category_features を
    // LEFT JOIN して COALESCE(score, 0) を使う（新しいスコアリングを作らない）。
    const featureType =
      sort === '-sceneScore'
        ? 'scene'
        : sort === '-timeSlotScore'
          ? 'timeSlot'
          : null;
    const featureKey =
      sort === '-sceneScore'
        ? dto.sceneKey
        : sort === '-timeSlotScore'
          ? dto.timeSlotKey
          : undefined;
    const featureJoin =
      featureType && featureKey
        ? Prisma.sql`LEFT JOIN dish_category_features dcf
             ON dcf.dish_category_id = d.category_id
            AND dcf.feature_type = ${featureType}::text
            AND dcf.feature_key = ${featureKey}::text`
        : Prisma.empty;
    const featureScoreExpr =
      featureType && featureKey
        ? Prisma.sql`COALESCE(dcf.score, 0)::double precision`
        : Prisma.sql`NULL::double precision`;

    const rangeFilter = (column: Prisma.Sql): Prisma.Sql => {
      const fromSql = dto.from
        ? Prisma.sql`AND ${column} >= ${new Date(dto.from)}::timestamptz`
        : Prisma.empty;
      const toSql = dto.to
        ? Prisma.sql`AND ${column} <= ${new Date(dto.to)}::timestamptz`
        : Prisma.empty;
      return Prisma.sql`${fromSql} ${toSql}`;
    };

    const minRatingFilter =
      dto.minRating !== undefined
        ? Prisma.sql`AND dr.rating >= ${dto.minRating}::int`
        : Prisma.empty;
    const ratingsFilter = dto.ratings?.length
      ? Prisma.sql`AND dr.rating = ANY(${dto.ratings}::int[])`
      : Prisma.empty;

    const keyset = buildMyDishKeysetPredicate(options.cursor);
    // branchLimit が null（Map ピン）のときは全件が要るので、枝内の並べ替えは無駄。
    const branchTail =
      options.branchLimit === null
        ? Prisma.empty
        : Prisma.sql`ORDER BY ${buildMyDishOrderBy(sort)} LIMIT ${options.branchLimit}`;

    const ctes = Prisma.sql`
      -- (1) 最適化フェンス。ここから外へ出るまで target_id は text のまま扱う
      my_save_ids AS MATERIALIZED (
        SELECT target_id, created_at
        FROM reactions
        WHERE user_id = ${userId}::uuid
          AND target_type = 'dish_media'
          AND action_type = 'save'
      ),
      -- want 行は dish 単位に畳む。代表メディアは「最新の save 対象メディア」に固定する（m-7）
      my_saved_dishes AS MATERIALIZED (
        SELECT DISTINCT ON (dm.dish_id)
          dm.dish_id           AS dish_id,
          dm.id                AS media_id,
          s.created_at         AS saved_at
        FROM my_save_ids s
        JOIN dish_media dm ON dm.id = s.target_id::uuid
        ORDER BY dm.dish_id, s.created_at DESC, dm.id DESC
      )`;

    const wantBranch = Prisma.sql`
      SELECT * FROM (
        SELECT
          'dish:' || sd.dish_id::text AS row_key,
          'want'::text                AS row_status,
          NULL::uuid                  AS review_id,
          sd.dish_id                  AS dish_id,
          sd.saved_at                 AS occurred_at,
          NULL::int                   AS rating,
          sd.media_id                 AS own_media_id,
          ${distanceExpr}             AS distance_meters,
          ${featureScoreExpr}         AS feature_score
        FROM my_saved_dishes sd
        JOIN dishes d      ON d.id = sd.dish_id
        JOIN restaurants r ON r.id = d.restaurant_id
        ${featureJoin}
        WHERE NOT EXISTS (
          SELECT 1 FROM dish_reviews dr2
          WHERE dr2.user_id = ${userId}::uuid
            AND dr2.dish_id = sd.dish_id
        )
        ${categoryFilter}
        ${areaFilter}
        ${rangeFilter(Prisma.sql`sd.saved_at`)}
      ) w
      WHERE ${keyset}
      ${branchTail}`;

    const eatenBranch = Prisma.sql`
      SELECT * FROM (
        SELECT
          'review:' || dr.id::text AS row_key,
          'eaten'::text            AS row_status,
          dr.id                    AS review_id,
          dr.dish_id               AS dish_id,
          dr.created_at            AS occurred_at,
          dr.rating::int           AS rating,
          dr.created_dish_media_id AS own_media_id,
          ${distanceExpr}          AS distance_meters,
          ${featureScoreExpr}      AS feature_score
        FROM dish_reviews dr
        JOIN dishes d      ON d.id = dr.dish_id
        JOIN restaurants r ON r.id = d.restaurant_id
        ${featureJoin}
        WHERE dr.user_id = ${userId}::uuid
        ${categoryFilter}
        ${areaFilter}
        ${minRatingFilter}
        ${ratingsFilter}
        ${rangeFilter(Prisma.sql`dr.created_at`)}
      ) e
      WHERE ${keyset}
      ${branchTail}`;

    const candidates =
      includeWant && includeEaten
        ? Prisma.sql`(${wantBranch}) UNION ALL (${eatenBranch})`
        : includeWant
          ? wantBranch
          : eatenBranch;

    return { ctes, candidates };
  }

  /**
   * #1395 GET /v1/users/me/dishes の本体。
   *
   * `limit + 1` 件取って `hasMore` を判定する既存の作法に合わせる。
   * `dish.reviewCount` / `averageRating` と代表メディアのフォールバックは
   * **LIMIT を掛けた後のページ内 dish に限定した LATERAL** で取る（m-5）。
   * 候補集合全体への `GROUP BY` は B-2 と同じ事故になる。
   */
  async findMyDishes(
    userId: string,
    dto: QueryMyDishesDto,
    cursor: MyDishCursor | null,
  ): Promise<{ items: MyDishRowEntity[]; hasMore: boolean }> {
    const limit = dto.limit ?? 42;
    const sort: MyDishSort = dto.sort ?? '-occurredAt';

    this.logger.debug('FindMyDishes', 'findMyDishes', {
      userId,
      sort,
      limit,
      status: dto.status,
      hasCursor: cursor !== null,
    });

    const built = this.buildMyDishesCandidates(userId, dto, {
      cursor,
      branchLimit: limit + 1,
    });
    if (!built) return { items: [], hasMore: false };

    const orderBy = buildMyDishOrderBy(sort);

    const rows = await this.prisma.prisma.$queryRaw<MyDishRawRow[]>(Prisma.sql`
      WITH ${built.ctes},
      page AS (
        SELECT * FROM (${built.candidates}) u
        ORDER BY ${orderBy}
        LIMIT ${limit + 1}
      )
      SELECT
        p.row_key,
        p.row_status,
        p.review_id,
        p.dish_id,
        p.occurred_at,
        p.rating,
        p.distance_meters,
        p.feature_score,
        ms.saved_at                       AS saved_at,
        COALESCE(p.own_media_id, fb.id)   AS media_id,
        ${RESTAURANT_COLUMNS_SQL},
        d.id            AS d_id,
        d.restaurant_id AS d_restaurant_id,
        d.category_id   AS d_category_id,
        d.name          AS d_name,
        d.created_at    AS d_created_at,
        d.updated_at    AS d_updated_at,
        d.lock_no       AS d_lock_no,
        st.review_count,
        st.average_rating
      FROM page p
      JOIN dishes d      ON d.id = p.dish_id
      JOIN restaurants r ON r.id = d.restaurant_id
      -- 食べたい登録日は「食べた」行にも載せる（save reaction を消さないため保持できる）
      LEFT JOIN my_saved_dishes ms ON ms.dish_id = p.dish_id
      -- eaten で created_dish_media_id が NULL のときだけ、その dish の最新メディアへ落とす（m-7）
      LEFT JOIN LATERAL (
        SELECT dm2.id
        FROM dish_media dm2
        WHERE dm2.dish_id = p.dish_id
        ORDER BY dm2.created_at DESC, dm2.id DESC
        LIMIT 1
      ) fb ON p.own_media_id IS NULL
      -- ページ内の dish に限定した集計（候補集合全体の GROUP BY はしない）
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int                                 AS review_count,
          COALESCE(AVG(dr3.rating), 0)::double precision AS average_rating
        FROM dish_reviews dr3
        WHERE dr3.dish_id = p.dish_id
      ) st ON TRUE
      ORDER BY ${orderBy}
    `);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    this.logger.debug('FindMyDishesResult', 'findMyDishes', {
      count: page.length,
      hasMore,
    });

    return {
      items: page.map((row) => ({
        key: row.row_key,
        status: row.row_status,
        occurredAt: row.occurred_at,
        savedAt: row.saved_at,
        eatenAt: row.row_status === 'eaten' ? row.occurred_at : null,
        reviewId: row.review_id,
        mediaId: row.media_id,
        distanceMeters: row.distance_meters,
        restaurant: toRestaurant(row),
        dish: {
          id: row.d_id,
          restaurant_id: row.d_restaurant_id,
          category_id: row.d_category_id,
          name: row.d_name,
          created_at: row.d_created_at,
          updated_at: row.d_updated_at,
          lock_no: row.d_lock_no,
          reviewCount: row.review_count,
          averageRating: roundToOneDecimal(row.average_rating),
        },
        cursorSource: {
          row_key: row.row_key,
          occurred_at: row.occurred_at,
          rating: row.rating,
          distance_meters: row.distance_meters,
          feature_score: row.feature_score,
        },
      })),
      hasMore,
    };
  }

  /**
   * #1395 GET /v1/users/me/dishes/map-pins の本体。
   *
   * Map は「viewport 内のピンを全部」欲しいのでページングしない。
   * 代わりに `MY_DISH_MAP_PINS_LIMIT` で打ち切り、**切られたことを呼び出し元へ返す**。
   * 黙って切らない。
   */
  async findMyDishMapPins(
    userId: string,
    dto: QueryMyDishesDto,
  ): Promise<{ items: MyDishPinEntity[]; truncated: boolean }> {
    this.logger.debug('FindMyDishMapPins', 'findMyDishMapPins', {
      userId,
      status: dto.status,
      hasArea: dto.lat !== undefined,
    });

    const built = this.buildMyDishesCandidates(userId, dto, {
      cursor: null,
      branchLimit: null,
    });
    if (!built) return { items: [], truncated: false };

    const rows = await this.prisma.prisma.$queryRaw<MyDishPinRawRow[]>(
      Prisma.sql`
      WITH ${built.ctes},
      candidates AS MATERIALIZED (
        SELECT * FROM (${built.candidates}) u
      ),
      pins AS (
        SELECT
          d.restaurant_id                                        AS restaurant_id,
          COUNT(*) FILTER (WHERE c.row_status = 'want')::int      AS want_count,
          COUNT(*) FILTER (WHERE c.row_status = 'eaten')::int     AS eaten_count,
          MAX(c.occurred_at)                                     AS latest_occurred_at
        FROM candidates c
        JOIN dishes d ON d.id = c.dish_id
        GROUP BY d.restaurant_id
        ORDER BY MAX(c.occurred_at) DESC
        LIMIT ${MY_DISH_MAP_PINS_LIMIT + 1}
      )
      SELECT
        ${RESTAURANT_COLUMNS_SQL},
        p.want_count,
        p.eaten_count,
        p.latest_occurred_at,
        dm.id                          AS media_id,
        dm.thumbnail_path              AS media_thumbnail_path,
        dm.thumbnail_processing_status AS media_thumbnail_processing_status,
        dm.thumbnail_external_url      AS media_thumbnail_external_url
      FROM pins p
      JOIN restaurants r ON r.id = p.restaurant_id
      -- ピンの代表メディアは「その店舗で最も新しい行」の代表メディアに固定する（m-7）
      LEFT JOIN LATERAL (
        SELECT c2.own_media_id, c2.dish_id
        FROM candidates c2
        JOIN dishes d2 ON d2.id = c2.dish_id
        WHERE d2.restaurant_id = p.restaurant_id
        ORDER BY c2.occurred_at DESC, c2.row_key DESC
        LIMIT 1
      ) top ON TRUE
      LEFT JOIN LATERAL (
        SELECT dm3.id
        FROM dish_media dm3
        WHERE dm3.dish_id = top.dish_id
        ORDER BY dm3.created_at DESC, dm3.id DESC
        LIMIT 1
      ) fb ON top.own_media_id IS NULL
      LEFT JOIN dish_media dm ON dm.id = COALESCE(top.own_media_id, fb.id)
      ORDER BY p.latest_occurred_at DESC
    `,
    );

    const truncated = rows.length > MY_DISH_MAP_PINS_LIMIT;
    const pins = truncated ? rows.slice(0, MY_DISH_MAP_PINS_LIMIT) : rows;

    this.logger.debug('FindMyDishMapPinsResult', 'findMyDishMapPins', {
      count: pins.length,
      truncated,
    });

    return {
      items: pins.map((row) => ({
        restaurant: toRestaurant(row),
        counts: { want: row.want_count, eaten: row.eaten_count },
        latestOccurredAt: row.latest_occurred_at,
        representativeMedia:
          row.media_id && row.media_thumbnail_path
            ? {
                id: row.media_id,
                thumbnail_path: row.media_thumbnail_path,
                thumbnail_processing_status:
                  row.media_thumbnail_processing_status ?? 'idle',
                thumbnail_external_url: row.media_thumbnail_external_url,
              }
            : null,
      })),
      truncated,
    };
  }

  /**
   * #1395 Calendar が「どこまで遡れるか」を知るための最古 `occurredAt`。
   *
   * **`status` 以外のフィルタが無いときだけ**算出する。
   * その条件下では、両枝とも索引の先頭 1 行を読むだけで済む
   * （`idx_dish_reviews_user_created_at` / `idx_reactions_profile_cursor`）。
   * カテゴリ・エリア・評価・期間が付くと索引で順序を保てず、
   * `dish_reviews`（約 964MB）に対するユーザー全行走査が
   * **フィルタを変えるたびに** 1 回走ってしまうため、その場合は算出しない（B-2）。
   */
  async findMyDishesOldestOccurredAt(
    userId: string,
    statuses: MyDishStatus[],
  ): Promise<Date | null> {
    const candidates: Date[] = [];

    if (statuses.includes('eaten')) {
      const oldestReview = await this.prisma.prisma.dish_reviews.findFirst({
        where: { user_id: userId },
        orderBy: { created_at: 'asc' },
        select: { created_at: true },
      });
      if (oldestReview) candidates.push(oldestReview.created_at);
    }

    if (statuses.includes('want')) {
      const oldestSave = await this.prisma.prisma.reactions.findFirst({
        where: {
          user_id: userId,
          target_type: 'dish_media',
          action_type: 'save',
        },
        orderBy: { created_at: 'asc' },
        select: { created_at: true },
      });
      if (oldestSave) candidates.push(oldestSave.created_at);
    }

    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) => (a < b ? a : b));
  }

  /**
   * ユーザーの収益一覧を取得
   */
  async findUserPayouts(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: Awaited<
      ReturnType<typeof this.prisma.prisma.payouts.findMany>
    >[number][];
    nextCursor: string | null;
  }> {
    this.logger.debug('FindUserPayouts', 'findUserPayouts', {
      userId,
      cursor,
      limit,
    });

    const whereClause: any = {
      user_id: userId,
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const result = await this.prisma.prisma.payouts.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: limit + 1,
    });

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor =
      hasMore && items.length > 0
        ? items[items.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('UserPayoutsFound', 'findUserPayouts', {
      count: items.length,
      hasMore,
    });

    return { items, nextCursor };
  }

  /**
   * ユーザーの入札履歴を取得
   */
  async findUserRestaurantBids(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: Awaited<
      ReturnType<typeof this.prisma.prisma.restaurant_bids.findMany>
    >[number][];
    nextCursor: string | null;
  }> {
    this.logger.debug('FindUserRestaurantBids', 'findUserRestaurantBids', {
      userId,
      cursor,
      limit,
    });

    const whereClause: any = {
      user_id: userId,
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const result = await this.prisma.prisma.restaurant_bids.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: limit + 1,
    });

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor =
      hasMore && items.length > 0
        ? items[items.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('UserRestaurantBidsFound', 'findUserRestaurantBids', {
      count: items.length,
      hasMore,
    });

    return { items, nextCursor };
  }

  /**
   * 指定されたIDのユーザーを取得
   */
  async getUserByIds(userId: string[]) {
    return this.prisma.prisma.users.findMany({
      where: {
        id: { in: userId },
      },
    });
  }

  /**
   * 指定されたIDのユーザーを1件取得
   */
  async getUserById(userId: string) {
    return this.prisma.prisma.users.findUnique({
      where: { id: userId },
    });
  }

  /**
   * ユーザープロフィールを更新
   */
  async updateUserProfile(
    data: Partial<Omit<PrismaUsers, 'created_at' | 'updated_at' | 'lock_no'>>,
  ) {
    const result = await this.prisma.prisma.users.update({
      where: { id: data.id },
      data: {
        ...data,
        updated_at: new Date(),
        lock_no: { increment: 1 },
      },
    });
    return result;
  }

  /**
   * ブロック中の料理カテゴリを取得
   */
  async findBlockedDishCategories(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: string[]; // dish_categories IDs
    nextCursor: string | null;
  }> {
    this.logger.debug(
      'FindBlockedDishCategories',
      'findBlockedDishCategories',
      {
        userId,
        cursor,
        limit,
      },
    );

    const whereClause: any = {
      user_id: userId,
      target_type: 'dish_categories',
      action_type: 'block',
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const result = await this.prisma.prisma.reactions.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: limit + 1,
      select: {
        target_id: true,
        created_at: true,
      },
    });

    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor =
      hasMore && items.length > 0
        ? items[items.length - 1].created_at.toISOString()
        : null;

    this.logger.debug(
      'BlockedDishCategoriesFound',
      'findBlockedDishCategories',
      {
        count: items.length,
        hasMore,
      },
    );

    return { items: items.map((r) => r.target_id), nextCursor };
  }

  /**
   * 料理カテゴリのブロックを解除
   */
  async unblockDishCategory(
    userId: string,
    categoryId: string,
  ): Promise<boolean> {
    this.logger.debug('UnblockDishCategory', 'unblockDishCategory', {
      userId,
      categoryId,
    });

    const result = await this.prisma.prisma.reactions.deleteMany({
      where: {
        user_id: userId,
        target_type: 'dish_categories',
        target_id: categoryId,
        action_type: 'block',
      },
    });

    this.logger.debug('UnblockDishCategoryResult', 'unblockDishCategory', {
      count: result.count,
    });

    return result.count > 0;
  }
}
