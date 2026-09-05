#!/usr/bin/env python3
"""#1273 収集する «順番» を決める: 未収集ハンドルを «1 コールあたり何店取れるか» で並べる。

## なぜこれが要るか（2026-09-05 実測）

投稿収集（`4_2_collect_account_posts.py`）の律速は **Instagram Graph API の
business_discovery（アプリ単位 ~200 コール/時）**である。1 ハンドル ≒ 1 コールなので、
**«どのハンドルに 1 コール使うか» がそのまま成果**になる。ところが今の順番は
«見つけた順» で、実測の取れ高は 100 倍以上ばらついていた。

`sns_source_account` の 163,215 ハンドルのうち収集済みは 43,652。この script の
較正クエリ（`--dry-run`）が出す実測は次のとおり。段は **ハンドル文字列だけ**
（＝ コールを 1 回も使わずに分かる特徴）で決まる。

分子は **配信カタログ `sns_dish_media_catalog` に載る異なり店**（run `sns-catalog-2026-09-05b`・
全体で 19,336 店）。`sns_post_resolved.status='matched'` では数えない（下の «訂正» を読むこと）。

| 段 | ハンドル | 収集済 | 未収集 | **配信店/コール** | 投稿/コール | 未収集を全部回した期待配信店数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A 料理語 × 地域語 | 274 | 147 | 127 | **15.347** | 72.0 | 1,949 |
| B 料理語のみ | 1,827 | 582 | 1,245 | 1.792 | 16.8 | 2,231 |
| C 地域語のみ | 19,254 | 4,858 | 14,396 | 1.181 | 13.6 | 17,002 |
| D 店アカウント（seed 有） | 34,743 | 5,363 | 29,380 | 0.550 | 31.5 | 16,159 |
| E その他 | 107,117 | 32,702 | 74,415 | 0.169 | 5.0 | 12,576 |

⚠️ この表は **動く**。柱1 のワーカーが収集を進めると各段の «収集済/未収集» もレートも変わる
（同じ日の 2 時間で A 段は 120→147 収集済み・18.800→15.347 に動いた）。だから
**係数を焼き付けず、毎 run この較正をやり直す**。上の数字は 2026-09-05 時点の記録。

`sapporo_gourmet` `fukuoka_meshi` のような **«地域 × 料理» のハンドルはご当地グルメ
アカウントの型**で、1 アカウントが多数の店を回る。逆に店アカウントは 1 店しか出さない。
**同じ 1 コールで 28 倍違う（15.347 対 0.550）。**

同じ 15,768 コールを A→B→C に配ると期待 **21,182 配信店**、D（＝ 店アカウントを順に潰す
今の並び）に配ると **8,672 店**。**約 2.4 倍。**

### ⚠️ 訂正（2026-09-05）— `matched` で数えると店アカウント段を 2.5 倍過小評価する

初版は分子を `sns_post_resolved.status='matched'` にしていた。しかし配信側
（`9_1` / `common_sns.post_store_cte_sql`）は **seed-trust**
（`COALESCE(discovery_seed_place_id, resolve の place_id)`）で店を決めるので、
**店アカウント経由の店は `matched` にならないまま配信されている**。

| 段 | matched で数えた（誤） | 配信カタログで数えた（正） |
| --- | ---: | ---: |
| A | 18.625 | 18.800 |
| B | 1.723 | 1.792 |
| C | 1.090 | 1.181 |
| **D 店アカウント** | **0.216** | **0.550（+155%）** |
| E | 0.154 | 0.169 |

この訂正で «A→B→C は D の 6 倍» という初版の主張は **2.4 倍**に下がる。効果の向きは
変わらないが、**倍率を 2.5 倍盛っていた**。以後この案件の成果は必ず配信カタログで数える。

### 選択バイアスと水増しの確認

- 誰も選んでいない部分集合（`cc_wat_profile` / `embedded_authors`）だけで数え直しても
  料理語×地域語は **4.698 対 0.067（70 倍）**。効果は curation 由来ではない。
- 段内で «同じ店を複数アカウントが出す» 水増し率は **A 1.02 / B 1.03 / C 1.07 / DE 1.10 倍**
  （配信ベースで実測）。ご当地アカウントは担当地域が違うのでほぼ重ならない。
- 参考: 料理語か地域語を持つ収集済み 941 アカウント（全収集アカウントの **2.2%**）が、
  配信店 19,336 のうち **8,232 店（42.6%）**を出している（段をまたぐ重複を除いた union）。

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

from google.cloud import bigquery

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import (BARE_HANDLE_MAX_POSTERS, GENERIC_HANDLE_STOPWORDS,
                        PROVIDER_INSTAGRAM, TABLE_DISH_MEDIA_CATALOG, TABLE_POST_RAW,
                        TABLE_SOURCE_ACCOUNT, bare_handle_candidate_sql)

LOGGER = logging.getLogger(__name__)
HERE = Path(__file__).resolve().parent

TABLE_ACCOUNT_CANDIDATE = "sns_account_candidate_v2"

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
    food_re = _token_regex(FOOD_TOKENS)
    region_re = _token_regex(REGION_TOKENS)
    return f"""
    WITH catalog AS (
      SELECT external_content_id AS post_id, google_place_id
      FROM `{catalog}` WHERE run_id = @catalog_run_id GROUP BY 1, 2
    ),
    pairs AS (
      SELECT LOWER(p.account_id) AS handle, c.google_place_id
      FROM `{post_raw}` p JOIN catalog c USING (post_id)
      WHERE p.provider = @provider AND p.account_id IS NOT NULL
      GROUP BY 1, 2
    )
    SELECT CASE WHEN REGEXP_CONTAINS(handle, r'{food_re}')
                 AND REGEXP_CONTAINS(handle, r'{region_re}') THEN 'A_food_region'
                WHEN REGEXP_CONTAINS(handle, r'{food_re}') THEN 'B_food'
                WHEN REGEXP_CONTAINS(handle, r'{region_re}') THEN 'C_region'
                ELSE 'DE_rest' END AS tier,
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
    """コールを 1 回も使わずに決まる段。上ほど «1 コールあたりの期待店数» が高い。

    段は «料理語 × 地域語» を主軸にする（実測でここが 100 倍効く）。店アカウント
    （`store_attributed`）は店が確定する代わりに 1 店しか出ないので、**料理語×地域語が
    無いときの内訳**としてだけ分ける。
    """
    food = bool(row["has_food_token"])
    region = row["region_token"] is not None
    if food and region:
        return "A_food_region"
    if food:
        return "B_food"
    if region:
        return "C_region"
    if row["store_attributed"]:
        return "D_store_attributed"
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
    ]
    LOGGER.info("ハンドルの特徴と実績を読みます（provider=%s / 配信カタログ run=%s）",
                args.provider, catalog_run_id)
    rows = [dict(r) for r in pipeline.execute(feature_sql(pipeline), params)]
    LOGGER.info("ハンドル %d 件（収集済 %d）", len(rows), sum(1 for r in rows if r["collected"]))

    stats = calibrate(rows)
    log_calibration(stats)

    LOGGER.info("段の中の重複（見積もりの水増し率）:")
    LOGGER.info("段 | アカウント | (アカウント,店)ペア | 異なり店 | 水増し率")
    for r in pipeline.execute(dedup_sql(pipeline), [params[0], params[3]]):
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

    pipeline.client.create_table(
        bigquery.Table(pipeline.table(TABLE_ACCOUNT_CANDIDATE), schema=CANDIDATE_SCHEMA),
        exists_ok=True,
    )
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
