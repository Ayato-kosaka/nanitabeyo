#!/usr/bin/env python3
"""#1881 住所から決めた国コードを、dev の全行に当てて **カバー率と食い違い**を測る（読み取り専用）。

## なぜ要るか

判定器（`scripts/20260808T0000_restaurant/country_resolution.py`）が実データで何割を
決められるのか、いまの `country_code` と何行食い違うのかを、**直す前に**出す。

「住所を見れば分かるはず」で置き換えると、住所が空・国名が入っていない行が
静かに NULL になったことに気づけない。

## ⚠️ 判定は写経しない

本番と同じ `country_resolution.country_code_from_address` を import して当てる。
ここで SQL の正規表現に «同じ判定» を書き直すと、#1881 と同じ循環に戻る。

## 出すもの

1. 住所から国を決められた行 / 決められなかった行
2. いまの `country_code` との食い違い（**どの国へ変わるか**）
3. 決められなかった行の内訳（住所が空 / 住所はあるが手掛かりが無い）

## 読み取り専用である

SELECT しか実行しない。接続直後に `SET default_transaction_read_only = on` を実行する。

## 使い方（db-script-run.yml から）

    script_path: scripts/db-checks/measure_country_resolution_coverage.py
    args: --schema dev
    requirements_path: scripts/20251213T0000_wikidata_food_graph/requirements.txt
    concurrency_group_suffix: readonly-audit
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "20260808T0000_restaurant"))

from country_resolution import country_code_from_address  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

ROWS_SQL = """
  SELECT country_code, address, created_by_source
  FROM restaurants
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    parser.add_argument(
        "--samples",
        type=int,
        default=15,
        help="決められなかった住所の実物を何件出すか",
    )
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    import psycopg2

    resolved_counts: Counter[str] = Counter()
    transitions: Counter[tuple[str | None, str | None]] = Counter()
    # ⚠️ 9_1 の同期が上書きするのは created_by_source='pipeline' の行だけである。
    #    全行で «NULL になる» を数えると、触らないユーザー作成の行まで数えてしまう。
    pipeline_transitions: Counter[tuple[str | None, str | None]] = Counter()
    by_source: Counter[str] = Counter()
    unresolved_empty = 0
    unresolved_with_address = 0
    unresolved_samples: list[str] = []
    total = 0

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as setup:
            setup.execute("SET default_transaction_read_only = on")
            setup.execute(f'SET search_path TO "{args.schema}", extensions')
            setup.execute("SELECT current_user, current_database()")
            user, db = setup.fetchone()
            logger.info("接続先: user=%s db=%s schema=%s", user, db, args.schema)

        # 62 万行を一度に取らないよう server-side cursor で流す
        with conn.cursor(name="country_scan") as cur:
            cur.itersize = 10_000
            cur.execute(ROWS_SQL)
            for current, address, source in cur:
                total += 1
                resolved = country_code_from_address(address)
                resolved_counts[resolved or "(決められない)"] += 1
                transitions[(current, resolved)] += 1
                by_source[source or "(NULL)"] += 1
                if source == "pipeline":
                    pipeline_transitions[(current, resolved)] += 1
                if resolved is None:
                    if not address:
                        unresolved_empty += 1
                    else:
                        unresolved_with_address += 1
                        if len(unresolved_samples) < args.samples:
                            unresolved_samples.append(address)

    def pct(n: int) -> str:
        return f"{100.0 * n / total:.2f}%" if total else "n/a"

    logger.info("")
    logger.info("=" * 78)
    logger.info("# #1881 住所から決めた国コードの当たり具合（schema=%s）", args.schema)
    logger.info("=" * 78)
    logger.info("restaurants 総数 : %12s", f"{total:,}")
    logger.info("")
    logger.info("## 住所から決められた国")
    for code, count in resolved_counts.most_common():
        logger.info("  %-18s : %12s (%s)", code, f"{count:,}", pct(count))

    logger.info("")
    logger.info("## いまの country_code → 住所から決めた国（上位 15）")
    logger.info("  %-8s %-14s %12s", "いま", "住所から", "行数")
    for (current, resolved), count in transitions.most_common(15):
        mark = ""
        if resolved is not None and current is not None and resolved != current:
            mark = "  ← 変わる"
        elif resolved is None and current is not None:
            mark = "  ← NULL になる"
        logger.info(
            "  %-8s %-14s %12s%s",
            current or "NULL",
            resolved or "(決められない)",
            f"{count:,}",
            mark,
        )

    logger.info("")
    logger.info("## 決められなかった行の内訳")
    logger.info("  住所が空                     : %12s", f"{unresolved_empty:,}")
    logger.info("  住所はあるが手掛かりが無い   : %12s", f"{unresolved_with_address:,}")
    if unresolved_samples:
        logger.info("")
        logger.info("  手掛かりが無い住所の実物:")
        for address in unresolved_samples:
            logger.info("    %s", address)

    logger.info("")
    logger.info("## created_by_source の内訳")
    for source, count in by_source.most_common():
        logger.info("  %-12s : %12s", source, f"{count:,}")

    logger.info("")
    logger.info("## ⚠️ 9_1 が実際に上書きする行だけ（created_by_source='pipeline'）")
    pipeline_total = sum(pipeline_transitions.values())
    for (current, resolved), count in pipeline_transitions.most_common(10):
        logger.info(
            "  %-8s → %-14s %12s",
            current or "NULL",
            resolved or "(決められない)",
            f"{count:,}",
        )
    logger.info("  合計 : %s", f"{pipeline_total:,}")

    changed = sum(
        c
        for (current, resolved), c in transitions.items()
        if resolved is not None and current is not None and resolved != current
    )
    to_null = sum(
        c
        for (current, resolved), c in transitions.items()
        if resolved is None and current is not None
    )
    filled = sum(
        c
        for (current, resolved), c in transitions.items()
        if current is None and resolved is not None
    )

    logger.info("")
    logger.info("=" * 78)
    logger.info("# まとめ")
    logger.info("=" * 78)
    logger.info("値が変わる行           : %12s (%s)", f"{changed:,}", pct(changed))
    logger.info("NULL になる行          : %12s (%s)", f"{to_null:,}", pct(to_null))
    logger.info("NULL から埋まる行      : %12s (%s)", f"{filled:,}", pct(filled))

    result = {
        "schema": args.schema,
        "restaurants_total": total,
        "resolved": dict(resolved_counts),
        "transitions": {f"{c or 'NULL'}->{r or 'NULL'}": n for (c, r), n in transitions.items()},
        "unresolved_address_empty": unresolved_empty,
        "unresolved_with_address": unresolved_with_address,
        "changed": changed,
        "to_null": to_null,
        "filled_from_null": filled,
        "by_created_by_source": dict(by_source),
        "pipeline_transitions": {
            f"{c or 'NULL'}->{r or 'NULL'}": n for (c, r), n in pipeline_transitions.items()
        },
    }
    logger.info("")
    logger.info("=" * 78)
    logger.info("# JSON（機械可読）")
    logger.info("=" * 78)
    logger.info(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
