#!/usr/bin/env python3
"""#1273 収集する «順番» を決める: 未収集ハンドルを «1 コールあたり何店取れるか» で並べる。

## なぜこれが要るか（2026-09-05 実測）

投稿収集（`4_2_collect_account_posts.py`）の律速は **Instagram Graph API の
business_discovery（アプリ単位 ~200 コール/時）**である。1 ハンドル ≒ 1 コールなので、
**«どのハンドルに 1 コール使うか» がそのまま成果**になる。ところが今の順番は
«見つけた順» で、実測の取れ高は 100 倍以上ばらついていた。

`sns_source_account` の 163,215 ハンドルのうち収集済みは 43,710。**未収集は 119,505 件**で、
全部回すと ~25 日かかる。だから «どのハンドルに 1 コール使うか» が成果そのものになる。

分子は **配信カタログ `sns_dish_media_catalog` に載る異なり店**（最新 run・全体 19,336 店）。
`sns_post_resolved.status='matched'` では数えない（訂正 1）。

| 段 | 収集済 | 未収集 | **配信店/コール** | 未収集を全部回した期待配信店数 |
| --- | ---: | ---: | ---: | ---: |
| A 人が選んだ influencer_list | 377 | **115** | **26.4**（22〜49） | ~3,000 |
| B 店アカウント（seed 有） | 5,446 | **29,864** | **0.550** | 16,425 |
| C 地域語のみ（非 curated） | 4,132 | 13,089 | 0.145 | 1,898 |
| D 料理語のみ（非 curated） | 580 | 1,245 | 0.121 | 151 |
| E その他（非 curated） | 33,038 | 75,130 | 0.056 | 4,207 |

**順は A → B → それ以外。** A は 115 件しか無いが 1 コールあたり B の ~48 倍なので必ず先に回す。
A を使い切った後の本体は **B（店アカウント）** で、これは柱1 が既に進めている並びである。

### ⚠️ 訂正 2（2026-09-05 夕）— «ハンドル文字列が効く» は間違いだった

初版は «料理語 × 地域語 のハンドル（`sapporo_gourmet` 型）は 15.3 店/コールで、
店アカウント（0.550）の 28 倍» と報告した。**交絡である。**

`influencer_list`（人が手で選んだグルメアカウントの一覧）に載っているかどうかで層別すると:

| 段 | curated あり | **curated なし** | 未収集のうち curated |
| --- | ---: | ---: | ---: |
| 料理語 × 地域語 | 49.455 | **0.076** | 2 / 57 |
| 料理語のみ | 40.115 | **0.121** | 5 / 1,250 |
| 地域語のみ | 38.145 | **0.145** | 14 / 13,103 |
| 料理語も地域語も無い | 22.202 | **0.056** | 94 / 75,224 |

- 高い取れ高を出していたのは «ハンドルに `gourmet` と `sapporo` が入っている» ことではなく
  **«人が影響力アカウントとして選んだ»** ことだった。
- **curated を除くと、料理語・地域語の段（0.076〜0.145）は店アカウント段（0.550）より下**。
  未収集プールはほぼ全部 curated ではない（A 段の未収集 57 件のうち curated は 2 件）。
- したがって初版の «A→B→C へ並べ替えれば 2.4 倍» は **誤り**。その順で回すと
  15,768 コールで ~4,950 店にしかならず、**同じ枠を店アカウントに使う（8,672 店）より悪い**。
- 正しい効果は «**curated 未収集 115 件を最初に回す**» ことだけ:
  115 コールで ~3,000 店（同じ 115 コールを店アカウントに使うと 63 店）。
  15,768 コール全体では 8,672 → 11,530 店＝ **+33%**。

言及回数（`mention_posters`）も非 curated では効かなかった（0 回 0.054 / 1 回 0.083 /
2 回以上 0.039）。**未収集プールで大きく効く特徴は `store_attributed` だけ**（0.550 対 0.056）。

### 教訓

«選択バイアスは除いた» と最初に書いた確認（`cc_wat_profile` 部分集合）は
**分子が `matched` のときだけ成り立っていて、配信ベースで層別し直すと消えた**。
交絡の確認は «成果指標を確定させてから» やること。

## この script がやること

1. `sns_source_account` の全ハンドルへ、**コールを使わずに分かる特徴だけ**を付ける
   - `has_food_token` / `has_region_token`（下の語彙。ハンドルは ASCII なのでローマ字）
   - `store_attributed`（`discovery_seed_place_id` を持つ ＝ 店アカウント。店は確定するが
     取れ高は低い）
   - `mention_posters`（キャプション中で何人の投稿者に言及されたか。抽出規則の正本は
     `common_sns.bare_handle_candidate_sql`。ここで書き直さない）
2. **同じ run の中で収集済みハンドルを使って各段の取れ高を実測し**、その実測値を
   そのまま score（＝ 期待 異なり店/コール）にする（**係数を焼き付けない**。
   収集が進めば較正も動く）
3. 未収集ハンドルを score 順に `sns_account_candidate_v2` へ書く

## 書かないもの

`sns_post_raw` / `sns_name_place_lookup` / `sns_source_account` へは **書かない**
（同時に走っている他の収集ジョブと DML がぶつかる）。ここは候補表を作るだけで、
実際に 4_2 を回す run_id を切るのは呼び出し側の判断。

## 使い方

    # 較正表だけ出す（BQ は読むだけ。候補表も書かない）
    python3 4_19_rank_account_candidates.py --run-id sns-2026-09-05-rank --dry-run

    # 候補表へ書き、上位 5,000 件を CSV でも出す
    python3 4_19_rank_account_candidates.py --run-id sns-2026-09-05-rank \\
        --top 5000 --csv-out out/account_candidates.csv
"""

from __future__ import annotations

import argparse
import csv
import logging
from pathlib import Path

from google.api_core.exceptions import NotFound
from google.cloud import bigquery

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import (BARE_HANDLE_MAX_POSTERS, GENERIC_HANDLE_STOPWORDS,
                        PROVIDER_INSTAGRAM, TABLE_DISH_MEDIA_CATALOG, TABLE_POST_RAW,
                        TABLE_SOURCE_ACCOUNT, bare_handle_candidate_sql)

LOGGER = logging.getLogger(__name__)
HERE = Path(__file__).resolve().parent

TABLE_ACCOUNT_CANDIDATE = "sns_account_candidate_v2"

# 【設計】#1273 «人が選んだ影響力アカウントの一覧に載っているか»。
# これは発見経路ではなく **既に人手で選ばれた事実**（`4_1 --source influencer_list`）。
# 2026-09-05 の実測で、ハンドル文字列（料理語・地域語）の効きは **ほぼ全部これの代理**
# だったと分かったので、独立した特徴として最上位に置く（詳細は docstring の «訂正 2»）。
CURATED_METHODS: tuple[str, ...] = ("influencer_list",)

# --- 料理語 / 地域語 ----------------------------------------------------------------
#
# 【設計】#1273 Instagram のハンドルは `[a-z0-9._]` しか使えないので、日本語の語彙
# （`common_sns.PREF_PATTERN` の «北海道|青森県|…»）はここでは 1 文字も当たらない。
# よってこれは PREF_PATTERN の写経ではなく **別物**（ローマ字表記のゆれを含む地域語）。
# 住所から都道府県を決める用途には使わないこと（それは PREF_PATTERN が正本）。
#
# 料理語は «その店が出す料理»（ramen / sushi）ではなく **«食べ歩く人» を表す一般語**
# だけを入れる。`ramen` を入れると店アカウント（`ramen_taro`）が大量に混ざり、
# 取れ高の低い側へ順番を明け渡す（実測 0.39 店/アカウント）。
FOOD_TOKENS: tuple[str, ...] = (
    "gourmet", "gourmand", "gurume", "glutton", "foodie", "food", "foods",
    "meshi", "gohan", "bishoku", "tabemono", "tabearuki", "tabete", "tabeta",
    "tabelog", "kuidaore", "kuishinbo", "nomiaruki", "hitorimeshi", "shokutsu",
    "lunch", "ranchi", "dinner", "oishi", "umai", "delicious", "eat", "eats",
    "gurustagram", "delistagram", "foodstagram", "guru",
)

# 政令市・繁華街まで入れる（`shinjuku_lunch` のような «街 × 料理» も同じ型）。
REGION_TOKENS: tuple[str, ...] = (
    # 北海道・東北
    "sapporo", "hokkaido", "susukino", "hakodate", "asahikawa", "obihiro", "kushiro",
    "aomori", "hachinohe", "morioka", "sendai", "miyagi", "akita", "yamagata",
    "fukushima", "koriyama", "iwaki",
    # 関東
    "ibaraki", "mito", "tochigi", "utsunomiya", "gunma", "maebashi", "takasaki",
    "saitama", "omiya", "kawagoe", "chiba", "funabashi", "kashiwa",
    "tokyo", "shinjuku", "shibuya", "ikebukuro", "ueno", "ginza", "akihabara",
    "kichijoji", "nakameguro", "ebisu", "shimokita", "asakusa", "kanda", "shinbashi",
    "yokohama", "kawasaki", "shonan", "kamakura", "machida",
    # 中部・北陸
    "niigata", "toyama", "kanazawa", "ishikawa", "fukui", "kofu", "yamanashi",
    "nagano", "matsumoto", "gifu", "shizuoka", "hamamatsu", "numazu",
    "nagoya", "aichi", "sakae", "toyota", "okazaki",
    # 近畿
    "mie", "yokkaichi", "shiga", "otsu", "kyoto", "osaka", "umeda", "namba",
    "shinsaibashi", "kyobashi", "tennoji", "sakai", "kobe", "sannomiya", "hyogo",
    "himeji", "nishinomiya", "nara", "wakayama",
    # 中国・四国
    "tottori", "shimane", "matsue", "okayama", "kurashiki", "hiroshima", "fukuyama",
    "yamaguchi", "shimonoseki", "tokushima", "takamatsu", "kagawa", "matsuyama",
    "ehime", "kochi",
    # 九州・沖縄
    "fukuoka", "hakata", "tenjin", "kitakyushu", "kokura", "kurume", "saga",
    "nagasaki", "sasebo", "kumamoto", "oita", "beppu", "miyazaki", "kagoshima",
    "okinawa", "naha", "ishigaki",
    # 広域
    "kansai", "kanto", "kyushu", "tohoku", "chugoku", "shikoku", "hokuriku", "tokai",
)


def _token_regex(tokens: tuple[str, ...]) -> str:
    """RE2 の交替パターンを作る。長い語を先に置いて `food` が `foodie` を食べないようにする。"""
    return "(" + "|".join(sorted(tokens, key=len, reverse=True)) + ")"


CANDIDATE_SCHEMA = [
    bigquery.SchemaField("handle", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("provider", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("tier", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("expected_delivered_stores_per_call", "FLOAT", mode="REQUIRED"),
    bigquery.SchemaField("has_food_token", "BOOLEAN", mode="REQUIRED"),
    bigquery.SchemaField("has_region_token", "BOOLEAN", mode="REQUIRED"),
    bigquery.SchemaField("region_token", "STRING"),
    bigquery.SchemaField("curated", "BOOLEAN", mode="REQUIRED"),
    bigquery.SchemaField("store_attributed", "BOOLEAN", mode="REQUIRED"),
    bigquery.SchemaField("seed_place_id", "STRING"),
    bigquery.SchemaField("mention_posters", "INTEGER", mode="REQUIRED"),
    bigquery.SchemaField("discovery_methods", "STRING", mode="REPEATED"),
    bigquery.SchemaField("computed_at", "TIMESTAMP", mode="REQUIRED"),
    bigquery.SchemaField("run_id", "STRING", mode="REQUIRED"),
]


def feature_sql(pipeline: BigQueryPipeline) -> str:
    """ハンドル 1 行 ＝ 特徴 ＋ 実績（収集済みのみ）を返す SQL。

    実績（`observed_posts` / `delivered_stores`）は **較正にだけ**使う。未収集ハンドルでは
    0 になるので、score の計算に混ぜてはいけない（混ぜると «未収集だから 0 点» になる）。

    ⚠️ **成果は `sns_post_resolved.status='matched'` で数えない。**
    配信側（`9_1` / `common_sns.post_store_cte_sql`）は seed-trust
    （`COALESCE(discovery_seed_place_id, resolve の place_id)`）で店を決めるので、
    **店アカウント経由の店は matched にならないまま配信されている**。matched で数えると
    店アカウント段（D）を 0.216 と過小評価する（実測の配信ベースは 0.550＝ 2.5 倍）。
    分子は必ず配信カタログ `sns_dish_media_catalog` の異なり `google_place_id` にする。
    """
    post_raw = pipeline.table(TABLE_POST_RAW)
    catalog = pipeline.table(TABLE_DISH_MEDIA_CATALOG)
    account = pipeline.table(TABLE_SOURCE_ACCOUNT)
    food_re = _token_regex(FOOD_TOKENS)
    region_re = _token_regex(REGION_TOKENS)
    return f"""
    WITH {bare_handle_candidate_sql(post_raw)},
    mention AS (
      SELECT handle, COUNT(DISTINCT NULLIF(poster, '')) AS mention_posters
      FROM ok GROUP BY handle
    ),
    handles AS (
      SELECT LOWER(handle) AS handle,
             ARRAY_AGG(DISTINCT discovery_method IGNORE NULLS) AS discovery_methods,
             MAX(discovery_seed_place_id) AS seed_place_id
      FROM `{account}`
      WHERE provider = @provider AND handle IS NOT NULL AND handle != ''
      GROUP BY 1
    ),
    collected AS (
      SELECT LOWER(account_id) AS handle, COUNT(DISTINCT post_id) AS observed_posts
      FROM `{post_raw}`
      WHERE provider = @provider AND account_id IS NOT NULL AND account_id != ''
      GROUP BY 1
    ),
    -- 配信カタログ（＝ 実際にユーザーへ出る行）。run を跨いで数えない。
    catalog AS (
      SELECT external_content_id AS post_id, google_place_id
      FROM `{catalog}`
      WHERE run_id = @catalog_run_id
      GROUP BY 1, 2
    ),
    delivered AS (
      SELECT LOWER(p.account_id) AS handle,
             COUNT(DISTINCT c.google_place_id) AS delivered_stores
      FROM `{post_raw}` p
      JOIN catalog c USING (post_id)
      WHERE p.provider = @provider AND p.account_id IS NOT NULL
      GROUP BY 1
    )
    SELECT h.handle,
           h.discovery_methods,
           h.seed_place_id,
           EXISTS(SELECT 1 FROM UNNEST(h.discovery_methods) dm
                  WHERE dm IN UNNEST(@curated_methods)) AS curated,
           h.seed_place_id IS NOT NULL AS store_attributed,
           REGEXP_CONTAINS(h.handle, r'{food_re}') AS has_food_token,
           REGEXP_EXTRACT(h.handle, r'{region_re}') AS region_token,
           IFNULL(m.mention_posters, 0) AS mention_posters,
           c.handle IS NOT NULL AS collected,
           IFNULL(c.observed_posts, 0) AS observed_posts,
           IFNULL(z.delivered_stores, 0) AS delivered_stores
    FROM handles h
    LEFT JOIN mention m USING (handle)
    LEFT JOIN collected c USING (handle)
    LEFT JOIN delivered z USING (handle)
    """


def dedup_sql(pipeline: BigQueryPipeline) -> str:
    """段ごとに «(アカウント,店) ペア数» と «異なり店» を返す（＝ 段の中の重複率）。

    `calibrate()` の `expected_stores` はアカウントごとの異なり店を足し上げるので、
    同じ店を複数のアカウントが出していれば水増しになる。**その水増し率を同じ run で
    実測して並べる**ためのクエリ。見積もりだけ出して重複を黙っていると、
    «ホストを 10 倍にすれば店も 10 倍» と同じ誤りを繰り返す。
    """
    post_raw = pipeline.table(TABLE_POST_RAW)
    catalog = pipeline.table(TABLE_DISH_MEDIA_CATALOG)
    account = pipeline.table(TABLE_SOURCE_ACCOUNT)
    food_re = _token_regex(FOOD_TOKENS)
    region_re = _token_regex(REGION_TOKENS)
    return f"""
    WITH catalog AS (
      SELECT external_content_id AS post_id, google_place_id
      FROM `{catalog}` WHERE run_id = @catalog_run_id GROUP BY 1, 2
    ),
    curated_handles AS (
      SELECT DISTINCT LOWER(handle) AS handle
      FROM `{account}`
      WHERE handle IS NOT NULL
        AND discovery_method IN UNNEST(@curated_methods)
    ),
    pairs AS (
      SELECT LOWER(p.account_id) AS handle,
             LOWER(p.account_id) IN (SELECT handle FROM curated_handles) AS curated,
             c.google_place_id
      FROM `{post_raw}` p JOIN catalog c USING (post_id)
      WHERE p.provider = @provider AND p.account_id IS NOT NULL
      GROUP BY 1, 2, 3
    )
    SELECT CASE WHEN curated THEN 'A_curated'
                WHEN REGEXP_CONTAINS(handle, r'{region_re}') THEN 'C_region'
                WHEN REGEXP_CONTAINS(handle, r'{food_re}') THEN 'D_food'
                ELSE 'E_rest' END AS tier,
           COUNT(DISTINCT handle) AS accounts,
           COUNT(*) AS account_store_pairs,
           COUNT(DISTINCT google_place_id) AS distinct_stores
    FROM pairs GROUP BY 1 ORDER BY 1
    """


def latest_catalog_run_id(pipeline: BigQueryPipeline) -> str:
    """較正の分母にする配信カタログ run を 1 つ選ぶ。

    `sns_dish_media_catalog` は run ごとの全量スナップショットなので、run を跨いで
    数えると «作り直す前の店» まで足してしまう。**最新の 1 run だけ**を見る。
    """
    rows = list(pipeline.execute(
        f"SELECT run_id FROM `{pipeline.table(TABLE_DISH_MEDIA_CATALOG)}` "
        "GROUP BY run_id ORDER BY MAX(built_at) DESC LIMIT 1"))
    if not rows:
        raise RuntimeError(f"{TABLE_DISH_MEDIA_CATALOG} が空です。較正できません。")
    return rows[0]["run_id"]


def tier_of(row) -> str:
    """コールを 1 回も使わずに決まる段。段の «順» は較正が決めるので、ここは分け方だけ。

    ⚠️ **`curated` を最初に見ること。** 2026-09-05 の実測で、«料理語 × 地域語» の高い
    取れ高は **ほぼ全部 «人が選んだ influencer_list に載っている» ことの代理**だった。
    curated を外して数え直すと、料理語・地域語の段は店アカウント段より **下**になる:

    | 段 | curated 込み（誤） | curated を分けた後（正） |
    | --- | ---: | ---: |
    | 料理語 × 地域語 | 15.347 | **0.076** |
    | 料理語のみ | 1.792 | **0.121** |
    | 地域語のみ | 1.181 | **0.145** |
    | 店アカウント（seed 有） | 0.550 | **0.550** |
    | その他 | 0.169 | **0.056** |

    つまり **ハンドル文字列は «影響力アカウントらしさ» をほとんど予測しない**。
    未収集プールで唯一大きく効くのは `store_attributed`（0.550 対 0.056 ＝ 10 倍）。
    """
    if row["curated"]:
        return "A_curated"
    if row["store_attributed"]:
        return "B_store_attributed"
    if row["region_token"] is not None:
        return "C_region"
    if row["has_food_token"]:
        return "D_food"
    return "E_rest"


def calibrate(rows: list[dict]) -> dict[str, dict]:
    """収集済みハンドルだけを使って、段ごとの «異なり店/アカウント» を実測する。

    ⚠️ `delivered_stores` はアカウントごとの異なり店なので、段の合計は
    **店の重複を含む**（有名店は複数のアカウントが出す）。段どうしの比較には使えるが、
    «この段を全部回せば N 店増える» の N には使えない。実測の重複率は
    レポート側（`--dry-run` の出力）に別途出す。
    """
    stats: dict[str, dict] = {}
    for row in rows:
        tier = tier_of(row)
        s = stats.setdefault(tier, {"handles": 0, "collected": 0, "uncollected": 0,
                                    "stores": 0, "posts": 0})
        s["handles"] += 1
        if row["collected"]:
            s["collected"] += 1
            s["stores"] += row["delivered_stores"]
            s["posts"] += row["observed_posts"]
        else:
            s["uncollected"] += 1
    for s in stats.values():
        s["delivered_stores_per_call"] = (s["stores"] / s["collected"]) if s["collected"] else 0.0
        s["posts_per_call"] = (s["posts"] / s["collected"]) if s["collected"] else 0.0
        s["expected_stores"] = s["delivered_stores_per_call"] * s["uncollected"]
    return stats


def log_calibration(stats: dict[str, dict]) -> None:
    LOGGER.info("段 | ハンドル | 収集済 | 未収集 | 配信店/コール | 投稿/コール | 未収集を全部回した期待配信店数")
    for tier in sorted(stats):
        s = stats[tier]
        LOGGER.info("%-18s | %7d | %6d | %7d | %8.3f | %10.1f | %10.0f",
                    tier, s["handles"], s["collected"], s["uncollected"],
                    s["delivered_stores_per_call"], s["posts_per_call"], s["expected_stores"])


def ensure_candidate_table(pipeline: BigQueryPipeline) -> None:
    """候補表を作る。**列が変わっていたら作り直す。**

    この表は毎 run 作り直せる派生物（正は `sns_source_account` と配信カタログ）なので、
    古い列のまま残すより捨てて作り直す方が安全である。実際に 2026-09-05、列名を
    変えたのに既存表が残っていて Load Job が «unknown field» で落ちた
    （`create_table(exists_ok=True)` は既存表のスキーマを直さない）。
    """
    table_id = pipeline.table(TABLE_ACCOUNT_CANDIDATE)
    try:
        current = pipeline.client.get_table(table_id)
    except NotFound:
        pipeline.client.create_table(bigquery.Table(table_id, schema=CANDIDATE_SCHEMA))
        LOGGER.info("%s を作成しました", TABLE_ACCOUNT_CANDIDATE)
        return
    want = [(f.name, f.field_type, f.mode) for f in CANDIDATE_SCHEMA]
    have = [(f.name, f.field_type, f.mode) for f in current.schema]
    if want == have:
        return
    LOGGER.warning("%s の列が変わっているため作り直します（旧 %d 列 → 新 %d 列）",
                   TABLE_ACCOUNT_CANDIDATE, len(have), len(want))
    pipeline.client.delete_table(table_id)
    pipeline.client.create_table(bigquery.Table(table_id, schema=CANDIDATE_SCHEMA))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run-id")
    parser.add_argument("--provider", default=PROVIDER_INSTAGRAM)
    parser.add_argument("--catalog-run-id",
                        help="較正の分母にする配信カタログの run_id（既定: 最新の run）")
    parser.add_argument("--top", type=int, default=0,
                        help="候補表へ書く上位件数（0 = 未収集ハンドル全部）")
    parser.add_argument("--csv-out", type=Path,
                        help="上位候補を CSV でも出す（4_2 へ渡す手前の目視用）")
    parser.add_argument("--dry-run", action="store_true",
                        help="BQ を読み較正表だけ出す。候補表は書かない")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    now = utc_now()

    catalog_run_id = args.catalog_run_id or latest_catalog_run_id(pipeline)
    params = [
        bigquery.ScalarQueryParameter("provider", "STRING", args.provider),
        bigquery.ArrayQueryParameter("stopwords", "STRING", list(GENERIC_HANDLE_STOPWORDS)),
        bigquery.ScalarQueryParameter("max_posters", "INT64", BARE_HANDLE_MAX_POSTERS),
        bigquery.ScalarQueryParameter("catalog_run_id", "STRING", catalog_run_id),
        bigquery.ArrayQueryParameter("curated_methods", "STRING", list(CURATED_METHODS)),
    ]
    LOGGER.info("ハンドルの特徴と実績を読みます（provider=%s / 配信カタログ run=%s）",
                args.provider, catalog_run_id)
    rows = [dict(r) for r in pipeline.execute(feature_sql(pipeline), params)]
    LOGGER.info("ハンドル %d 件（収集済 %d）", len(rows), sum(1 for r in rows if r["collected"]))

    stats = calibrate(rows)
    log_calibration(stats)

    LOGGER.info("段の中の重複（見積もりの水増し率）:")
    LOGGER.info("段 | アカウント | (アカウント,店)ペア | 異なり店 | 水増し率")
    for r in pipeline.execute(dedup_sql(pipeline), [params[0], params[3], params[4]]):
        factor = (r["account_store_pairs"] / r["distinct_stores"]) if r["distinct_stores"] else 0.0
        LOGGER.info("%-18s | %8d | %10d | %8d | %6.2f", r["tier"], r["accounts"],
                    r["account_store_pairs"], r["distinct_stores"], factor)

    candidates = [r for r in rows if not r["collected"]]
    for row in candidates:
        row["tier"] = tier_of(row)
        # score は段の実測値そのもの。言及されているハンドルは «実在して話題にされている»
        # ので、同じ段の中での並びだけを言及者数で決める（段をまたいで逆転させない）。
        row["expected_delivered_stores_per_call"] = stats[row["tier"]]["delivered_stores_per_call"]
    candidates.sort(key=lambda r: (r["expected_delivered_stores_per_call"], r["mention_posters"]),
                    reverse=True)
    if args.top:
        candidates = candidates[: args.top]
    LOGGER.info("候補 %d 件（期待店数 合計 %.0f）", len(candidates),
                sum(r["expected_delivered_stores_per_call"] for r in candidates))

    if args.csv_out:
        args.csv_out.parent.mkdir(parents=True, exist_ok=True)
        with args.csv_out.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(["handle", "tier", "expected_delivered_stores_per_call", "region_token",
                             "mention_posters", "seed_place_id", "discovery_methods"])
            for row in candidates:
                writer.writerow([row["handle"], row["tier"],
                                 f"{row['expected_delivered_stores_per_call']:.3f}",
                                 row["region_token"] or "", row["mention_posters"],
                                 row["seed_place_id"] or "",
                                 "|".join(row["discovery_methods"] or [])])
        LOGGER.info("CSV を書きました: %s", args.csv_out)

    if args.dry_run:
        LOGGER.info("--dry-run のため候補表へは書きません")
        return

    ensure_candidate_table(pipeline)
    pipeline.delete_run_rows(TABLE_ACCOUNT_CANDIDATE, run_id)
    written = pipeline.load_json_rows(TABLE_ACCOUNT_CANDIDATE, (
        {
            "handle": row["handle"],
            "provider": args.provider,
            "tier": row["tier"],
            "expected_delivered_stores_per_call": row["expected_delivered_stores_per_call"],
            "has_food_token": bool(row["has_food_token"]),
            "has_region_token": row["region_token"] is not None,
            "region_token": row["region_token"],
            "curated": bool(row["curated"]),
            "store_attributed": bool(row["store_attributed"]),
            "seed_place_id": row["seed_place_id"],
            "mention_posters": row["mention_posters"],
            "discovery_methods": list(row["discovery_methods"] or []),
            "computed_at": now,
            "run_id": run_id,
        }
        for row in candidates
    ))
    LOGGER.info("%s へ %d 件書きました（run_id=%s）", TABLE_ACCOUNT_CANDIDATE, written, run_id)


if __name__ == "__main__":
    main()
