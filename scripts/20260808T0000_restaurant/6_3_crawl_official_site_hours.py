#!/usr/bin/env python3
"""#1666 公式サイトから営業時間を取り、`restaurant_opening_hours` へ入れる（`source='official_site'`）。

## 位置づけ

[#1666 の実測](https://github.com/Ayato-kosaka/nanitabeyo/issues/1666)（300 件）で、
公式サイトを持つ店のうち **11.3% は $0 の決定的パーサで構造化できる**ことが分かった。
その分をここで実際に入れる。LLM は使わない（要否は実測の残りを見てから決める）。

取りに行く作法（robots / UA / 上限 / 文字コード / 分類）は
`official_site_crawl.py` に 1 本化してある。**ここへ書き写さないこと。**
書き写すと «6_2 が測った数字» と «ここが入れた行» がずれる。

## ⚠️ 相手のサイトを叩く。だから既定で «際限なく» 走らない

`--limit` を **必須**にしてある。既定値を置くと、うっかり 28 万サイトへ出て行く。

- `--dry-run` … ネットワークへ 1 回も出ない。DB へも書かない。標本だけ出す
- `--only-missing`（既定 on）… **既に official_site の行がある店を対象から外す**。
  再実行で同じサイトを二度叩かないため。全部取り直すときだけ `--no-only-missing`
- `--min-interval` … 1 件ごとの最短間隔（既定 2.0 秒）
- **再試行しない。** 落ちているサイトを二度叩かない

## 書き方は 6_1（OSM）と同じ

`source='official_site'` の行だけを **対象店ぶん消してから入れ直す**。
他の source（`osm` / `user` / `owner`）には一切触らない。

⚠️ **upsert ではなく delete → insert である。** 店が営業時間を減らしたとき
（週 7 日 → 週 5 日）、upsert だと **消えたはずの 2 日が残り続ける**。
「開いている」と嘘をつく方向の誤りなので、消してから入れ直す。

⚠️ **ただしこれが効くのは «今回も読めた店» だけである。** 消すのは
`parsed` になった店だけで、取り直して読めなくなった店（サイトが落ちた・作り直された）の
古い行は **残る**。これは意図的で、読めなかった一度きりの失敗で良いデータを消さないため
（このクローラは再試行しない）。鮮度は `fetched_at` に出るので、古すぎる行を落とすかは
**別の判断**として扱う。ここで «読めなかった = 閉店» と決めつけない。

⚠️ 長時間走るので `--commit-every`（既定 50 店）ごとに区切って commit する。
1 トランザクションにすると、途中で落ちたときに数時間ぶんが消える。

## 何を入れないか

`parsed` になった店だけ。`mentions_hours_unparsed`（人間なら読めるがパーサが諦めた）は
**入れない**。`osm_opening_hours` と同じ «分からないものは推測しない» である。
unknown は候補から消えないので害が無いが、間違った closed は営業中の店を検索から消す。

実行:
    python3 scripts/20260808T0000_restaurant/6_3_crawl_official_site_hours.py \\
        --schema dev --country JP --limit 500 --dry-run
"""

from __future__ import annotations

import argparse
import datetime as dt
import logging
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# ⚠️ 取りに行く作法はここに 1 本化してある。写経しないこと。
from official_site_crawl import (  # noqa: E402
    classify_page,
    fetch,
    html_to_text,
    robots_allows,
)
from jp_site_opening_hours import parse_jp_site_opening_hours  # noqa: E402

# ⚠️ `pipeline_common`（= google-cloud-bigquery）と `pg_sync_common`（= psycopg2）は
#    **main() の中で読む**。ここで読むと外部依存が要り、pr-check の python テストから
#    このファイルを import できなくなる。SQL の形・引数・共有部品の配線は
#    **依存なしで縛りたい**（クロールを回さずに «事故になる箇所» を固定するため）。

LOGGER = logging.getLogger(__name__)

SOURCE = "official_site"

# 対象店。website を持ち、（既定では）まだ official_site の営業時間が無い店。
#
# ⚠️ `md5(restaurant_id || seed)` で並べるのは 6_2 の標本と同じ作法。同じ seed なら
#    同じ順に当たるので、«測ったのと同じ 300 件» を入れ直すこともできる。
CANDIDATE_SQL = """
SELECT r.id::text, r.name, l.value AS url
FROM {schema}.restaurant_links l
JOIN {schema}.restaurants r ON r.id = l.restaurant_id
WHERE l.kind = 'website'
  AND NULLIF(btrim(l.value), '') IS NOT NULL
  AND l.value ~* '^https?://'
  AND (%(country)s = 'ALL' OR r.country_code = %(country)s)
  {only_missing}
ORDER BY md5(l.restaurant_id::text || %(seed)s)
LIMIT %(limit)s
"""

ONLY_MISSING_CLAUSE = """
  AND NOT EXISTS (
    SELECT 1 FROM {schema}.restaurant_opening_hours h
    WHERE h.restaurant_id = r.id AND h.source = %(source)s
  )
"""

DELETE_SQL = """
DELETE FROM {schema}.restaurant_opening_hours
WHERE source = %s AND restaurant_id = ANY(%s::uuid[])
"""

INSERT_SQL = """
INSERT INTO {schema}.restaurant_opening_hours
  (restaurant_id, source, day_of_week, opens_at, closes_at, crosses_midnight, fetched_at, source_url)
VALUES %s
ON CONFLICT (restaurant_id, source, day_of_week, opens_at) DO NOTHING
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="公式サイトから営業時間を取り込みます")
    parser.add_argument("--schema", default="dev", choices=["dev", "public"])
    parser.add_argument("--country", default="JP", help="'ALL' で国を絞らない")
    parser.add_argument(
        "--limit",
        type=int,
        required=True,
        help="⚠️ 必須。既定値を置くと、うっかり 28 万サイトへ出て行く",
    )
    parser.add_argument("--seed", default="1666", help="同じ seed なら同じ順に当たる")
    parser.add_argument("--min-interval", type=float, default=2.0)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--commit-every", type=int, default=50, help="この店数ごとに commit する")
    parser.add_argument(
        "--no-only-missing",
        dest="only_missing",
        action="store_false",
        help="既に official_site の行がある店も対象にする（全部取り直すとき）",
    )
    parser.add_argument("--dry-run", action="store_true", help="ネットワークへ出ず、DB へも書かない")
    return parser.parse_args()


def flush(cursor, schema: str, restaurant_ids: list[str], rows: list[tuple]) -> None:
    """対象店の official_site 行を消してから入れ直す。**upsert にしないこと**（上の注記）。"""
    from psycopg2.extras import execute_values

    if not restaurant_ids:
        return
    cursor.execute(DELETE_SQL.format(schema=schema), (SOURCE, restaurant_ids))
    if rows:
        execute_values(cursor, INSERT_SQL.format(schema=schema), rows)


def main() -> int:
    args = parse_args()

    if args.schema == "public":
        # ⚠️ 本番へ書き込む判断はオーナーのものである。ここでは受け付けない。
        print("❌ このスクリプトは public へ書きません（dev で動かしてから、オーナーの指示で本番へ）")
        return 2

    from pg_sync_common import connect_postgres
    from pipeline_common import configure_logging

    configure_logging()
    connection = connect_postgres(args.schema)
    try:
        only_missing = ONLY_MISSING_CLAUSE.format(schema=args.schema) if args.only_missing else ""
        sql = CANDIDATE_SQL.format(schema=args.schema, only_missing=only_missing)
        params = {
            "country": args.country,
            "seed": args.seed,
            "limit": args.limit,
            "source": SOURCE,
        }
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            candidates = cursor.fetchall()

        LOGGER.info(
            "対象: %d 件（schema=%s / country=%s / seed=%s / only_missing=%s）",
            len(candidates),
            args.schema,
            args.country,
            args.seed,
            args.only_missing,
        )
        if args.dry_run:
            for rid, name, url in candidates[:20]:
                LOGGER.info("  %s  %s", name, url)
            LOGGER.info("  …（--dry-run のためここで終わり。ネットワークへも DB へも出ていません）")
            return 0

        counts: Counter[str] = Counter()
        failure_reasons: Counter[str] = Counter()
        robots_cache: dict = {}
        last_request_at = 0.0
        pending_ids: list[str] = []
        pending_rows: list[tuple] = []
        written_rows = 0
        written_stores = 0

        with connection.cursor() as cursor:
            for i, (rid, name, url) in enumerate(candidates, start=1):
                wait = args.min_interval - (time.monotonic() - last_request_at)
                if wait > 0:
                    time.sleep(wait)
                last_request_at = time.monotonic()

                try:
                    if not robots_allows(url, robots_cache, args.timeout):
                        counts["blocked_by_robots"] += 1
                        continue
                    html, reason = fetch(url, args.timeout)
                except Exception as e:  # noqa: BLE001 — 相手のサイトは何でも返してくる
                    html, reason = None, f"{type(e).__name__}"

                if html is None:
                    counts["unreachable"] += 1
                    failure_reasons[reason] += 1
                    continue

                text = html_to_text(html)
                bucket = classify_page(text)
                counts[bucket] += 1
                if bucket != "parsed":
                    # ⚠️ 読めなかったものは **入れない**。分からないものを推測しない。
                    #    既存の official_site 行があっても **消さない**（上の注記）。
                    #    一度読めなかっただけで良いデータを捨てないため。
                    continue

                parsed = parse_jp_site_opening_hours(text)
                if not parsed:
                    # classify_page が parsed と言った以上ここへは来ないはずだが、
                    # 2 度目に呼んで None なら «入れない» 側へ倒す（嘘の行を作らない）。
                    counts["parsed_but_empty"] += 1
                    continue

                fetched_at = dt.datetime.now(dt.timezone.utc)
                pending_ids.append(rid)
                for row in parsed:
                    pending_rows.append(
                        (
                            rid,
                            SOURCE,
                            row.day_of_week,
                            row.opens_at,
                            row.closes_at,
                            row.crosses_midnight,
                            fetched_at,
                            url,
                        )
                    )
                written_stores += 1

                if len(pending_ids) >= args.commit_every:
                    flush(cursor, args.schema, pending_ids, pending_rows)
                    connection.commit()
                    written_rows += len(pending_rows)
                    pending_ids, pending_rows = [], []

                if i % 25 == 0:
                    LOGGER.info("  … %d/%d 件（%s）", i, len(candidates), dict(counts))

            flush(cursor, args.schema, pending_ids, pending_rows)
            connection.commit()
            written_rows += len(pending_rows)

        LOGGER.info("===== 結果 =====")
        LOGGER.info("対象                 : %d 件", len(candidates))
        for key in (
            "parsed",
            "mentions_hours_unparsed",
            "no_hours_mentioned",
            "not_japanese_page",
            "unreachable",
            "blocked_by_robots",
            "parsed_but_empty",
        ):
            LOGGER.info("  %-24s: %d", key, counts[key])
        LOGGER.info("書き込んだ店         : %d 店 / %d 行", written_stores, written_rows)
        if failure_reasons:
            LOGGER.info("到達できなかった理由の内訳")
            for reason, n in failure_reasons.most_common(12):
                LOGGER.info("  %4d  %s", n, reason)
        LOGGER.info("戻すには: DELETE FROM %s.restaurant_opening_hours WHERE source = '%s';", args.schema, SOURCE)
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
