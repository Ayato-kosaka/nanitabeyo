#!/usr/bin/env python3
"""#1881 生成した BigQuery の CASE 式が **実際に BigQuery で動き、Python と同じ答えを返す**
ことを確かめる（読み取り専用。テーブルは 1 つも触らない）。

## なぜ要るか

`country_resolution.py` は判定を `RULES` 1 本に寄せ、Python と BigQuery SQL の両方を
そこから作っている。**が、「同じ 1 本から作った」ことと「同じ答えを返す」ことは別である。**

正規表現の方言は完全には一致しない:

- Python の `\\s` は Unicode の空白を含むが、RE2（BigQuery）は `[\\t\\n\\f\\r ]` だけ
- 先読みなど RE2 に無い構文を混ぜると **Python では通っても BigQuery で落ちる**
- `r'''…'''` のようなリテラルの書き方が受け付けられるかも、実際に投げるまで分からない

ユニットテストは «RE2 に無い構文を使っていない» までしか縛れない。
**BigQuery が本当にそう読むか**は BigQuery に聞くしかない。#1881 は
「作った規則と同じ規則で検証していた」ことが欠陥だったので、ここは手を抜かない。

## 何をするか

`test_country_resolution.py` の **手ラベル付き実住所**をそのまま BigQuery のリテラルへ流し、

1. 生成した CASE 式が構文エラーにならないこと
2. その答えが **Python の答えと 1 件残らず一致すること**
3. その答えが **人が付けたラベルと一致すること**

を確かめる。1 件でも食い違えば異常終了する。

## 課金

`SELECT` にテーブルを含まない（リテラルの UNNEST だけ）ので **スキャン量は 0 バイト**である。

## 使い方（db-script-run.yml から）

    script_path: scripts/20260808T0000_restaurant/9_9_verify_country_sql_matches_python.py
    requirements_path: scripts/20251213T0000_wikidata_food_graph/requirements.txt
    concurrency_group_suffix: readonly-audit
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from country_resolution import country_code_from_address, country_code_sql
from pipeline_common import BigQueryPipeline, configure_logging
from test_country_resolution import LABELLED_REAL_ADDRESSES

LOGGER = logging.getLogger(__name__)


def bigquery_string_literal(value: str) -> str:
    """住所をそのまま BigQuery の文字列リテラルにする。"""
    escaped = value.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")
    return f"'{escaped}'"


def build_query() -> str:
    rows = ",\n      ".join(
        f"STRUCT({idx} AS idx, {bigquery_string_literal(address)} AS address)"
        for idx, (address, _expected, _why) in enumerate(LABELLED_REAL_ADDRESSES)
    )
    case_expr = country_code_sql("t.address")
    return f"""
    WITH samples AS (
      SELECT * FROM UNNEST([
      {rows}
      ]) AS t
    )
    SELECT
      t.idx,
      t.address,
      {case_expr} AS country_code
    FROM samples AS t
    ORDER BY t.idx
    """


def main() -> int:
    configure_logging()
    pipeline = BigQueryPipeline()

    query = build_query()
    LOGGER.info(
        "手ラベル付きの実住所 %d 件を BigQuery へ流します（テーブルは読みません）",
        len(LABELLED_REAL_ADDRESSES),
    )

    rows = list(pipeline.execute(query))
    if len(rows) != len(LABELLED_REAL_ADDRESSES):
        LOGGER.error(
            "❌ 返ってきた行数が合いません: %d != %d",
            len(rows),
            len(LABELLED_REAL_ADDRESSES),
        )
        return 1

    sql_vs_python: list[str] = []
    sql_vs_label: list[str] = []

    for row in rows:
        address, expected, why = LABELLED_REAL_ADDRESSES[row["idx"]]
        from_sql = row["country_code"]
        from_python = country_code_from_address(address)

        if from_sql != from_python:
            sql_vs_python.append(
                f"{address!r}: SQL={from_sql} / Python={from_python}"
            )
        if from_sql != expected:
            sql_vs_label.append(
                f"{address!r}: SQL={from_sql} / 人のラベル={expected}（{why}）"
            )

    LOGGER.info("")
    LOGGER.info("=" * 78)
    LOGGER.info("# #1881 BigQuery の CASE 式と Python の判定が一致するか")
    LOGGER.info("=" * 78)
    LOGGER.info("検査した住所            : %d 件", len(rows))
    LOGGER.info("SQL と Python の食い違い: %d 件", len(sql_vs_python))
    LOGGER.info("SQL と 人ラベルの食い違い: %d 件", len(sql_vs_label))

    for line in sql_vs_python:
        LOGGER.error("  ❌ 方言の差: %s", line)
    for line in sql_vs_label:
        LOGGER.error("  ❌ 判定の誤り: %s", line)

    if sql_vs_python or sql_vs_label:
        LOGGER.error("")
        LOGGER.error(
            "❌ 生成した SQL が期待どおりに動いていません。"
            " country_resolution.RULES を RE2 でも同じ意味になる形へ直してください。"
        )
        return 1

    LOGGER.info("")
    LOGGER.info("✅ 全件一致。BigQuery でも Python と同じ答えを返します。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
