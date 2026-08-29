WITH 
      post_counts AS MATERIALIZED (
        /*
          #1629 【設計】**投稿数の集計は «restaurants と混ぜずに» 1 回で終わらせる。**

          最初の実装は dish_media / dishes / restaurants を 1 つの WHERE に混ぜ、
          そこへ半径（ST_DWithin）まで入れていた。全国規模の半径では restaurants の
          ほぼ全件が条件を満たすため、プランナは «restaurants → dishes → dish_media» の
          順に nested loop を選び、**dish_media を店舗ごとに Seq Scan** した。

          dev 実測（run 33172881100・EXPLAIN ANALYZE）:
            Seq Scan on dish_media (rows=4896, loops=2357)  = 延べ 1,150 万行
            日本全体 225 ms → **3,478 ms** / 50km 107 ms → **2,188 ms**
          並びを変えただけで 15〜20 倍遅くなっていた。

          そこで «店ごとの投稿数» だけを先に 1 回で作る。MATERIALIZED を付けるのは、
          外して inline されると上と同じ nested loop へ戻るためである（Postgres 12 以降、
          CTE は既定で inline されうる）。**この 2 語を消さないこと。**

          ⚠️ ここは dish_media の全行を 1 回走る。いまは 4,896 行なので安いが、
             投稿が数百万行に育ったら restaurants への非正規化列
             （post_count + btree）か集計済みビューが要る。
        */
        SELECT d.restaurant_id AS id, COUNT(*)::int AS post_count
        FROM dish_media dm
        JOIN dishes d ON d.id = dm.dish_id
        -- #1513 削除済みの投稿は数えない
        WHERE dm.deleted_at IS NULL
        GROUP BY d.restaurant_id
      ),
      posted AS (
        /*
          #1629 【設計】**投稿枠の駆動表は «投稿を持つ店（post_counts）» でなければならない。
          restaurants 側を先に半径で絞らせてはいけない。**

          ## 何が起きていたか（オーナーが実機で踏んだ回帰）

          «投稿が多い順» を入れた commit 3dfd061d のあと、dev の
          GET /v1/restaurants/search（東京駅・半径 20,000m・limit 20）が
          **7,625 / 16,222 / 25,954 ms** かかった（queue_ms は 1〜2 ms なので接続待ちではない）。
          ところが同じ SQL を literal 埋め込みで EXPLAIN ANALYZE すると 46〜270 ms で速い。
          **測り方が実運用と違っていた**のが «速く見えていた» 理由である。

          ## 真因（force_generic_plan で再現させて確定させた）

          この CTE は「post_counts と restaurants を普通に join し、restaurants 側へ
          ST_DWithin を掛ける」形だった。半径がバインドパラメータなので、
          **generic plan ではプランナに半径の値が見えない**。GIST 索引の行数見積りは
          既定値（rows=57）へ落ち、「restaurants を索引で引けば数十行」と誤認する。
          その結果 **restaurants を build 側にした Hash Join**（= 半径内の全店を読む）を選ぶ。

          再現環境（restaurants 570,000 行 / 投稿を持つ店 7,990 / limit 20）の実測:

            旧: 半径 20km   … restaurants から延べ 117,935 行  / generic 425 ms
                半径 1,500km … 延べ **558,060 行**（ほぼ全店） / generic 1,897 ms
            新: 半径 20km   … 延べ 60 行                      / generic 116 ms
                半径 1,500km … 延べ 8,050 行（= 投稿を持つ店） / generic 124 ms

          走る行数が半径に比例するのが旧、半径に依存しないのが新である。dev の
          restaurants は 1 行が address_components（JSONB）ぶん太いので、
          この «半径内の全店を読む» が remote storage 上では秒単位になる。
          同じ半径で 7.6 秒と 26 秒が混在するのは、custom plan と generic plan が
          切り替わる（＋ページがキャッシュに載っているか）ためである。

          ## どう直したか

          **post_counts（投稿を持つ店だけの小さな集合）を外側に置き、
          LATERAL で 1 行ずつ restaurants を主キーで引いて半径を判定する。**
          searchNearbySavedRestaurants（#1682）と同じ構えである。
          LATERAL の内側は外側の行を参照するので、プランナは nested loop 以外を選べない。

          ⚠️ この SQL のコメントに **半角の疑問符**を書かないこと。Prisma.Sql#sql は
             バインド位置を半角疑問符で表現するため、コメントの中に混ざると
             ダンプした SQL からプレースホルダを数える側が位置をずらす
             （scripts/db-checks/measure_order_by_posts.py が実際にずれた）。
             restaurants.order-by-posts-plan.spec.ts が個数一致を機械検査している。

          ⚠️ LIMIT 1 を消さないこと。これが無いと副問い合わせが pull up されて
             普通の join に均され、上の悪いプランへ戻る余地が生まれる。
             r.id = pc.id は主キー一致なので、LIMIT 1 は意味を変えない。

          ⚠️ 並び（投稿が多い順 → 同数なら中心から近い順）も、返る行も、
             書き換えの前後で完全に同一であることを再現環境で確認済み
             （半径 20km / 1,500km の両方で 20 行が完全一致）。
        */
        SELECT
          pc.id,
          pc.post_count,
          hit.distance_m
        FROM post_counts pc
        JOIN LATERAL (
          SELECT ST_Distance(r.location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography) AS distance_m
          FROM restaurants r
          WHERE r.id = pc.id
            AND ST_DWithin(r.location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)
            
          LIMIT 1
        ) hit ON TRUE
        -- 同数なら中心から近い順。«どの limit 件を残すか» を最終 ORDER BY と一致させる
        ORDER BY pc.post_count DESC, hit.distance_m ASC LIMIT ?
      ),
      nearest AS (
        -- #1629 近傍枠。投稿枠で埋まらない残りを «中心から近い順» で埋める。
        -- ここが «引くと 0 件» を構造的に消している（半径内に投稿が 1 件も無くても必ず埋まる）
        SELECT r.id
        FROM restaurants r
        WHERE
          ST_DWithin(r.location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)
          
          AND NOT EXISTS (SELECT 1 FROM posted p WHERE p.id = r.id)
        ORDER BY r.location <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography LIMIT ?
      ),
      base AS (
        SELECT id, 0 AS tier, post_count FROM posted
        UNION ALL
        -- 投稿ゼロの店。post_count = 0 の同着なので、最終 ORDER BY で «近い順» に並ぶ
        SELECT id, 1 AS tier, 0::int AS post_count FROM nearest
      ),
      candidates AS (
        -- 入札は並びに使わないが meta としては返す。候補が limit 件に決まったあとに集計する
        SELECT
          b.id,
          b.tier,
          b.post_count,
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
      ORDER BY c.tier ASC, c.post_count DESC, ST_Distance(r.location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography) ASC, r.id ASC
      LIMIT ?;
