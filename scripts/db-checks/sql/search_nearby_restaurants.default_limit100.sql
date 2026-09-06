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
        ORDER BY pc.post_count DESC, hit.distance_m ASC LIMIT 100
      ),
      nearest AS (
        /*
          #1629 【設計】**近傍枠は «KNN を内側に閉じ、半径は外側で掛ける»。
          KNN と ST_DWithin を同じ WHERE に並べてはいけない。**

          投稿枠で埋まらない残りを «中心から近い順» で埋める枠である。
          ここが «引くと 0 件» を構造的に消している（半径内に投稿が 1 件も無くても埋まる）。

          ## 何が起きていたか（#1686 のあと dev に残っていた回帰）

          #1686 で generic plan は直ったが、**custom plan が 11〜13 秒のまま**だった
          （dev 実測 run 33229509189。東京駅 20km で 11,498 ms / 日本全体で 12,893 ms、
          いずれも restaurants から 15 万〜57 万行を読んでいた）。
          50km だけ 35 ms と速く、**半径に対して単調ですらなかった**。

          ## 真因（再現環境で dev と同じプランを出して確定させた）

          旧実装は同じ WHERE に ST_DWithin と KNN（ORDER BY location <-> 点）を並べていた。
          この形はひとつの GIST 索引に対して **2 通りの経路**を許す:

            (a) KNN 索引スキャンを近い順に舐めて LIMIT 件で打ち切る（速い。行数は LIMIT で一定）
            (b) ST_DWithin で Bitmap 索引スキャンし、**半径内を全部**取ってから並べ替える（遅い）

          プランナは (b) を選びうる。理由は見積りにある。ST_DWithin をフィルタとして見たときの
          行数見積りは PostGIS の既定へ落ちて **LIMIT より小さい**（dev では rows=18 < 20）。
          «20 件そろえるには索引を最後まで舐めることになる» と誤認するので (a) が極端に高く
          値付けされ、(b) が勝つ。半径の «値» が見えている custom plan でのみ起きるので、
          **generic だけ速く custom だけ遅い**という倒錯した形になっていた。

          再現環境（restaurants 570,000 行 / max_parallel_workers_per_gather=4 /
          random_page_cost=1.1 ＝ dev と同じプランが出る設定）での実測:

            旧 custom 20km   … Parallel Bitmap Heap Scan + Sort。延べ 272,612 行 / 1,028 ms
            旧 custom 1,500km … 延べ 574,385 行 / 1,822 ms
            新 custom 20km   … KNN 索引スキャン。延べ 60 行 / 12 ms

          ## どう直したか

          **内側の副問い合わせには KNN と LIMIT だけを置き、ST_DWithin を外側へ出す。**
          内側に location の絞り込みが無いので (b) の経路は存在せず、
          プランナは KNN 索引スキャン以外を選べない。LIMIT 20 を取り出すコストは
          «索引を最後まで舐める» ではなく «20 件ぶん» に値付けされる（実測でコスト
          605,506 → 17.78）。custom / generic のどちらでも同じ速いプランになる。

          ## 半径の外を返さないこと・0 件にしないことは壊れていない

          «距離順に並べて上位 n 件を取り、あとから半径で切る» のは、
          «先に半径で切ってから距離順に上位 n 件を取る» と **完全に同値**である。
          半径で落ちる行は残る行より必ず遠いので、順位が入れ替わることがない
          （距離のしきい値は距離順に対して prefix-closed）。したがって:
            - 半径の外の店が混ざることはない（外側で必ず切っている）
            - 半径内に店があるのに 0 件になることもない
          再現環境の半径 1km / 20km / 50km / 1,500km で、返る行が旧実装と完全一致することを確認済み。

          ⚠️ 内側の LIMIT を消さないこと。PostgreSQL は LIMIT 付き副問い合わせへ
             外側の条件を押し込まないので、この LIMIT が «ST_DWithin が内側へ戻る» のを
             止めている。消すと (b) の経路が復活する。

          ⚠️ ST_DWithin を内側に «念のため» 併記しないこと。それが (b) を生む条件そのものである。

          ⚠️ geography の <-> は球、ST_DWithin は既定で回転楕円体で測るので、
             両者は 0.3% 程度ずれる。**ちょうど半径の境目にある店が、ちょうど limit 番目に
             来た**ときだけ 1 件多い / 少ないが起こりうる。旧実装も同じ 2 つを併用していたので
             ずれの大きさは変わらない。
        */
        SELECT k.id
        FROM (
          SELECT r.id, r.location
          FROM restaurants r
          -- ⚠️ ここには **location の条件も、posted との突き合わせも置かない**。
          --    どちらも «KNN 索引スキャン以外の経路» をプランナへ与えてしまう
          --    （ST_DWithin は Bitmap 経路を、NOT EXISTS は Hash Anti Join + Seq Scan を生む。
          --     後者は実測で restaurants 570,000 行の Seq Scan になった）。
          --    この枝で nameFilter は常に空である（店名検索は orderByDistance へ回る）。
          --    それでも書いてあるのは、将来この枝へ店名検索を回したときに
          --    «絞り忘れで誤った結果を返す» ことがないようにするためである
          
          ORDER BY r.location <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography LIMIT 100
        ) k
        WHERE ST_DWithin(k.location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)
      ),
      base AS (
        SELECT id, 0 AS tier, post_count FROM posted
        UNION ALL
        /*
          投稿ゼロの店。post_count = 0 の同着なので、最終 ORDER BY で «近い順» に並ぶ。

          #1629 【設計】**投稿枠との重複除去はここで行う。近傍枠の中へ入れない。**
          NOT EXISTS を KNN の副問い合わせの中に置くと、プランナが
          Hash Anti Join + restaurants の Seq Scan（570,000 行）を選んでしまい、
          KNN 索引スキャンが使われなくなる（再現環境で実測。1,432 ms）。
          ここへ出せば突き合わせる相手は高々 limit 件どうしなので、ただの小さな集合演算になる。

          ⚠️ 件数は減らない。近傍枠は «半径内で近い順に limit 件»、投稿枠は高々 limit 件で、
             重なるのは高々 «投稿枠の件数 p» 件である。よって
             重複除去後の近傍枠は (limit - p) 件以上残り、
             投稿枠 p 件と合わせて必ず limit 件に届く（半径内の総数が limit 未満のときは
             その総数。これは旧実装と同じ）。
        */
        SELECT n.id, 1 AS tier, 0::int AS post_count
        FROM nearest n
        WHERE NOT EXISTS (SELECT 1 FROM posted p WHERE p.id = n.id)
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
          r.image_path,
        r.address_components,
          r.created_at,
        -- #843 catalog 同期の metadata
        r.source_seed_id,
        r.source_names,
        r.source_row_hash,
        r.synced_at,
        -- #843 その行を誰が作ったか。9_1 の同期はこの値が 'pipeline' の行だけを上書きする
        r.created_by_source,
        r.address,
        r.country_code,
        r.subterritory_code,
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
      LIMIT 100;
