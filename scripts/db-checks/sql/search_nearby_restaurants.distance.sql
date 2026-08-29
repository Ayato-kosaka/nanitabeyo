WITH 
      nearby AS (
        -- #1629 距離順のときは KNN（location <-> 点）で GIST 索引から «近い順に limit 件» を直接取る
        SELECT r.id
        FROM restaurants r
        WHERE
          -- #1629 ST_DWithin + 既存 GIST（詳細は searchNearbySavedRestaurants 側のコメント）
          ST_DWithin(r.location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)
          
        ORDER BY r.location <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography LIMIT ?
      ),
      base AS (
        SELECT n.id, 0 AS tier FROM nearby n
      ),
      candidates AS (
        -- 入札・投稿数の集計は candidates の中で完結させる（レビュー集計と同じ GROUP BY に混ぜない）
        SELECT
          b.id,
          b.tier,
          
          (
            SELECT COUNT(*)::int
            FROM dishes d2
            JOIN dish_media dm2 ON dm2.dish_id = d2.id AND dm2.deleted_at IS NULL
            WHERE d2.restaurant_id = b.id
          ) AS post_count,
          bid.total_cents,
          bid.max_end_date
        FROM base b
        
        JOIN LATERAL (
          SELECT
            COALESCE(SUM(rb.amount_cents), 0)::double precision AS total_cents,
            MAX(rb.end_date) AS max_end_date
          FROM restaurant_bids rb
          WHERE rb.restaurant_id = b.id
            AND rb.start_date <= CURRENT_DATE
            AND rb.end_date > CURRENT_DATE
            AND rb.status = 'paid'
        ) bid ON TRUE
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
        -- #843 catalog 同期の metadata
        r.source_seed_id,
        r.source_names,
        r.source_row_hash,
        r.synced_at,
        -- #843 その行を誰が作ったか。9_1 の同期はこの値が 'pipeline' の行だけを上書きする
        r.created_by_source,
        c.total_cents,
        c.max_end_date,
        agg.review_count,
        agg.average_rating
      FROM candidates c
      JOIN restaurants r
        ON r.id = c.id
      /*
        #1629 【設計】**レビュー集計も «候補 1 件ずつの LATERAL» で回す。**

        旧実装は LEFT JOIN dishes → LEFT JOIN dish_reviews → GROUP BY r.id だった。
        候補は limit 件しか無いのに、プランナが dish_reviews を Seq Scan して
        Hash Right Join するプランを選びうる（searchNearbySavedRestaurants で
        実際に踏み、それだけで 27 ms 使っていた。#1682）。dish_reviews が育つほど伸びる。

        LATERAL の集計副問い合わせは pull up されないので、**必ず候補ごとの
        idx_dishes_restaurant → idx_dish_reviews_alive_dish の nested loop になる**。

        集計は GROUP BY 無しなので必ず 1 行返る（ON TRUE で件数は変わらない。
        レビュー 0 件の店は review_count = 0 / average_rating = 0 になり、
        LEFT JOIN + GROUP BY だった旧実装と同じ値になる）。
      */
      JOIN LATERAL (
        SELECT
          COUNT(dr.id)::int                             AS review_count,
          COALESCE(AVG(dr.rating), 0)::double precision AS average_rating
        FROM dishes d
        JOIN dish_reviews dr
          -- #1513 削除済みレビューを件数・平均に混ぜない
          ON dr.dish_id = d.id AND dr.deleted_at IS NULL
        WHERE d.restaurant_id = r.id
      ) agg ON TRUE
      ORDER BY ST_Distance(r.location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography) ASC
      LIMIT ?;
