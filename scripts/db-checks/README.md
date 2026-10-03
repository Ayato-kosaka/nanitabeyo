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
  │                      │      │ .sql             │─読む→│ measure_restaurant_│
  │                      │      │                  │      │ images.py          │
  ┌──────────────────────┐      ├──────────────────┤      ┌────────────────────┐
  │ restaurants.         │─jest→│ sql/search_      │─読む→│ measure_order_by_  │
  │ repository.ts        │      │ nearby_*.sql     │      │ posts.py           │
  └──────────────────────┘      ├──────────────────┤      └────────────────────┘
  ┌──────────────────────┐      ├──────────────────┤      ┌────────────────────┐
  │ restaurant-opening-  │─jest→│ sql/opening_     │─読む→│ explain_opening_   │
  │ status.ts            │      │ status.*.sql     │      │ status.py          │
  └──────────────────────┘      ├──────────────────┤      └────────────────────┘
  ┌──────────────────────┐      │ sql/dish_media_  │      ┌────────────────────┐
  │ dish-media.          │─jest→│ search.sql       │─読む→│ explain_dish_media_│
  │ repository.ts        │      └──────────────────┘      │ search.py          │
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
| `explain_dish_media_search.py` | **#1666** 店提案の本体クエリが索引に乗り続けているか（custom / generic 両プラン） | `--schema dev --assert` |
| `measure_restaurants_nearby.py` / `measure_saved_restaurants.py` / `measure_wide_area_search.py` / `measure_map_pins_distribution.py` | 近傍検索まわりの実測 | `--schema dev` |
| `measure_restaurant_images.py` | **#1780** Google 由来画像を消したときに「見た目が変わる」店の数 | `--schema dev` |
| `measure_external_embed_thumbnails.py` | 外部埋め込みのサムネイル欠落 | `--schema dev` |
| `audit_schema_drift.py` / `audit_schema_indexes.py` / `assert_index_valid.py` | スキーマ・索引の点検 | `--schema dev` |
| `diagnose_slow_db.py` | 遅いクエリの切り分け | `--schema dev` |

## 回し方

```
# db-script-run.yml を workflow_dispatch で実行する
script_path:       scripts/db-checks/measure_dish_media_coverage.py
args:              --schema dev
requirements_path: scripts/20260808T0000_restaurant/requirements.txt
```

⚠️ **`requirements_path` はこの 1 本で固定する（`scripts/20260808T0000_restaurant/requirements.txt`）。**
ここに `scripts/20251213T0000_wikidata_food_graph/requirements.txt` と書いてあった時期があり、
**`measure_dish_media_coverage.py` が `ModuleNotFoundError: No module named 's2sphere'` で落ちた**。
`normalization.s2_cell_id()` は `s2sphere` を**関数の中で**読むので、import 行を見ても気づけない。

全スクリプトの import を当たり直した結果（2026-09-21）:

| 必要なもの | どのスクリプトか | どこに入っているか |
| --- | --- | --- |
| `psycopg2-binary` | ほぼ全部 | 両方に入っている |
| `s2sphere` | `measure_dish_media_coverage.py`（`normalization.s2_cell_id()` 経由・遅延 import） | **20260808T0000_restaurant のみ** |
| `google-cloud-bigquery` / `-storage` | `measure_price_band_coverage.py` / `measure_rating_coverage.py`（`pg_sync_common` 経由） | **20260808T0000_restaurant のみ** |

つまり **20260808T0000_restaurant の 1 本がすべてを覆う**。迷ったらこれを指定すること。

⚠️ **重いクエリは `--statement-timeout-s` で殺される。** 既定 300 秒で、超えると
`QueryCanceled` になる（`measure_dish_media_coverage.py` の Stage5 が代表例）。
⚠️ **ここに «落ちたら `--s2-level` を小さく（粗く）する» と書いてあったのを外した（2026-10-01）。**
`--s2-level` は **area の定義そのもの**なので、変えると `2.34% → 13.3% → 29.1%` の推移と
**並べられない数字**になる。落ちたときの手は «定義を変える» ではなく、下の 2 つである:

| 症状 | 見るもの | 手 |
| --- | --- | --- |
| `QueryCanceled`（既定 300 秒） | 時間 | `--statement-timeout-s` を伸ばす |
| `DiskFull` | **ログの «Stage5 の起点» の行数** | `--cell-batch-size` を**小さく**する（下記） |

どちらも «DB が壊れている» のサインではないので、先に閾値を疑うこと。

⚠️ **ただし `DiskFull` は閾値の問題ではない。** 2026-10-01 に Stage5 が
`DiskFull: could not write to file "base/pgsql_tmp/..."` で落ちた
（[run 36816039711](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36816039711)）。
半径 20km の `ST_DWithin` は 1 行が数千セルに当たるので、**起点の行数がそのまま
中間結果の倍率になる**。`--statement-timeout-s` を伸ばしても溢れる量は変わらない。
見るのは時間ではなく **ログの «Stage5 の起点» の行数**で、そこが大きいなら
起点の畳み込み（`build_stage5_driver_temp_table_sql`）が効いていない。
⚠️ **このインスタンスは dev と public が同居している**（[#2006](https://github.com/Ayato-kosaka/nanitabeyo/issues/2006)）。
«読み取り専用だから安全» は一時ファイルには当てはまらない。
そのため Stage5 は `--temp-file-limit-mb`（既定 4096）で**自分のセッションの一時ファイルに
上限を張る**。⚠️ `temp_file_limit` は **superuser でないと張れず、Supabase の `postgres` は
superuser ではない**ので、実際にはほぼ毎回 `⚠️ 一時ファイルの上限（4,096 MB）は張れません`
が出る。**出ていたらその run は共有ディスクの側で落ちうる**ので、起点の行数を先に見ること。

⚠️ **この «保険» は一度、本体を殺した。** «SET して失敗したら警告して続行» と書いていたら、
失敗した SET がトランザクションを abort させ、次の文が `InFailedSqlTransaction` で死んだ
（[run 36819189609](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36819189609)。
起点の畳み込みは効いて 904,118 → 148,892 行になっていたのに、止めたのは保険自身だった）。
いまは **`is_superuser` を先に聞いて、張れないなら SET を投げない**。
**失敗しうる文を «保険» として足すときは、失敗が本体へ波及しないかまで見ること。**

⚠️ **したがって一時ファイルを抑える手段は `--cell-batch-size`（既定 2000）だけである。**
Stage5 を «このバッチのセルだけ» へ絞って何回かに分け、件数・上位 N・カテゴリ別は
Python 側（`Stage5Accumulator`）で足し合わせる。**セルはどのバッチにも 1 回しか現れないので、
一括と同じ値になる。** `0` を渡すと一括（比較用）。落ちたら伸ばすのではなく **小さくする**。

⚠️ **重い集計はバッチあたり 1 回だけ評価する。** 以前は «件数バケット / 上位セル /
惜しいセル / カテゴリ別» を SQL 4 本に分けており、**同じ集計を 4 回**評価していた。
dev では 63 バッチ × 4 = 252 回になり、[run 36820246635](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36820246635)
は **65 分でも終わらなかった**。dev と public は同じインスタンスなので、
**4 倍の仕事は 4 倍の迷惑**である。閾値・並べ替え・上限は `Stage5Accumulator` だけに置き、
SQL 側には `HAVING` / `ORDER BY` / `LIMIT` を書かない（2 箇所に書くとずれる）。

`--assert` を持つスクリプトは、劣化していたら終了コード 1 を返す（ラチェットとして使える）。

⚠️ **`--schema public`（本番）は、オーナーが `public` という語を自分から出したときにしか
使わない。** 読み取り専用でも同じ（CLAUDE.md「DB を変更するときの規則」）。

## #1782 の coverage を追うとき

```
script_path:       scripts/db-checks/measure_dish_media_coverage.py
args:              --schema dev --out-json /tmp/coverage.json
requirements_path: scripts/20260808T0000_restaurant/requirements.txt
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
