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
import type { dish_media_external_embeddings as PrismaDishMediaExternalEmbeddings } from '../../../../shared/prisma/client';
import { PrismaDishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { PrismaDishMediaViews } from '../../../../shared/converters/convert_dish_media_views';
import { PrismaDishMediaImpressions } from '../../../../shared/converters/convert_dish_media_impressions';
import { PrismaDishMediaAnalysisResults } from '../../../../shared/converters/convert_dish_media_analysis_results';
import { AppLoggerService } from 'src/core/logger/logger.service';

import {
  CreateDishMediaDto,
  CreateDishMediaReviewDto,
  SearchDishMediaDto,
  QueryRestaurantDishMediaDto,
  ReactionActionType,
} from '@shared/v1/dto';

import { PrismaService } from '../../prisma/prisma.service';
import {
  roundToOneDecimal,
  shuffle,
  toNullableId,
} from '../../core/utils/backend-utils';
import { CLS_KEY_APP_VERSION } from 'src/core/cls/cls.constants';
import { ClsService } from 'nestjs-cls';
import { normalizePreferredLanguageCodes } from '../../../../shared/utils/languageCode';
import { prioritizeReviewsByLanguage } from './review-ordering';
import { buildLanguageWhereClause } from './language-where';
// #1511 退会したユーザーの投稿・レビューを外す where 断片（共有リンクの OGP でも使う）
import { NOT_AUTHORED_BY_DELETED_USER } from './deleted-user-filter';
import { MediaProcessingStatus } from '@shared/v1/res';
import {
  buildCursorFilter,
  buildCursorOrderBy,
  formatCompositeCursor,
} from '../../core/pagination/composite-cursor';
import {
  formatRestaurantDishMediaCursor,
  parseRestaurantDishMediaCursor,
} from './restaurant-dish-media-cursor';

/** #817 優先言語のレビュー先読みクエリの戻り値 */
type DishReviewWithUser = Prisma.dish_reviewsGetPayload<{
  include: { users: true };
}>;

/* -------------------------------------------------------------------------- */
/*                       返却型 (ドメイン Entity 例)                           */
/* -------------------------------------------------------------------------- */
export interface DishMediaEntryEntity {
  restaurant: PrismaRestaurants;
  dish: PrismaDishes & {
    reviewCount: number;
    averageRating: number;
    /** #1375 dish_categories.labels（言語コード → 表記）。取れなければ null */
    categoryLabels: Record<string, string> | null;
    /**
     * #1641 dish_categories.image_url。**サムネイルが 1 つも無いときの最後の受け皿。**
     * レスポンスへそのまま出すものではなく、`thumbnailImageUrl` の解決にだけ使う。
     */
    categoryImageUrl: string | null;
  };
  dish_media: PrismaDishMedia & {
    isMine: boolean;
    isSaved: boolean;
    isLiked: boolean;
    likeCount: number;
    /**
     * #1375 実機確認（5 巡目）「フィードの『食べたを記録』ボタンに記録済みの色を付けたい」。
     * その dish に **自分の `dish_reviews` が 1 件でもあるか**。
     *
     * ⚠️ 詰めているのは `GET /v1/dish-media?ids=` だけ（#1399 の externalEmbed と同じ判断）。
     * このボタンを出すのはその経路で読むフィードだけで、検索動線のフィードでは
     * そもそも出さない（`ActionButtons` の `showRecordEaten`）。件数の多い検索経路へ
     * 問い合わせを 1 本増やす理由が無い。join しない経路では undefined になる
     */
    isEaten?: boolean;
    /**
     * #1399 `render_type='external_embed'` の行だけが持つ。
     * join しない経路（検索・一覧など件数の多い経路）では undefined のままになる
     */
    externalEmbed?: PrismaDishMediaExternalEmbeddings | null;
  };
  dish_reviews: (PrismaDishReviews & {
    username: string;
    isLiked: boolean;
    likeCount: number;
    /** #1513 閲覧者自身が書いたレビューか（編集・削除の導線判定） */
    isMine: boolean;
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
  ) {}

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
        -- CAST('openAt'  AS timestamptz)      AS open_at,
        CAST(${categoryId}  AS text)           AS category_id,
        -- CAST('priceMin'  AS numeric)          AS price_min,
        -- CAST('priceMax'  AS numeric)          AS price_max,
        CAST(${limit} AS integer) AS limit_count,
        CAST(${GUMBLE_TAU}  AS double precision) AS gumbel_tau, -- ランキングに “ゆらぎ（探索）” をどれだけ入れるかの強さ。
        CAST(${pageSeed}  AS text)             AS page_seed,
        current_timestamp                           AS now_ts,
        -- geography のユーザ位置
        ST_SetSRID(
          ST_MakePoint(
            CAST(${userLon} AS double precision),
            CAST(${userLat} AS double precision)
          ),
          4326
        )::geography AS user_geog,
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
        0.50 AS w_impr_total,
        0.40 AS w_avg_rating,
        1.50 AS w_recent_user_impression_penalty
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
        -- #1513 論理削除済みの投稿は候補集合に入れない。ここを漏らすと
        -- 「消したはずの投稿が検索に出る」という最も見つけにくい形で漏れる
        AND dm.deleted_at IS NULL
        AND d.category_id = (SELECT category_id FROM params)
        -- #1511 退会したユーザーの投稿はフィードに出さない（作者の users.deleted_at で判定）。
        -- user_id が NULL の取り込みメディアは対象外なので NOT EXISTS で書く
        AND NOT EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = dm.user_id
            AND u.deleted_at IS NOT NULL
        )
        -- #1257 実体（GCS original）が届いていない行を検索候補から除外する。
        -- media_processing_status を「加工完了フラグ」としてではなく「原本到達の代理指標」として使う。
        -- 単純に processing のみを弾く案では、原本のダウンロードに恒久的に失敗して
        -- processing のまま固着した行や、リサイズに失敗した failed 行という別種の
        -- 「実体未着」を見落とす（processing と failed は原因が違うだけで、どちらも
        -- 検索へ公開してはいけない点は同じ）。そのため completed 以外を一律に除外する。
        AND dm.media_processing_status = 'completed'
        /* #1641 **埋め込みの枠の中で再生できないと分かっている投稿は、検索フィードへ出さない。**

           オーナー指摘 2026-08-28:「検索タブのお店提案では出さないで欲しい」。
           権利ブロックのリールや埋め込みを許可していない YouTube 動画は、開いても
           サムネイルが止まっているだけで、そのセルは «スワイプさせるためだけの空振り» になる。

           ⚠️ **playback_status <> 'not_playable' と書いてはいけない。**
              取り込みメディア以外（自撮りの投稿）は dmee の行を持たないので、
              等値比較にすると **NULL になって全部落ちる**。NOT EXISTS で «そう判定された
              行が在るときだけ弾く» と書く。

           ⚠️ **unknown は弾かない。** 判定できなかっただけの投稿を隠すと、
              provider が仕様を変えた日に取り込み済みの投稿が一斉に検索から消える。

           ⚠️ 置き場所は base_candidates（ROW_NUMBER より**前**）である。後段で外すと、
              「1 dish につき 1 本」の枠を再生できない投稿が取ってしまい、
              **その料理が丸ごとフィードから消える**。 */
        AND NOT EXISTS (
          SELECT 1 FROM dish_media_external_embeddings dmee
          WHERE dmee.dish_media_id = dm.id
            AND dmee.playback_status = 'not_playable'
        )
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
    -- 疲労ペナルティ（同一ユーザーに直近24h表示済みのメディアは候補に残して減点）
    fatigue_marked AS (
      SELECT
        ofl.*,
        EXISTS (
          SELECT 1
          FROM dish_media_impressions dmi
          WHERE dmi.dish_media_id = ofl.dish_media_id
            AND (SELECT user_id FROM params) IS NOT NULL
            AND dmi.user_id = (SELECT user_id FROM params)
            AND dmi.created_at >= (SELECT now_ts FROM params) - INTERVAL '24 hours'
        ) AS has_recent_user_impression
      FROM open_flags ofl
    ),
    -- ========== dish_reviews 平均評価（Stage2: Pre-Rank特徴） ==========
    -- #440 【設計】dish_reviews の平均評価を dish_id 単位で集計
    dish_avg_ratings AS (
      SELECT
        dr.dish_id,
        AVG(dr.rating) AS avg_rating
      FROM dish_reviews dr
      JOIN (
        SELECT DISTINCT dish_id
        FROM fatigue_marked
      ) fm ON fm.dish_id = dr.dish_id
      -- #1513 削除済みレビューを平均評価に混ぜない
      WHERE dr.deleted_at IS NULL
      GROUP BY dr.dish_id
    ),
    -- ========== 指標結合（Stage2: Pre-Rank特徴） ==========
    features AS (
      SELECT
        fm.*,
        ar.impr_total, ar.view_total, ar.skip_total, ar.completion_total,
        ar.watch_ms_total, ar.save_total, ar.like_total, ar.open_map_total,
        dar.avg_rating,
        -- レート（イプシロン平滑）
        CASE
          WHEN ar.impr_total > 0 AND fm.video_duration_ms > 0
            THEN LEAST(1.0, GREATEST(0.0, ar.watch_ms_total::double precision
                        / (ar.impr_total::double precision * fm.video_duration_ms::double precision)))
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
      FROM fatigue_marked fm
      LEFT JOIN dish_media_analysis_results ar
        ON ar.dish_media_id = fm.dish_media_id
      LEFT JOIN dish_avg_ratings dar
        ON dar.dish_id = fm.dish_id
    ),
    -- ========== Pre-Rank スコア（軽量式） ==========
    pre_rank AS (
      SELECT
        f.*,
        -- 【設計】距離計算の値をログで確認できるように、保持しておく
        EXP(- f.distance_km / (SELECT d0 FROM params)) AS distance_contrib,
        (
          -- w1*(1 - skip_rate) + w2*avg_watch_rate + w3*save_rate + w4*open_map_rate + w5*like_rate + w_avg_rating*(avg_rating/5.0)
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
          END +
          -- #440 【設計】dish_reviews の平均評価を正規化（1-5 を 0-1 に変換）してスコアに加算
          (SELECT w_avg_rating FROM weights) * COALESCE(f.avg_rating / 5.0, 0.0) -
          CASE
            WHEN f.has_recent_user_impression THEN (SELECT w_recent_user_impression_penalty FROM weights)
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
    // #1599 カーソルはクライアントから来る任意の文字列なので、形を検証してから使う。
    //
    // 以前は `Number(...)` と `split('_')[1]` の結果を無検証で raw SQL へ流していた。
    // 壊れたカーソルを渡すと:
    //   - `?cursor=abc`        → mediaId が undefined
    //   - `?cursor=1_notauuid` → `'notauuid'::uuid` で **PostgreSQL が例外を投げる（500）**
    //   - `?cursor=abc_<uuid>` → like_count が NaN になり比較が壊れる
    // どれも «一覧が開けない» になる。**壊れたカーソルは先頭ページへ倒す**のが正しい
    // （`core/pagination/composite-cursor.ts` と同じ方針）。
    const cursor = parseRestaurantDishMediaCursor(cursorStr);
    const cursorWhere = cursor
      ? Prisma.sql`
          AND (
            ranked.like_count < ${cursor.likeCount}
            OR (ranked.like_count = ${cursor.likeCount} AND ranked.dish_media_id < ${cursor.mediaId}::uuid)
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
          COALESCE(dmar.like_total, 0) AS like_count
        FROM dish_media dm
        JOIN dishes d
          ON d.id = dm.dish_id
        LEFT JOIN dish_media_analysis_results dmar
          ON dmar.dish_media_id = dm.id
        WHERE d.restaurant_id = ${restaurantId}::uuid
          -- #1513 論理削除済みの投稿は店舗詳細にも出さない
          AND dm.deleted_at IS NULL
          -- #1511 退会したユーザーの投稿は店舗の投稿一覧にも出さない
          AND NOT EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = dm.user_id
              AND u.deleted_at IS NOT NULL
          )
          -- #1257 findDishMediaIds と同じ理由で、実体（GCS original）が届いていない行を
          -- レストラン詳細の一覧からも除外する。ここを漏らすと、検索には出なくなった
          -- 未着メディアが店舗ページ経由でだけ露出し続ける。
          -- 「各 dish につきいいね数最大の1件」を選ぶ ROW_NUMBER より前段で除外する必要がある。
          -- 後段で弾くと、未着行が代表に選ばれた dish が丸ごと欠落し、completed な
          -- 次点メディアまで巻き添えで消える。
          AND dm.media_processing_status = 'completed'
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
      LIMIT ${limit + 1};
    `);

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor: string | null =
      hasMore && items.length > 0
        ? formatRestaurantDishMediaCursor(last.like_count, last.dish_media_id)
        : null;

    return { items, nextCursor };
  }

  /* ------------------------------------------------------------------ */
  /*   ユーザーがレビューした料理レビューを取得する                     */
  /* ------------------------------------------------------------------ */
  async findDishReviewsByUser(
    userId: string,
    options:
      | { type: 'cursor'; cursor?: string; limit?: number }
      | { type: 'ids'; ids: string[] },
  ): Promise<{
    items: DishMediaEntryEntity['dish_reviews'];
    nextCursor: string | null;
  }> {
    this.logger.debug(
      'FindDishMediaEntryByReviewedUser',
      'findDishMediaEntryByReviewedUser',
      {
        userId,
        options,
      },
    );

    const whereClause: Prisma.dish_reviewsWhereInput = {
      user_id: userId,
      // #1513 論理削除済みは自分のプロフィールからも見えない
      deleted_at: null,
      // #1511 退会したユーザーのレビューは一覧に出さない。
      // 「自分のレビュー」を引く経路だが、退会後は本人にも他人にも出さない
      ...NOT_AUTHORED_BY_DELETED_USER,
    };
    if (options.type === 'cursor' && options.cursor) {
      // #1599 `(created_at, id)` の複合カーソル。時刻単独だと同時刻の行がページ境界で飛ぶ
      Object.assign(whereClause, buildCursorFilter(options.cursor));
    } else if (options.type === 'ids') {
      whereClause.id = {
        in: options.ids,
      };
    }

    const limit = options.type === 'cursor' ? (options.limit ?? 42) : undefined;
    const take = limit ? limit + 1 : undefined;

    const reviews = await this.prisma.prisma.dish_reviews.findMany({
      where: whereClause,
      orderBy: buildCursorOrderBy(),
      take,
      include: {
        users: true,
      },
    });

    // #479 【設計】cursor モードで limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore =
      options.type === 'cursor' &&
      limit !== undefined &&
      reviews.length > limit;
    const reviewsToReturn =
      hasMore && limit !== undefined ? reviews.slice(0, limit) : reviews;
    const nextCursor =
      options.type === 'cursor' && hasMore && reviewsToReturn.length > 0
        ? formatCompositeCursor(
            reviewsToReturn[reviewsToReturn.length - 1].created_at,
            reviewsToReturn[reviewsToReturn.length - 1].id,
          )
        : null;

    const { reactionSet, reviewLikeCountMap } =
      await this.buildReactionAggregates(
        // #1395 写真なしの「食べた」記録では created_dish_media_id が NULL になる。
        // 落としておかないと集計キーが 'dish_media:null:save' になり、無意味な IN 句が増える
        reviewsToReturn
          .map((review) => toNullableId(review.created_dish_media_id))
          .filter((id): id is string => id !== null),
        reviewsToReturn.map((review) => review.id),
        userId,
      );

    const items = reviewsToReturn.map((review) => ({
      ...review,
      username:
        review.imported_user_name ?? review.users?.display_name ?? 'unknown',
      isLiked: reactionSet.has(
        this.reactionKey('dish_reviews', review.id, 'like'),
      ),
      likeCount: reviewLikeCountMap.get(review.id) ?? 0,
      // #1513 このメソッドは「userId が書いたレビュー」だけを引くので常に true
      isMine: review.user_id === userId,
    }));

    return { items, nextCursor };
  }

  /* ------------------------------------------------------------------ */
  /*        ユーザーが「いいね」した dish_media を取得                 */
  /* ------------------------------------------------------------------ */
  async findDishMediaByLikedUser(
    userId: string,
    isAnonymous: boolean,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: { dish_media_id: string; created_at: Date }[];
    nextCursor: string | null;
  }> {
    this.logger.debug('findDishMediaByLikedUser', 'findDishMediaByLikedUser', {
      userId,
      cursor,
      isAnonymous,
      limit,
    });

    // #1599 `id` は複合カーソルの第 2 キーにだけ使う（呼び出し側は参照しない）
    let result: { id: string; dish_media_id: string; created_at: Date }[] = [];
    if (isAnonymous) {
      // 匿名ユーザーの場合は reactions テーブルから取得
      const whereClause: Prisma.reactionsWhereInput = {
        user_id: userId,
        target_type: 'dish_media',
        action_type: 'like',
      };
      // #1599 `(created_at, id)` の複合カーソル
      Object.assign(whereClause, buildCursorFilter(cursor));

      const likes = await this.prisma.prisma.reactions.findMany({
        where: whereClause,
        orderBy: buildCursorOrderBy(),
        take: limit + 1,
        // #1599 複合カーソルの第 2 キーに使うので id も引く
        select: { id: true, target_id: true, created_at: true },
      });

      result = likes.map((r) => ({
        id: r.id,
        dish_media_id: r.target_id,
        created_at: r.created_at,
      }));
    } else {
      // 通常ユーザーの場合は dish_media_likes テーブルから取得
      const whereClause: Prisma.dish_media_likesWhereInput = {
        user_id: userId,
      };
      // #1599 `(created_at, id)` の複合カーソル
      Object.assign(whereClause, buildCursorFilter(cursor));

      const likes = await this.prisma.prisma.dish_media_likes.findMany({
        where: whereClause,
        orderBy: buildCursorOrderBy(),
        take: limit + 1,
        select: { id: true, dish_media_id: true, created_at: true },
      });

      result = likes.map((r) => ({
        id: r.id,
        dish_media_id: r.dish_media_id,
        created_at: r.created_at,
      }));
    }

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor =
      hasMore && items.length > 0
        ? formatCompositeCursor(
            items[items.length - 1].created_at,
            items[items.length - 1].id,
          )
        : null;

    this.logger.debug(
      'findDishMediaByLikedUserResult',
      'findDishMediaByLikedUser',
      { count: items.length, hasMore },
    );

    return { items, nextCursor };
  }

  /* ------------------------------------------------------------------ */
  /*        ユーザーが「保存」した dish_media を取得                  */
  /* ------------------------------------------------------------------ */
  async findDishMediaBySavedUser(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: { dish_media_id: string; created_at: Date }[];
    nextCursor: string | null;
  }> {
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
    // #1599 `(created_at, id)` の複合カーソル
    Object.assign(whereClause, buildCursorFilter(cursor));

    const saves = await this.prisma.prisma.reactions.findMany({
      where: whereClause,
      orderBy: buildCursorOrderBy(),
      take: limit + 1,
      // #1599 複合カーソルの第 2 キーに使うので id も引く
      select: { id: true, target_id: true, created_at: true },
    });

    const result = saves.map((r) => ({
      id: r.id,
      dish_media_id: r.target_id,
      created_at: r.created_at,
    }));

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor =
      hasMore && items.length > 0
        ? formatCompositeCursor(
            items[items.length - 1].created_at,
            items[items.length - 1].id,
          )
        : null;

    this.logger.debug(
      'findDishMediaBySavedUserResult',
      'findDishMediaBySavedUser',
      { count: items.length, hasMore },
    );

    return { items, nextCursor };
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
      userId: string;
      reviewLimit?: number;
      preferredLanguageCodes?: readonly string[];
      /**
       * #1513 【設計】削除済み（`deleted_at IS NOT NULL`）の行も返すか。既定は false。
       *
       * 既定で弾くのは「消したはずの投稿がどこからも出てこない」を 1 箇所で保証するためで、
       * これは変えない。true を渡してよいのは **墓標「削除されました」を出す画面だけ**
       * （いいね一覧 / 保存一覧 / 通知 / レビューのサムネイル）。
       * これらは行そのものを消すと «いいねしたはずなのに一覧に無い» «通知バッジと件数が合わない»
       * になるため、行を残して中身だけ墓標へ差し替える。
       *
       * ⚠️ 検索結果・店舗フィード・投票候補へは渡さないこと（オーナー確定で «黙って除外» 側）。
       */
      includeDeleted?: boolean;
    },
  ): Promise<DishMediaEntryEntity[]> {
    const { userId, reviewLimit = 6, includeDeleted = false } = option;
    if (dishMediaIds.length === 0) return [];

    const preferredLanguageCodes = normalizePreferredLanguageCodes(
      option.preferredLanguageCodes,
    );

    const dishMedias = await this.prisma.prisma.dish_media.findMany({
      // #1513 ここが「詳細のどの経路からも出さない」の要。検索・店舗フィード・?ids= は
      // すべてこのメソッドを通るので、ここで弾けば一括で消える。
      // 墓標を出す画面（いいね/保存/通知/レビューのサムネイル）だけが includeDeleted で
      // この既定を外し、行を残したまま中身を墓標へ差し替える
      // #1511 退会したユーザーの投稿は id 指定で引かれても返さない。
      // ここは詳細・共有リンク・保存/いいね一覧まで含めた「ID から実体を作る」唯一の入口なので、
      // ここを塞ぐと個別の呼び出し元へ同じフィルタを配って回らずに済む。
      // #1513 論理削除済みの投稿も同様（`includeDeleted` のときだけ含める）
      where: {
        id: { in: dishMediaIds },
        ...(includeDeleted ? {} : { deleted_at: null }),
        ...NOT_AUTHORED_BY_DELETED_USER,
      },
      include: {
        dish_media_likes: { where: { user_id: userId } }, // User がいいねしているか
        dish_media_analysis_results: true, // #292 【設計】いいね数は like_total から取得（トゥルース源）
        // #1399 render_type='external_embed' の行は自ストレージに実体が無く、
        // canonical_url が無いと 1 件も描けない。**この経路（ids 指定）だけ** join する。
        // 全読み取り経路へ広げないのは、大多数を占める stored の行では常に NULL になり、
        // 検索・一覧のような件数の多い経路で無駄が積み上がるためである（#1395 の判断を踏襲）
        dish_media_external_embeddings: true,
        dishes: {
          include: {
            restaurants: true,
            // #1375（オーナー実機指摘「うどんで絞ったら udon が出る」）
            // 表示名に使う dishes.name は «その店でのその料理の呼び名» で、SNS 取り込み由来だと
            // ローマ字が入る。カテゴリの正式表記（言語コード → 表記）を一緒に返し、
            // クライアントが «利用者の言語 → 英語 → 店での呼び名» の順で出せるようにする。
            // labels 列だけを select するので、この join で読む量は最小に留まる。
            //
            // #1641 `image_url` も引く。SNS 取り込みの行は自ストレージにサムネイルを
            // 持たないことがあり（取り込み当時に複製へ失敗した / provider の署名 URL が失効した）、
            // **何も無いとセルが真っ黒になる**（run 33223480840 の feed-05 で実測）。
            // 最後の受け皿として料理カテゴリの絵を返す。列 1 つぶんの追加である。
            dish_categories: { select: { labels: true, image_url: true } },
            dish_reviews: {
              // #1513 削除済みレビューは本文欄に出さない
              // #1511 同じ料理に付いた «他人の» レビューのうち、退会者のものも落とす
              where: { deleted_at: null, ...NOT_AUTHORED_BY_DELETED_USER },
              orderBy: { created_at: 'asc' }, // #509 【設計】dish_reviews の並び順を古い→新しいに統一
              take: reviewLimit,
              include: { users: true },
            },
          },
        },
      },
    });

    // #817 【設計】優先言語のレビューは created_at 順で reviewLimit 件目より後ろに埋もれている
    // ことがあるため、別クエリで dish ごとに take して補充する。
    // nested take は親 1 件ごとに効くので、取得行数は
    // (優先言語分 reviewLimit + 既定分 reviewLimit) × dish 数 に収まり、青天井にならない。
    const preferredReviewsByDish = await this.findPreferredLanguageReviews(
      dishMedias.map((m) => m.dish_id),
      preferredLanguageCodes,
      reviewLimit,
    );

    // Get all dish IDs to calculate aggregates
    const dishIds = dishMedias.map((m) => m.dish_id);

    // Calculate review count and average rating per dish
    const avgByDish = await this.prisma.prisma.dish_reviews.groupBy({
      by: ['dish_id'],
      // #1513 削除済みレビューは件数にも平均にも入れない
      // #1511 表示から外したレビューを件数・平均点に数えると、
      // 「レビュー 3 件」と書いてあるのに 2 件しか出ない、というズレになる
      where: {
        dish_id: { in: dishIds },
        deleted_at: null,
        ...NOT_AUTHORED_BY_DELETED_USER,
      },
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

    // #817 【設計】表示する reviewLimit 件を先に確定させてから reactions を引く。
    // 優先度付け・slice の前に id を集めると、表示しないレビューまで
    // reactions の IN 句へ流れ込み、クエリが不必要に膨らむ。
    const reviewsByDishMediaId = new Map(
      dishMedias.map((m) => [
        m.id,
        prioritizeReviewsByLanguage(
          m.dishes.dish_reviews,
          preferredReviewsByDish.get(m.dish_id) ?? [],
          preferredLanguageCodes,
          reviewLimit,
        ),
      ]),
    );

    const allReviewIds = [...reviewsByDishMediaId.values()].flatMap((reviews) =>
      reviews.map((r) => r.id),
    );

    const { reactionSet, reviewLikeCountMap } =
      await this.buildReactionAggregates(dishMediaIds, allReviewIds, userId);

    // #1375（5 巡目）この dish を自分が «食べた» 記録があるか。
    //
    // 上で取っている `dishes.dish_reviews` は **全ユーザーぶんを reviewLimit 件で切っている**ので、
    // 自分のレビューがその中に居るとは限らない（＝ あの配列から判定すると «記録していない» と
    // 誤判定する）。索引 `idx_dish_reviews_user_dish (user_id, dish_id)` にそのまま乗る
    // 専用の 1 本で引く。ゲスト（userId なし）では引かない
    const eatenDishIds = new Set<string>();
    if (userId && dishIds.length > 0) {
      const myReviewedDishes = await this.prisma.prisma.dish_reviews.findMany({
        // #1513 削除済みレビューは «食べた» 記録として数えない。
        // schema.prisma の deleted_at は「読み取り経路は必ず deleted_at IS NULL で絞る」と
        // 定めており、dish_reviews を読む他の経路（618 / 893 / 1224 行、restaurants /
        // users の集計）はすべて絞っている。**ここだけが漏れていた**。
        // 漏れていると、レビューを消しても «食べたを記録» が記録済みの見た目のまま戻らない。
        where: { user_id: userId, dish_id: { in: dishIds }, deleted_at: null },
        distinct: ['dish_id'],
        select: { dish_id: true },
      });
      for (const row of myReviewedDishes) eatenDishIds.add(row.dish_id);
    }

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
        const dishReviews = reviewsByDishMediaId.get(dishMediaId) ?? [];

        return {
          restaurant: dishMedia.dishes.restaurants,
          dish: {
            ...dishMedia.dishes,
            reviewCount: dishStats?.reviewCount ?? 0,
            averageRating: dishStats?.averageRating ?? 0,
            // #1375 カテゴリの正式表記（ローマ字の dishes.name をユーザーに見せないため）
            categoryLabels:
              (dishMedia.dishes.dish_categories?.labels as Record<
                string,
                string
              > | null) ?? null,
            categoryImageUrl:
              dishMedia.dishes.dish_categories?.image_url ?? null,
          },
          dish_media: {
            ...(dishMedia as PrismaDishMedia),
            isMine: dishMedia.user_id === userId,
            isSaved: reactionSet.has(
              this.reactionKey('dish_media', dishMedia.id, 'save'),
            ),
            isLiked:
              dishMedia.dish_media_likes.length > 0 ||
              reactionSet.has(
                this.reactionKey('dish_media', dishMedia.id, 'like'),
              ),
            likeCount: Number(
              dishMedia.dish_media_analysis_results?.like_total ?? 0,
            ), // #292 【設計】likeCount は dish_media_analysis_results.like_total から取得（reactions は含めない）
            // #1375（5 巡目）「食べたを記録」ボタンを記録済みの色にするための旗
            isEaten: eatenDishIds.has(dishMedia.dish_id),
            // #1399 external_embed の行だけがこれを持つ。stored の行では常に undefined
            externalEmbed:
              dishMedia.dish_media_external_embeddings ?? undefined,
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
            // #1513 編集・削除の導線を出す判定。Google import 由来は user_id が
            // null なので、この比較で常に false になる
            isMine: review.user_id === userId,
          })),
        };
      });
  }

  /**
   * #817 【設計】優先言語のレビューを dish ごとに reviewLimit 件だけ先読みする。
   *
   * `original_language_code` には `ja` と `ja-JP` が混在し、さらに正規形(`zh-hans`)と
   * DB 実値(`zh-CN`)がずれることもある。そのため `languageMatchCandidates()` で
   * DB 実値の候補集合へ展開し、各候補の「完全一致」と「`候補-` の前方一致」で拾う
   * （組み立ては `buildLanguageWhereClause()`）。
   * nested take が親ごとに効くので、取得行数は reviewLimit × dish 数で頭打ちになる。
   */
  private async findPreferredLanguageReviews(
    dishIds: string[],
    preferredLanguageCodes: string[],
    reviewLimit: number,
  ): Promise<Map<string, DishReviewWithUser[]>> {
    const result = new Map<string, DishReviewWithUser[]>();
    if (preferredLanguageCodes.length === 0 || dishIds.length === 0) {
      return result;
    }

    const dishes = await this.prisma.prisma.dishes.findMany({
      where: { id: { in: dishIds } },
      select: {
        id: true,
        dish_reviews: {
          where: {
            // #1513 削除済みレビューは優先言語の補充対象にもしない
            deleted_at: null,
            // #817 【設計】正規形(zh-hans)をそのまま DB 値へ突き合わせると、
            // 実際に保存されている zh-CN に一致しない。必ず候補集合で引くこと。
            // #1052 組み立ては language-where.ts の純粋関数へ寄せてテスト可能にした。
            // #1511 退会者のレビューを落とす。言語条件が既に OR なので AND で束ねる
            //（spread すると片方の OR が消える）
            AND: [
              { OR: buildLanguageWhereClause(preferredLanguageCodes) },
              NOT_AUTHORED_BY_DELETED_USER,
            ],
          },
          orderBy: { created_at: 'asc' }, // #509 【設計】古い→新しい
          take: reviewLimit,
          include: { users: true },
        },
      },
    });

    for (const dish of dishes) {
      result.set(dish.id, dish.dish_reviews);
    }

    return result;
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

  /**
   * #1395 dish ごとの「最新メディア」を引く。
   *
   * 写真なしの「食べた」記録（`created_dish_media_id` が NULL）を
   * 代表メディアへ落とし込むために使う。選び方は my-dishes と揃える
   * （`created_at DESC, id DESC` の先頭 1 件。ページを取り直しても変わらない）。
   *
   * @returns dish_id → dish_media.id の Map（メディアが 1 件も無い dish は含まれない）
   */
  async findLatestDishMediaIdsByDishIds(
    dishIds: string[],
  ): Promise<Map<string, string>> {
    if (dishIds.length === 0) return new Map();

    const rows = await this.prisma.prisma.$queryRaw<
      { dish_id: string; id: string }[]
    >`
      SELECT DISTINCT ON (dm.dish_id) dm.dish_id, dm.id
      FROM dish_media dm
      -- #1513 これは「その dish の代表メディア」を選ぶ経路なので、
      -- 削除済みを候補に残すと消したはずの写真が代表として出続ける
      WHERE dm.dish_id = ANY(${dishIds}::uuid[])
        AND dm.deleted_at IS NULL
      ORDER BY dm.dish_id, dm.created_at DESC, dm.id DESC
    `;

    return new Map(rows.map((row) => [row.dish_id, row.id]));
  }

  /* ------------------------------------------------------------------ */
  /*        #1513 投稿の編集・削除で使う最小取得と論理削除               */
  /* ------------------------------------------------------------------ */
  /**
   * 認可判定に必要な最小の情報を取得する。
   *
   * **論理削除済みでも返す**。ここで弾くと「そもそも無い(404)」と
   * 「他人の投稿(403)」と「もう消えている」をサービス層が区別できなくなる。
   */
  async findDishMediaForMutation(dishMediaId: string) {
    return this.prisma.prisma.dish_media.findUnique({
      where: { id: dishMediaId },
      select: {
        id: true,
        user_id: true,
        deleted_at: true,
      },
    });
  }

  /**
   * 投稿（dish_media）と、その投稿に紐づく **投稿者自身の最古のレビュー 1 件** を論理削除する。
   *
   * 【#1513 【設計】「投稿」の単位】
   * オーナー確定仕様で「投稿」= dish_media 1 件 + そのメディアに紐づく自分の**最古**の
   * dish_review 1 件である。よって消すレビューも 1 件だけで、
   * 自分が同じメディアへ後から書いた 2 本目以降のレビューは
   * **「別の投稿」として残す**（それらを消すと、消していない投稿が消える）。
   * 最古の決め方は `created_at ASC, id ASC`（同時刻の tie-break。オーナー確認済み）。
   *
   * 【消す範囲を owner のレビューに限る理由】
   * `created_dish_media_id` は「一緒に作られた」だけを意味しない。既存メディアへ
   * レビューを足す経路（`review-from-media/[dishMediaId]`）でも同じメディア id が入るため、
   * `created_dish_media_id = :id` だけで消すと **他人が書いたレビューまで巻き添えで消える**。
   * 自分の投稿を消す操作で他人の文章を消してはいけないので、owner のものだけに絞る。
   *
   * 残った他人のレビューは失われない。レビューは *料理* 単位で読み出される
   * （`getDishMediaEntriesByIds` の `dishes.dish_reviews`）ので、同じ料理の別の投稿から
   * 引き続き読める。
   *
   * 逆にレビュー単体削除 (DELETE /v1/dish-reviews/:id) は dish_media を巻き込まない。
   *
   * 物理削除しないのは dish_media_likes(NoAction) / payouts / GCS 実体 /
   * notifications.target_id が dish_media.id を指したまま残るため。
   */
  async softDeleteDishMediaWithReviews(
    tx: Prisma.TransactionClient,
    dishMediaId: string,
    ownerUserId: string,
    deletedAt: Date,
  ): Promise<{ mediaDeleted: number; deletedDishReviewIds: string[] }> {
    // 巻き添えにするレビューの id は、更新の前に確定させておく。
    // updateMany は更新した行を返さないため、後から引くと「今回消したもの」と
    // 「元から消えていたもの」を区別できない
    const oldest = await tx.dish_reviews.findFirst({
      where: {
        created_dish_media_id: dishMediaId,
        user_id: ownerUserId,
        deleted_at: null,
      },
      // #1513 「最古」= created_at 昇順。同時刻は id で決める（DB 側の物理順に依存しない）
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const targets = oldest ? [oldest] : [];

    const media = await tx.dish_media.updateMany({
      where: { id: dishMediaId, deleted_at: null },
      data: {
        deleted_at: deletedAt,
        updated_at: deletedAt,
        lock_no: { increment: 1 },
      },
    });

    if (targets.length > 0) {
      await tx.dish_reviews.updateMany({
        where: { id: { in: targets.map((t) => t.id) } },
        data: {
          deleted_at: deletedAt,
          updated_at: deletedAt,
          lock_no: { increment: 1 },
        },
      });
    }

    return {
      mediaDeleted: media.count,
      deletedDishReviewIds: targets.map((t) => t.id),
    };
  }

  /* ------------------------------------------------------------------ */
  /*        dish_media 投稿 (トランザクション内で呼び出し)           */
  /* ------------------------------------------------------------------ */
  async createDishMedia(
    tx: Prisma.TransactionClient,
    dto: CreateDishMediaDto,
    dish_media: {
      user_id: string;
      thumbnail_path: string;
      media_processing_status: MediaProcessingStatus;
      thumbnail_processing_status: MediaProcessingStatus;
    },
  ) {
    const {
      user_id,
      thumbnail_path,
      media_processing_status,
      thumbnail_processing_status,
    } = dish_media;
    // 画像は既に Storage へアップ済みとして mediaPath を受け取る
    const newMedia = await tx.dish_media.create({
      data: {
        dish_id: dto.dishId,
        user_id,
        media_path: dto.mediaPath,
        media_processing_status,
        media_type: dto.mediaType,
        thumbnail_path,
        thumbnail_processing_status,
        video_duration_ms: dto.videoDurationMs,
      },
    });

    return newMedia;
  }

  /**
   * #1560 投稿と同時に作るレビュー。
   *
   * `createDishMedia` と **同じ `tx` で呼ぶこと**。別トランザクションにすると
   * «写真だけ残ってレビューが無い» 孤児（#1560）がそのまま復活する。
   *
   * `dish_id` と `created_dish_media_id` は引数の `dish_media` から取る。
   * クライアントに決めさせないのは、取り違えたときに «別の料理へレビューが付く» を
   * サーバー側で検出できなくなるため（DTO 側の JSDoc も参照）。
   */
  async createDishReviewForMedia(
    tx: Prisma.TransactionClient,
    review: CreateDishMediaReviewDto,
    dishMedia: { id: string; dish_id: string },
    userId: string,
  ) {
    return tx.dish_reviews.create({
      data: {
        dish_id: dishMedia.dish_id,
        user_id: userId,
        // 【設計】comment は翻訳せず入力のまま保存する（dish-reviews.repository と同じ）
        comment: review.comment,
        original_language_code: review.languageCode,
        rating: review.rating,
        price_cents: review.priceCents,
        currency_code: review.currencyCode,
        created_dish_media_id: dishMedia.id,
      },
    });
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
        const appVersion =
          this.cls.get<string>(CLS_KEY_APP_VERSION) ?? 'unknown';
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
    // dish_media_impressions に挿入
    // #491 【設計】session_id は、ただの属性として扱うため、unique にはしない。
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
  }
}
