#!/usr/bin/env python3
"""#1273 検索インデックスから «グルメインフルエンサーのアカウント» を新規に探す（柱2 の蛇口）。

## なぜこれが要るか

配信店の単価はアカウントの種類で 60 倍違う（2026-09-05 実測・分母は配信カタログ）:

| アカウント | 収集済 | 配信店/アカウント | 投稿/アカウント | 配信店/投稿 |
| --- | ---: | ---: | ---: | ---: |
| 人が選んだ一覧（`influencer_list`） | 313 | **33.645** | 193.7 | **0.1737** |
| 自動判定の influencer（埋め込み 2 ホスト以上） | 183 | 0.475 | 12.7 | 0.0374 |
| 店アカウント | 6,396 | 0.555 | 31.0 | 0.0179 |
| unknown | 36,858 | 0.091 | 4.4 | 0.0208 |

**人が選んだ一覧だけが桁違いで、しかも «投稿数» と «投稿あたりの店» の両方で勝っている**
（＝ 深く掘っただけの見かけではない）。ところがその一覧は手作りで、未収集は残り 36 件しかない。
**この蛇口を涸らさないために «influencer を新しく見つける» のがこの script の仕事。**

## 既にある自動判定は使えない（実測で否定済み）

`4_1_discover_sns_accounts.py` は既に 2 つの自動規則を持つ:
- `caption_mentions`: «2 人以上の投稿者から言及された» → influencer（4 件しか出ていない）
- `embedded_authors`: «2 つ以上のホストに埋め込まれた» → influencer（183 件）

後者は 183 件すべて収集済みで **0.475 店/アカウント**。店アカウント（0.555）と変わらない。
**«複数ホストに埋め込まれた» は influencer らしさを表していない。** だから新しい蛇口が要る。

## 判定器（クエリを投げる前に用意した。#1273 のレビュー指摘）

**«25 投稿の浅い probe で、配信カタログに載る異なり店が 4 つ以上»** を influencer 級とする。
収集済み 5,025 アカウント（25 投稿以上）での実測:

| probe（25 投稿）の異なり店 | アカウント | 総配信店の平均 | 総配信店 10 以上 |
| --- | ---: | ---: | ---: |
| 0 | 2,003 | 0.12 | 2 |
| 1 | 2,663 | 1.09 | 7 |
| 2-3 | 136 | 8.19 | 35 |
| **4-6** | 75 | **34.79** | 66 |
| **7+** | 148 | **58.05** | 146 |

«4 以上» は **総配信店 10 以上を precision 95.1% / recall 82.8%** で当てる。
probe は business_discovery 1 コールで済む（25 投稿は 1 ページ）。

## 損得の分岐点（これを超えないなら、この経路はやらない）

probe を当てる母集団の «influencer 級の割合» を p、当たったアカウントの総配信店を Y、
深掘りの追加コールを 7 とすると **stores/call = p·Y / (1 + 7p)**。
非 curated の実測（Y = 17.1）で店アカウント（0.542）を超えるには:

    p · 17.1 / (1 + 7p) > 0.542  →  **p > 4.07%**

参考の実測: 手作り一覧の中は **54.72%**、既存の自動発見プール（非 curated）は **0.43%**。
**検索が «既存プールの 10 倍濃い» 候補を出せるかが、この経路の成否そのもの。**

## この script の測り方（IG のコールを 1 回も使わない）

検索で出た handle のうち **既に収集済みのもの**へ判定器を当てれば、
**IG クォータを 1 コールも使わずに p を推定できる**（柱1 と枠を奪い合わない）。
`--report-only` はこの推定だけを出す。

## 書き込み

新規表 `sns_influencer_query_candidate` のみ。`sns_post_raw` /
`sns_post_resolved` / `sns_name_place_lookup` / `sns_dish_media_catalog` /
`sns_source_account` へは書かない。

## 使い方

    # クエリだけ出す（検索 API を呼ばない）
    python3 4_20_search_influencer_accounts.py --run-id sns-2026-09-05-infl --dry-run

    # 188 クエリ（47 都道府県 × 4 型）を引いて候補表へ入れ、p を推定する
    python3 4_20_search_influencer_accounts.py --run-id sns-2026-09-05-infl --max-queries 188
"""

from __future__ import annotations

import argparse
import importlib.util
import logging
import os
import re
import time
import urllib.error
from pathlib import Path

from google.api_core.exceptions import NotFound
from google.cloud import bigquery

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import (PROVIDER_INSTAGRAM, TABLE_DISH_MEDIA_CATALOG, TABLE_POST_RAW,
                        TABLE_SOURCE_ACCOUNT)

LOGGER = logging.getLogger(__name__)
HERE = Path(__file__).resolve().parent

TABLE_QUERY_CANDIDATE = "sns_influencer_query_candidate"

# probe の閾値。上の表（25 投稿で異なり店 4 以上 → 総配信店 10 以上を precision 95.1%）が根拠。
PROBE_POSTS = 25
PROBE_MIN_STORES = 4
# 損得の分岐点。これを下回ったら «この経路はやらない» と判定する（docstring の式）。
BREAKEVEN_PASS_RATE = 0.0407
STORE_ACCOUNT_STORES_PER_CALL = 0.542

# SERPER の呼び出しは `4_3_collect_search_posts.py` が正本。**ここへ写経しない。**
# モジュール名が数字で始まり `import` できないので importlib で読む
# （このリポジトリのテストが既に使っている読み方）。
_SPEC = importlib.util.spec_from_file_location(
    "collect_search_posts", HERE / "4_3_collect_search_posts.py")
_SEARCH = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_SEARCH)
serper_search = _SEARCH.serper_search

# --- クエリ ---------------------------------------------------------------------
#
# 【設計】#1273 狙いは «投稿» ではなく «アカウント»。4_3 / 4_7 は
# `site:instagram.com` で投稿 URL（/p/ /reel/）を採るが、ここが欲しいのは
# プロフィール URL（`instagram.com/<handle>/`）である。
# 日本語で «その土地のグルメアカウントを紹介する記事» を引き当てにいく
# （まとめ記事の本文には handle が並ぶので、link だけでなく snippet の @handle も拾う）。
QUERY_TEMPLATES: tuple[str, ...] = (
    "{pref} グルメ インスタグラマー おすすめ",
    "{pref} グルメ インスタ アカウント 人気",
    "{pref} 食べ歩き インスタ 有名",
    "{pref} ランチ インスタグラマー",
)

PREFECTURES: tuple[str, ...] = (
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
    "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
    "岐阜県", "静岡県", "愛知県", "三重県",
    "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
    "鳥取県", "島根県", "岡山県", "広島県", "山口県",
    "徳島県", "香川県", "愛媛県", "高知県",
    "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
)

# プロフィール URL から handle を採る。投稿・機能ページは handle ではない。
_PROFILE_RE = re.compile(r"instagram\.com/([A-Za-z0-9_.]{2,30})/?(?:$|[?#])", re.IGNORECASE)
_MENTION_RE = re.compile(r"@([A-Za-z0-9_.]{2,30})")
_NOT_A_HANDLE = frozenset({
    "p", "reel", "reels", "tv", "explore", "accounts", "directory", "about", "developer",
    "legal", "privacy", "terms", "web", "stories", "s", "ar", "invites", "challenge",
    "oauth", "emails", "session", "download", "help", "press", "api", "blog", "topics",
})

CANDIDATE_SCHEMA = [
    bigquery.SchemaField("handle", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("provider", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("region", "STRING"),
    bigquery.SchemaField("query", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("extracted_from", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("result_rank", "INTEGER"),
    bigquery.SchemaField("found_at", "TIMESTAMP", mode="REQUIRED"),
    bigquery.SchemaField("run_id", "STRING", mode="REQUIRED"),
]


def build_queries(max_queries: int | None) -> list[tuple[str, str]]:
    """(都道府県, クエリ) を返す。都道府県を外側に回して、打ち切っても全国に散るようにする。"""
    out: list[tuple[str, str]] = []
    for template in QUERY_TEMPLATES:
        for pref in PREFECTURES:
            out.append((pref, template.format(pref=pref)))
    if max_queries:
        out = out[:max_queries]
    return out


def handles_from(result: dict):
    """SERPER の 1 応答から (handle, 由来, 順位) を取り出す。

    link はプロフィール URL のときだけ。snippet / title からは `@handle` を拾う
    （まとめ記事は本文に handle を並べるので、link より歩留まりが良いことがある）。
    """
    for rank, item in enumerate(result.get("organic") or [], start=1):
        link = item.get("link") or ""
        m = _PROFILE_RE.search(link)
        if m and m.group(1).lower() not in _NOT_A_HANDLE:
            yield m.group(1).lower().strip("."), "profile_link", rank
        text = f"{item.get('title') or ''} {item.get('snippet') or ''}"
        for mention in _MENTION_RE.findall(text):
            handle = mention.lower().strip(".")
            if handle and handle not in _NOT_A_HANDLE:
                yield handle, "snippet_mention", rank


def probe_rate_sql(pipeline: BigQueryPipeline) -> str:
    """検索で出た handle のうち «収集済み» のものへ判定器を当て、p を推定する SQL。

    IG のコールを 1 回も使わない。比較のために «既存の非 curated プール全体» の
    通過率も同じクエリで出す（片方だけ別クエリで測ると規則がずれる）。
    """
    return f"""
    WITH latest AS (
      SELECT run_id FROM `{pipeline.table(TABLE_DISH_MEDIA_CATALOG)}`
      GROUP BY run_id ORDER BY MAX(built_at) DESC LIMIT 1
    ),
    cat AS (
      SELECT external_content_id AS post_id, google_place_id
      FROM `{pipeline.table(TABLE_DISH_MEDIA_CATALOG)}`
      WHERE run_id = (SELECT run_id FROM latest) GROUP BY 1, 2
    ),
    posts AS (
      SELECT LOWER(p.account_id) AS handle, c.google_place_id,
             ROW_NUMBER() OVER (PARTITION BY LOWER(p.account_id)
                                ORDER BY FARM_FINGERPRINT(p.post_id)) AS rn
      FROM (SELECT DISTINCT account_id, post_id FROM `{pipeline.table(TABLE_POST_RAW)}`
            WHERE account_id IS NOT NULL) p
      LEFT JOIN cat c USING (post_id)
    ),
    agg AS (
      SELECT handle, COUNT(*) AS total_posts,
             COUNT(DISTINCT google_place_id) AS total_stores,
             COUNT(DISTINCT IF(rn <= {PROBE_POSTS}, google_place_id, NULL)) AS probe_stores
      FROM posts GROUP BY handle
    ),
    curated AS (
      SELECT DISTINCT LOWER(handle) AS handle FROM `{pipeline.table(TABLE_SOURCE_ACCOUNT)}`
      WHERE discovery_method = 'influencer_list' AND handle IS NOT NULL
    ),
    found AS (
      SELECT DISTINCT handle FROM `{pipeline.table(TABLE_QUERY_CANDIDATE)}`
      WHERE run_id = @rid
    )
    SELECT grp, COUNT(*) AS accounts,
           COUNTIF(probe_stores >= {PROBE_MIN_STORES}) AS pass_probe,
           ROUND(SAFE_DIVIDE(COUNTIF(probe_stores >= {PROBE_MIN_STORES}), COUNT(*)), 4) AS pass_rate,
           ROUND(AVG(IF(probe_stores >= {PROBE_MIN_STORES}, total_stores, NULL)), 1) AS avg_stores_of_passers
    FROM (
      SELECT a.*,
             CASE WHEN f.handle IS NOT NULL THEN '1_found_by_search'
                  WHEN c.handle IS NOT NULL THEN '2_curated_list'
                  ELSE '3_existing_pool' END AS grp
      FROM agg a
      LEFT JOIN found f USING (handle)
      LEFT JOIN curated c USING (handle)
      WHERE a.total_posts >= {PROBE_POSTS}
    )
    GROUP BY grp ORDER BY grp
    """


def ensure_table(pipeline: BigQueryPipeline) -> None:
    table_id = pipeline.table(TABLE_QUERY_CANDIDATE)
    try:
        current = pipeline.client.get_table(table_id)
    except NotFound:
        pipeline.client.create_table(bigquery.Table(table_id, schema=CANDIDATE_SCHEMA))
        return
    want = [(f.name, f.field_type, f.mode) for f in CANDIDATE_SCHEMA]
    if want != [(f.name, f.field_type, f.mode) for f in current.schema]:
        LOGGER.warning("%s の列が変わっているため作り直します", TABLE_QUERY_CANDIDATE)
        pipeline.client.delete_table(table_id)
        pipeline.client.create_table(bigquery.Table(table_id, schema=CANDIDATE_SCHEMA))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--run-id")
    p.add_argument("--max-queries", type=int, default=None, help="打ち切り（既定 188 全部）")
    p.add_argument("--num", type=int, default=10, help="1 クエリの取得件数（SERPER 無料は最大 10）")
    p.add_argument("--sleep-ms", type=int, default=1200, help="呼び出し間隔（無料枠に配慮）")
    p.add_argument("--dry-run", action="store_true", help="検索 API を呼ばず、クエリだけ出す")
    p.add_argument("--report-only", action="store_true",
                   help="検索せず、既に入っている候補で p の推定だけを出す")
    return p.parse_args()


def log_probe_report(pipeline: BigQueryPipeline, run_id: str) -> None:
    rows = list(pipeline.execute(probe_rate_sql(pipeline),
                                 [bigquery.ScalarQueryParameter("rid", "STRING", run_id)]))
    LOGGER.info("判定器（%d 投稿の probe で異なり店 %d 以上）の通過率:",
                PROBE_POSTS, PROBE_MIN_STORES)
    LOGGER.info("母集団 | 収集済アカウント | 通過 | 通過率 | 通過分の総配信店")
    found = None
    for r in rows:
        LOGGER.info("%-18s | %8d | %5d | %6.2f%% | %s", r["grp"], r["accounts"],
                    r["pass_probe"], (r["pass_rate"] or 0) * 100, r["avg_stores_of_passers"])
        if r["grp"] == "1_found_by_search":
            found = r
    if not found or not found["accounts"]:
        LOGGER.warning("検索で出た handle のうち収集済みのものが 0 件です。p を推定できません。")
        return
    p_hat = float(found["pass_rate"] or 0.0)
    yield_ = float(found["avg_stores_of_passers"] or 0.0)
    stores_per_call = (p_hat * yield_ / (1 + 7 * p_hat)) if p_hat else 0.0
    LOGGER.info("推定 p = %.2f%%（分岐点 %.2f%%） / 期待 %.3f 店per call（店アカウント %.3f）",
                p_hat * 100, BREAKEVEN_PASS_RATE * 100, stores_per_call,
                STORE_ACCOUNT_STORES_PER_CALL)
    if stores_per_call > STORE_ACCOUNT_STORES_PER_CALL:
        LOGGER.info("判定: この経路は店アカウントより良い。拡大してよい。")
    else:
        LOGGER.warning("判定: **この経路は店アカウントと大差ない。検索 API 枠を使う価値が無い。**")


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    now = utc_now()

    queries = build_queries(args.max_queries)
    LOGGER.info("クエリ %d 本（%d 都道府県 × %d 型）", len(queries), len(PREFECTURES),
                len(QUERY_TEMPLATES))
    if args.dry_run:
        for pref, q in queries[:10]:
            LOGGER.info("  %s | %s", pref, q)
        LOGGER.info("--dry-run のため検索も書き込みもしません")
        return

    if not args.report_only:
        key = os.getenv("SERPER_API_KEY")
        if not key:
            raise RuntimeError("SERPER_API_KEY 未設定（db-script-run.yml の secret）。")
        rows: list[dict] = []
        seen: set[tuple[str, str]] = set()
        consecutive_failures = 0
        for i, (pref, q) in enumerate(queries, start=1):
            try:
                res = serper_search(key, q, args.num)
                consecutive_failures = 0
            except urllib.error.HTTPError as e:
                # 本文まで出す。code だけだと «無料枠切れ» と «クエリが悪い» を区別できない
                # （2026-09-05、188 クエリ全部 400 で 0 件になり、原因が分からなかった）。
                body = e.read().decode("utf-8", "replace")[:300]
                LOGGER.warning("SERPER %s (q=%s) body=%s", e.code, q, body)
                consecutive_failures += 1
                # 全部同じ理由で落ちているなら、残りを投げても枠を消すだけ。
                if consecutive_failures >= 5:
                    raise RuntimeError(
                        f"SERPER が {consecutive_failures} 回連続で失敗しました（最後の本文: {body}）。"
                        "キーか無料枠を確認してください。") from e
                continue
            for handle, origin, rank in handles_from(res):
                if (handle, q) in seen:
                    continue
                seen.add((handle, q))
                rows.append({
                    "handle": handle, "provider": PROVIDER_INSTAGRAM, "region": pref,
                    "query": q, "extracted_from": origin, "result_rank": rank,
                    "found_at": now, "run_id": run_id,
                })
            if i % 20 == 0:
                LOGGER.info("  %d/%d クエリ・候補 %d 件", i, len(queries), len(rows))
            time.sleep(args.sleep_ms / 1000.0)
        LOGGER.info("候補 %d 行（異なり handle %d 件）", len(rows),
                    len({r["handle"] for r in rows}))
        if not rows:
            LOGGER.warning("候補が 0 件でした。書き込みません。")
            return
        ensure_table(pipeline)
        pipeline.delete_run_rows(TABLE_QUERY_CANDIDATE, run_id)
        pipeline.load_json_rows(TABLE_QUERY_CANDIDATE, rows)
        LOGGER.info("%s へ書きました（run_id=%s）", TABLE_QUERY_CANDIDATE, run_id)

    log_probe_report(pipeline, run_id)


if __name__ == "__main__":
    main()
