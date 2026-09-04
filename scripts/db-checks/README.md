# scripts/db-checks — 本番 DB を「読むだけ」で測るスクリプト置き場

どれも **読み取り専用**（`conn.set_session(readonly=True)`、または接続直後に
`SET default_transaction_read_only = on`）。書き込み・DDL は行わない
（一時テーブルを作るものだけは、作成後に read-only へ切り替える）。

実行は `db-script-run.yml`（workflow_dispatch）から。資格情報をローカルへ置かず、
「いつ・誰が・どの引数で回したか」を run のログに残すため。

## 判定は写経しない — この置き場の一番大事な約束

```
     本番のコード                    自動生成                  計測スクリプト
  ┌──────────────────────┐      ┌──────────────────┐      ┌────────────────────┐
  │ usable-dish-media-   │─jest→│ sql/usable_dish_ │─読む→│ dish_media_        │
  │ filter.ts（正本）    │      │ media_conditions │      │ coverage_sql.py    │
  └──────────────────────┘      │ .sql             │      └────────────────────┘
  ┌──────────────────────┐      ├──────────────────┤      ┌────────────────────┐
  │ restaurants.         │─jest→│ sql/search_      │─読む→│ measure_order_by_  │
  │ repository.ts        │      │ nearby_*.sql     │      │ posts.py           │
  └──────────────────────┘      ├──────────────────┤      └────────────────────┘
  ┌──────────────────────┐      │ sql/opening_     │      ┌────────────────────┐
  │ restaurant-opening-  │─jest→│ status.*.sql     │─読む→│ explain_opening_   │
  │ status.ts            │      └──────────────────┘      │ status.py          │
  └──────────────────────┘                                └────────────────────┘
        ↑ ここだけが正本            ↑ 手で書かない              ↑ 条件を書き足さない
```

**同じ判定を 2 箇所に書いた時点で、ずれるのは時間の問題である。**
実際に 2026-08-28 に fixture で、08-29 に検知 SQL で、09-04 に coverage 計測で
同じ形の事故が起きている（計測側が古い判定のまま緑を出し続け、
**「Google を外せるか」の判断材料が静かに嘘になっていた**）。

書き出しは jest 側が持つ。ずれたら `pnpm --filter api exec jest` が赤くなる。
更新のしかたは各 `sql/*.sql` の先頭コメントにある。

## 何を測るスクリプトがあるか

| スクリプト | 測るもの | 主な引数 |
| --- | --- | --- |
| `measure_dish_media_coverage.py` | **#1782** area(S2 セル) × JP gate カテゴリ の店提案 coverage。5 段階を別々に出す | `--schema dev` |
| `measure_price_coverage.py` | **#1774** `dish_reviews.price_cents` の充足率・通貨内訳 | `--schema dev` |
| `measure_review_coverage.py` | **#1264** レビューの自社 UGC / Google 取り込みの内訳 | `--schema dev` |
| `measure_order_by_posts.py` | **#1629/#1686** 店舗検索が索引に乗り続けているか（custom / generic 両プラン） | `--schema dev --assert` |
| `explain_opening_status.py` | **#1666** 営業時間の引き上げが「近くの候補集合」に閉じているか | `--schema dev --assert` |
| `measure_restaurants_nearby.py` / `measure_saved_restaurants.py` / `measure_wide_area_search.py` / `measure_map_pins_distribution.py` | 近傍検索まわりの実測 | `--schema dev` |
| `measure_external_embed_thumbnails.py` | 外部埋め込みのサムネイル欠落 | `--schema dev` |
| `audit_schema_drift.py` / `audit_schema_indexes.py` / `assert_index_valid.py` | スキーマ・索引の点検 | `--schema dev` |
| `diagnose_slow_db.py` | 遅いクエリの切り分け | `--schema dev` |

## 回し方

```
# db-script-run.yml を workflow_dispatch で実行する
script_path:       scripts/db-checks/measure_dish_media_coverage.py
args:              --schema dev
requirements_path: scripts/20251213T0000_wikidata_food_graph/requirements.txt
```

`--assert` を持つスクリプトは、劣化していたら終了コード 1 を返す（ラチェットとして使える）。

⚠️ **`--schema public`（本番）は、オーナーが `public` という語を自分から出したときにしか
使わない。** 読み取り専用でも同じ（CLAUDE.md「DB を変更するときの規則」）。

## #1782 の coverage を追うとき

```
script_path: scripts/db-checks/measure_dish_media_coverage.py
args:        --schema dev --out-json /tmp/coverage.json
```

出るもの（JSON にも同じものが入る）:

| | 意味 |
| --- | --- |
| `covered_at_or_above_min_restaurants` | **成立している** area × カテゴリ の数（既定は 5 店舗以上） |
| `covered_below_min_restaurants` | 1〜4 店舗。**あと少しで成立する**（投稿が増えれば変わる） |
| `covered_zero_restaurants` | 0 店舗。**そのエリアにその料理の店を見つけるところから**（#1273 の担当） |
| `shortfall_by_category` | 惜しいセルを多く抱えているカテゴリ順。**どの料理から手を付けるかはここで決まる** |
| `shortfall_cells` | 惜しいセルの一覧（惜しい順） |

⚠️ **合計値だけを見て打ち手を決めないこと。** dev 実測（2026-09-03）では
16,861,756 組のうち 97.2% が 0 店舗で、合計を見ても「全部足りない」としか分からない。
動かせるのは `shortfall_*` の側である。

⚠️ **`8_1_validate_catalogs.py` とは測っているものが違う。** あちらは BigQuery の
catalog（「載っているか」）、こちらは PostgreSQL の実データ（「本番の店提案で実際に
返せるか」）。**その差こそが #1782 の存在意義**なので、統合しないこと。
