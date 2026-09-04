WITH
    -- ========== パラメタ ==========
    params AS (
      SELECT
        CAST(?  AS uuid)   AS user_id,
        CAST(?  AS double precision) AS user_lat,
        CAST(?  AS double precision) AS user_lon,
        CAST(?  AS double precision) AS radius_m,
        -- CAST('openAt'  AS timestamptz)      AS open_at,
        CAST(?  AS text)           AS category_id,
        -- CAST('priceMin'  AS numeric)          AS price_min,
        -- CAST('priceMax'  AS numeric)          AS price_max,
        CAST(? AS integer) AS limit_count,
        CAST(?  AS double precision) AS gumbel_tau, -- ランキングに “ゆらぎ（探索）” をどれだけ入れるかの強さ。
        CAST(?  AS text)             AS page_seed,
        current_timestamp                           AS now_ts,
        -- geography のユーザ位置
        ST_SetSRID(
          ST_MakePoint(
            CAST(? AS double precision),
            CAST(? AS double precision)
          ),
          4326
        )::geography AS user_geog,
        -- 距離減衰パラメタ
        GREATEST(2.0, 0.3 * (?::double precision / 1000.0)) AS d0
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
    /* ========== 候補集合（Stage0: 地理フィルタ） ==========
       #1666 定義は nearby-restaurants-cte.ts が正本。**ここへ書き戻さないこと** —
       上の営業時間の引き上げが「同じ候補集合」を対象にしていることが崩れ、
       検索 1 回ごとに全店ぶんの restaurant_opening_hours を引くようになる。
       ⚠️ ここはテンプレートリテラルの中なので、コメントにバッククォートを書かないこと
          （文字列が途中で閉じて構文エラーになる）。 */
    
    knn_params AS (
      SELECT
        ST_SetSRID(
          ST_MakePoint(
            CAST(? AS double precision),
            CAST(? AS double precision)
          ),
          4326
        )::geography AS user_geog,
        CAST(? AS double precision) AS radius_m,
        CAST(? AS integer) AS knn_limit
    ),
    candidates_radius AS (
      SELECT
        r.id AS restaurant_id,
        r.location AS rest_geog
      FROM restaurants r
      WHERE ST_DWithin(
              r.location,
              (SELECT user_geog FROM knn_params),
              (SELECT radius_m FROM knn_params)
            )
    ),
    nearby_restaurants AS (
      SELECT cr.restaurant_id, cr.rest_geog
      FROM candidates_radius cr
      ORDER BY cr.rest_geog <-> (SELECT user_geog FROM knn_params)  -- KNN
      LIMIT (SELECT knn_limit FROM knn_params)
    )
  ,
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
        /* #1798 「使える dish_media」の判定（論理削除されていない / 投稿者が退会していない /
           実体が届いている / 埋め込みが再生不能と分かっていない）は
           usable-dish-media-filter.ts の USABLE_DISH_MEDIA_CONDITIONS に一本化してある
           （findDishMediaByRestaurant と同じ定義を使う。理由もそちらに書いてある）。

           ⚠️ 置き場所は base_candidates（ROW_NUMBER より**前**）である。後段で外すと、
              「1 dish につき 1 本」の枠を使えない投稿が取ってしまい、
              **その料理が丸ごとフィードから消える**（#1257 / #1641 で実際に踏んだ罠）。 */
        
  AND dm.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = dm.user_id
      AND u.deleted_at IS NOT NULL
  )
  AND dm.media_processing_status = 'completed'
  AND NOT EXISTS (
    SELECT 1 FROM dish_media_external_embeddings dmee
    WHERE dmee.dish_media_id = dm.id
      AND dmee.playback_status = 'not_playable'
  )

        /* #288 / #1666 「営業時間が分かっていて、選んだ timeSlot には閉まっている」店は
           候補集合から除外する。closedRestaurantIds は JS 側で3値判定を済ませた結果
           （shared/utils/openingHours.ts）。「分からない」店（大多数）と timeSlot 未指定時は
           ここに入らないので無条件で候補に残る。 */
        AND NOT (d.restaurant_id = ANY(?::uuid[]))
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
    -- #288 / #1666 営業時間が「分かっていて、選んだ timeSlot に開いている」店だけ加点する（openRestaurantIds も
    -- JS 側の3値判定の結果。closed は base_candidates で既に除外済みなので、ここに来る行は
    -- open か unknown のどちらか。unknown は今までどおり is_open_at=false と同じ扱いになる）
    open_flags AS (
      SELECT
        g.*,
        (g.restaurant_id = ANY(?::uuid[])) AS is_open_at
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
