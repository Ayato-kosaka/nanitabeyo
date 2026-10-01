#!/usr/bin/env python3
"""#843 §3「Google Text Search fallback を不要にする」を、**実際の検索**で測る（読み取り専用）。

## なぜ要るか — 見出し指標（coverage）は «人が検索する場所» を見ていない

[#843](https://github.com/Ayato-kosaka/nanitabeyo/issues/843) の見出し指標は
`area × dish_category` を**均等に**数える。だが Google fallback が起きるのは
**ユーザーが実際にした検索が 0 件だったとき**だけである
（`app-expo/lib/dishMediaSearch.ts` の `if (dishItems.length > 0) return`）。

本番の実測（2026-10-01）では、

| 測り方 | 数字 |
| --- | ---: |
| dev を一様なセル格子で測る（半径 500m / 1 件以上） | **1.92%** |
| 本番で実際にされた検索のうち 0 件でなかった率 | **28.6%** |

と **15 倍**違う。人は店と投稿がある場所で検索するからである。
したがって «本番同期後に fallback が何 % 残るか» は、
**需要の重みを入れた coverage** でしか予測できない。それを出すのがこのスクリプト。

## 測り方

1. `--demand-csv`（既定 `data/google_fallback_demand.csv`）が持つ
   `(S2 セル level 14, カテゴリ, 半径, 落ちた回数)` を読む。
   出所と «地点そのものを置いていない» 理由はその CSV の先頭に書いてある
2. coverage 計測と**同じ道具**で dev の在庫を一時テーブルへ作る
   （`build_usable_dish_media_temp_table` / `build_area_cells_temp_table`）。
   «使える dish_media» の定義はここに書かない（`dish_media_coverage_sql` が正）
3. 起点は **JP gate で絞らない**（`include_jp_gate=False`）。
   本番の検索は gate を見ないので、gate で絞ると gate の外の供給を無いものとして数える
4. 需要にある半径ごとに、需要のセルだけへ絞って
   `build_stage5_matched_rows_sql` を 1 回評価し、(セル, カテゴリ) → 店舗数を得る
5. **落ちた回数で重みづけて**「1 件以上返せた / 返せなかった」を足す

## 出すもの

1. 需要の重みを入れた «返せた率»（下界と上界）
2. 返せなかった検索が多いカテゴリ（上位 15）
3. **«需要があって供給が無い (セル, カテゴリ)» の一覧**（`--out-targets` で全件を CSV へ）。
   2026-10-01 の実測で **返せない理由はカテゴリ不足ではなく地理の偏り**だと分かった
   （ラーメンは全国 6,180 店に在庫があるのに、ラーメンの検索の 83% が返せない）。
   ⚠️ **2 種類を混ぜないこと**: «店はあるが投稿が無い»（crawl で埋まる）と
   «店の記録すら無い»（crawl では埋まらない）。`kind` 列で分けてある

## ⚠️ この数字が言えないこと

- **セルへ集計したぶんの誤差がある。** 需要は level 14 セル（1 辺およそ 560m）へ丸めてあり、
  判定はそのセルの代表点（セル内 restaurants の重心）から半径を取る。
  ユーザーの実際の地点はセルの中のどこかなので、**最大でセルの対角ぶんずれる**
- **`area_cells` に無いセルは «返せなかった» 側へ数える。** セルは restaurants の座標から
  作るので、店が 1 件も無いセルは現れない。ただし**その地点から 500m 以内に隣のセルの店が
  ある可能性は残る**ので、この扱いは **«返せた» の下界**になる。
  下界と上界の両方を出す（上界 = 代表点が無いセルを分母から除いたときの率）
- **timeSlot の除外を見ていない。** `BulkImportFromGoogle` の dto は timeSlot を持たない。
  時間帯で除外される検索があるぶん、**「返せた」は上に寄る**
- **14 日ぶんの需要**である。率は 4 か月安定しているが、母数は月ごとに大きく違う

## 使い方（db-script-run.yml から）

    script_path: scripts/db-checks/measure_google_fallback_avoidable.py
    args: --schema dev
    requirements_path: scripts/20260808T0000_restaurant/requirements.txt

⚠️ `requirements_path` は既定（wikidata 側）では **動かない**（`s2sphere` が無い）。

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須。db-script-run.yml が secrets から渡す）
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import sys
from collections import defaultdict
from pathlib import Path

import psycopg2
import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent))

import dish_media_coverage_sql as coverage_sql  # noqa: E402
from measure_dish_media_coverage import (  # noqa: E402
    build_area_cells_temp_table,
    build_usable_dish_media_temp_table,
    section,
)

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

DEFAULT_DEMAND_CSV = Path(__file__).resolve().parent / "data" / "google_fallback_demand.csv"
#: 需要 CSV を作った S2 レベル（CSV の先頭に書いてある前提と必ず揃える）。
DEMAND_S2_LEVEL = 14
#: 1 回のクエリへ渡すセル数。coverage 計測の既定と同じ理由（一時ファイルを膨らませない）。
DEFAULT_CELL_BATCH_SIZE = coverage_sql.DEFAULT_CELL_BATCH_SIZE
AREA_TABLE = coverage_sql.DEFAULT_AREA_CELLS_TABLE_NAME
MEDIA_TABLE = coverage_sql.DEFAULT_TEMP_TABLE_NAME
DRIVER_TABLE = coverage_sql.DEFAULT_STAGE5_DRIVER_TABLE_NAME


class DemandRow(tuple):
    """`(s2_cell_id, category_id, radius_m, searches)`。tuple のまま扱う（辞書を増やさない）。"""

    __slots__ = ()

    @property
    def cell_id(self) -> int:
        return self[0]

    @property
    def category_id(self) -> str:
        return self[1]

    @property
    def radius_m(self) -> float:
        return self[2]

    @property
    def searches(self) -> int:
        return self[3]


def load_demand(path: Path) -> list[DemandRow]:
    """需要 CSV を読む。`#` で始まる行は出所を書いたコメントなので飛ばす。"""
    with path.open(encoding="utf-8") as handle:
        body = [line for line in handle if not line.startswith("#")]
    rows: list[DemandRow] = []
    for record in csv.DictReader(body):
        rows.append(
            DemandRow(
                (
                    int(record["s2_cell_id"]),
                    record["category_id"],
                    float(record["radius_m"]),
                    int(record["searches"]),
                )
            )
        )
    if not rows:
        raise SystemExit(f"❌ 需要が 1 行も読めない: {path}")
    return rows


def batched(values: list[int], size: int) -> list[list[int]]:
    return [values[i : i + size] for i in range(0, len(values), size)]


def fetch_matched_counts(
    cur, radius_m: float, cell_ids: list[int], cell_batch_size: int
) -> dict[tuple[int, str], int]:
    """半径 `radius_m` で «(セル, カテゴリ) → 半径内の店舗数» を引く（0 の組は返らない）。

    SQL は coverage 計測の `build_stage5_matched_rows_sql` をそのまま使う。
    **ここで集計の定義を書き直さない**（#1782 で «同じ判定を 2 箇所» の事故を踏んでいる）。
    """
    sql = coverage_sql.build_stage5_matched_rows_sql(
        radius_m=radius_m,
        area_table_name=AREA_TABLE,
        driver_table_name=DRIVER_TABLE,
        batched=True,
    )
    counts: dict[tuple[int, str], int] = {}
    chunks = batched(cell_ids, cell_batch_size)
    for index, chunk in enumerate(chunks, 1):
        cur.execute(sql, {"cell_ids": chunk})
        for cell_id, category_id, restaurants in cur.fetchall():
            counts[(cell_id, category_id)] = restaurants
        # ⚠️ 進捗ログは `continue` の後ろへ置かない（#1666 で 3,000 件中 6 行しか出なかった）
        logger.info(
            "  半径 %sm: batch %s/%s（セル %s 件 / 非ゼロ %s 組）",
            f"{radius_m:,.0f}",
            index,
            len(chunks),
            len(chunk),
            f"{len(counts):,}",
        )
    return counts


def existing_area_cells(cur, cell_ids: list[int]) -> set[int]:
    """`area_cells` に実在するセル（= restaurants が 1 件以上あるセル）。"""
    cur.execute(
        f"SELECT s2_cell_id FROM {AREA_TABLE} WHERE s2_cell_id = ANY(%(cell_ids)s::bigint[])",
        {"cell_ids": cell_ids},
    )
    return {row[0] for row in cur.fetchall()}


def cell_restaurant_counts(cur, cell_ids: list[int]) -> dict[int, int]:
    """需要のセルごとの店舗数。«投稿が無い» と «店の記録が無い» を分けるために要る。"""
    cur.execute(
        f"SELECT s2_cell_id, restaurant_count FROM {AREA_TABLE}"
        " WHERE s2_cell_id = ANY(%(cell_ids)s::bigint[])",
        {"cell_ids": cell_ids},
    )
    return {cell_id: count for cell_id, count in cur.fetchall()}


def summarize(
    demand: list[DemandRow],
    counts: dict[tuple[int, str], int],
    known_cells: set[int],
    restaurants_by_cell: dict[int, int] | None = None,
) -> dict:
    """需要の重みづけで «返せた / 返せなかった» を足す。

    下界（`served_rate_lower`）は `area_cells` に無いセルを «返せなかった» 側へ数える。
    上界（`served_rate_upper`）はそのセルを分母から除く（代表点が無く判定できないため）。
    """
    total_searches = sum(row.searches for row in demand)
    served_searches = 0
    unknown_searches = 0
    by_category: dict[str, dict[str, int]] = defaultdict(
        lambda: {"searches": 0, "served": 0}
    )

    for row in demand:
        bucket = by_category[row.category_id]
        bucket["searches"] += row.searches
        if row.cell_id not in known_cells:
            unknown_searches += row.searches
            continue
        if counts.get((row.cell_id, row.category_id), 0) >= 1:
            served_searches += row.searches
            bucket["served"] += row.searches

    judgeable = total_searches - unknown_searches
    pairs_total = len(demand)
    pairs_served = sum(
        1
        for row in demand
        if row.cell_id in known_cells and counts.get((row.cell_id, row.category_id), 0) >= 1
    )

    worst = sorted(
        (
            (category_id, values["searches"] - values["served"], values["searches"])
            for category_id, values in by_category.items()
        ),
        key=lambda item: (-item[1], item[0]),
    )[:15]

    # ⚠️ ここが «次に何を crawl すべきか» の出口である（#843 §3）。
    #    2026-10-01 の実測で «返せないのはカテゴリ不足ではなく地理の偏り» と分かった
    #    （ラーメンは全国 6,180 店に在庫があるのに検索の 83% が返せない）。
    #    だから «需要があって供給が無いセル» を名指しできないと手が打てない。
    #    2 種類に分ける: 店はあるが投稿が無い（crawl すれば埋まる）/ 店の記録すら無い（別問題）。
    counts_by_cell = restaurants_by_cell or {}
    targets: list[dict] = []
    for row in demand:
        if row.cell_id in known_cells and counts.get((row.cell_id, row.category_id), 0) >= 1:
            continue
        restaurants = counts_by_cell.get(row.cell_id, 0)
        targets.append(
            {
                "s2_cell_id": row.cell_id,
                "category_id": row.category_id,
                "unserved_searches": row.searches,
                "restaurants_in_cell": restaurants,
                # crawl で埋まる見込みがあるのは «店はあるが投稿が無い» 側だけ
                "kind": "no_media" if restaurants > 0 else "no_restaurant",
            }
        )
    targets.sort(key=lambda t: (-t["unserved_searches"], -t["restaurants_in_cell"],
                                t["s2_cell_id"], t["category_id"]))

    return {
        "demand_pairs": pairs_total,
        "demand_searches": total_searches,
        "searches_served": served_searches,
        "searches_unjudgeable_no_area_cell": unknown_searches,
        "served_rate_lower": served_searches / total_searches if total_searches else None,
        "served_rate_upper": served_searches / judgeable if judgeable else None,
        "pairs_served": pairs_served,
        "pairs_served_rate": pairs_served / pairs_total if pairs_total else None,
        "worst_categories_by_unserved_searches": [
            {"category_id": category_id, "unserved": unserved, "searches": searches}
            for category_id, unserved, searches in worst
        ],
        # ⚠️ «狙い撃ちの crawl がどれだけの規模になるか» を出す。
        #    全件クロール（restaurant_links の website 282,163 サイト）の代わりに
        #    «需要がある所だけ» を回るなら、相手はこのセル群の店だけである。
        #    セルはカテゴリをまたいで重複するので、**セルの異なり**で数える。
        "no_media_cells_distinct": len({
            t["s2_cell_id"] for t in targets if t["kind"] == "no_media"
        }),
        "restaurants_in_no_media_cells": sum(
            counts_by_cell.get(cell_id, 0)
            for cell_id in {t["s2_cell_id"] for t in targets if t["kind"] == "no_media"}
        ),
        "crawl_targets_total": len(targets),
        "crawl_targets_no_media": sum(1 for t in targets if t["kind"] == "no_media"),
        "crawl_targets_no_restaurant": sum(1 for t in targets if t["kind"] == "no_restaurant"),
        "unserved_searches_in_cells_with_restaurants": sum(
            t["unserved_searches"] for t in targets if t["kind"] == "no_media"
        ),
        "unserved_searches_in_cells_without_restaurants": sum(
            t["unserved_searches"] for t in targets if t["kind"] == "no_restaurant"
        ),
        "crawl_targets": targets,
    }


def report(summary: dict) -> None:
    section("需要の重みを入れた «Google fallback を避けられる率»")
    total = summary["demand_searches"]
    logger.info("需要（14 日 / Google へ落ちた検索）: %s 件 / %s 組",
                f"{total:,}", f"{summary['demand_pairs']:,}")
    logger.info("1 件以上返せた検索:              %s 件", f"{summary['searches_served']:,}")
    logger.info("判定できなかった検索:            %s 件（そのセルに restaurants が 1 件も無い）",
                f"{summary['searches_unjudgeable_no_area_cell']:,}")
    logger.info("")
    lower = summary["served_rate_lower"]
    upper = summary["served_rate_upper"]
    logger.info("▶ 返せた率（下界。判定不能を «返せない» 側へ）: %s",
                "—" if lower is None else f"{lower * 100:.2f}%")
    logger.info("▶ 返せた率（上界。判定不能を分母から除く）:     %s",
                "—" if upper is None else f"{upper * 100:.2f}%")
    logger.info("")
    logger.info("（重みを入れない (セル, カテゴリ) ベース: %s / %s = %s）",
                f"{summary['pairs_served']:,}",
                f"{summary['demand_pairs']:,}",
                "—" if summary["pairs_served_rate"] is None
                else f"{summary['pairs_served_rate'] * 100:.2f}%")
    logger.info("")
    logger.info("返せなかった検索が多いカテゴリ（上位 15）")
    for item in summary["worst_categories_by_unserved_searches"]:
        logger.info("  %-12s 返せなかった %4s 件 / 需要 %4s 件",
                    item["category_id"], item["unserved"], item["searches"])

    section("次に何を埋めるべきか（需要があって供給が無い (セル, カテゴリ)）")
    logger.info("対象 %s 組。2 種類に分かれる:", f"{summary['crawl_targets_total']:,}")
    logger.info("  ▶ 店はあるが投稿が無い（crawl で埋まる）:   %s 組 / 検索 %s 件",
                f"{summary['crawl_targets_no_media']:,}",
                f"{summary['unserved_searches_in_cells_with_restaurants']:,}")
    logger.info("  ▶ 店の記録すら無い（crawl では埋まらない）: %s 組 / 検索 %s 件",
                f"{summary['crawl_targets_no_restaurant']:,}",
                f"{summary['unserved_searches_in_cells_without_restaurants']:,}")
    logger.info("")
    logger.info("狙い撃ちの crawl の規模: セル %s 件 / そこに在る店 %s 件",
                f"{summary['no_media_cells_distinct']:,}",
                f"{summary['restaurants_in_no_media_cells']:,}")
    logger.info("")
    logger.info("上位 20 組（--out-targets で全件を CSV へ書ける）")
    logger.info("  %-21s %-12s %6s %8s  %s", "s2_cell_id", "category", "検索", "店数", "種別")
    for target in summary["crawl_targets"][:20]:
        logger.info("  %-21s %-12s %6s %8s  %s",
                    target["s2_cell_id"], target["category_id"],
                    target["unserved_searches"], target["restaurants_in_cell"],
                    target["kind"])


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--schema", default="dev", choices=["dev"],
                        help="対象スキーマ。public は置かない（本番を測るのはオーナーが"
                             " public と言ったときだけ）")
    parser.add_argument("--demand-csv", type=Path, default=DEFAULT_DEMAND_CSV,
                        help=f"需要 CSV（既定: {DEFAULT_DEMAND_CSV.name}）")
    parser.add_argument("--s2-level", type=int, default=DEMAND_S2_LEVEL,
                        help=f"area セルの S2 レベル。⚠️ 需要 CSV を作ったレベル"
                             f"（{DEMAND_S2_LEVEL}）と揃えること。ずれると突き合わせが全部外れる")
    parser.add_argument("--cell-batch-size", type=int, default=DEFAULT_CELL_BATCH_SIZE,
                        help=f"1 クエリへ渡すセル数（既定: {DEFAULT_CELL_BATCH_SIZE}）")
    parser.add_argument("--statement-timeout-s", type=int, default=600,
                        help="1 文あたりの上限秒（既定: 600）")
    parser.add_argument("--out-json", type=Path, default=None, help="JSON の書き出し先")
    parser.add_argument("--out-targets", type=Path, default=None,
                        help="«需要があって供給が無い (セル, カテゴリ)» の全件を CSV へ書く")
    return parser


def parse_args() -> argparse.Namespace:
    return build_arg_parser().parse_args()


def main() -> int:
    args = parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    demand = load_demand(args.demand_csv)
    logger.info("需要を読んだ: %s 組 / のべ %s 件（%s）",
                f"{len(demand):,}",
                f"{sum(row.searches for row in demand):,}",
                args.demand_csv)

    with psycopg2.connect(database_url) as conn:
        # 一時テーブルの DDL は read-only トランザクションでは通らない。
        # 作り終えてから read-only へ切り替える（measure_dish_media_coverage.py と同じ順序）。
        conn.set_session(autocommit=True)
        with conn.cursor() as cur:
            cur.execute(f'SET search_path TO "{args.schema}", extensions')
            cur.execute(f"SET statement_timeout = '{args.statement_timeout_s}s'")

            section("1. dev の在庫を一時テーブルへ（coverage 計測と同じ道具）")
            build_usable_dish_media_temp_table(cur, MEDIA_TABLE)
            build_area_cells_temp_table(cur, AREA_TABLE, args.s2_level)

            # ⚠️ 本番の検索は JP gate を見ないので、起点を gate で絞らない。
            cur.execute(
                coverage_sql.build_stage5_driver_temp_table_sql(
                    driver_table_name=DRIVER_TABLE,
                    media_table_name=MEDIA_TABLE,
                    include_jp_gate=False,
                )
            )
            for statement in coverage_sql.build_stage5_driver_temp_index_sql(DRIVER_TABLE):
                cur.execute(statement)
            cur.execute(coverage_sql.build_stage5_driver_count_sql(DRIVER_TABLE))
            logger.info("起点（JP gate で絞らない (店, カテゴリ)）: %s 行",
                        f"{cur.fetchone()[0]:,}")

            cur.execute("SET default_transaction_read_only = on")

            section("2. 需要にある半径ごとに 1 回ずつ集計する")
            by_radius: dict[float, list[DemandRow]] = defaultdict(list)
            for row in demand:
                by_radius[row.radius_m].append(row)
            logger.info("半径の種類: %s", ", ".join(
                f"{radius:,.0f}m({len(rows)}組)"
                for radius, rows in sorted(by_radius.items())))

            counts: dict[tuple[int, str], int] = {}
            all_cells = sorted({row.cell_id for row in demand})
            known_cells = existing_area_cells(cur, all_cells)
            logger.info("需要のセル %s 件のうち、restaurants が在るセル %s 件",
                        f"{len(all_cells):,}", f"{len(known_cells):,}")

            for radius_m, rows in sorted(by_radius.items()):
                cells = sorted({row.cell_id for row in rows if row.cell_id in known_cells})
                if not cells:
                    logger.info("  半径 %sm: 判定できるセルが無い", f"{radius_m:,.0f}")
                    continue
                counts.update(
                    fetch_matched_counts(cur, radius_m, cells, args.cell_batch_size)
                )

            restaurants_by_cell = cell_restaurant_counts(cur, all_cells)

    summary = summarize(demand, counts, known_cells, restaurants_by_cell)
    report(summary)

    if args.out_targets:
        with args.out_targets.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=["s2_cell_id", "category_id", "unserved_searches",
                            "restaurants_in_cell", "kind"],
            )
            writer.writeheader()
            writer.writerows(summary["crawl_targets"])
        logger.info("ターゲットを書き出した: %s（%s 組）",
                    args.out_targets, f"{summary['crawl_targets_total']:,}")

    # ⚠️ `crawl_targets` は数千行あるので JSON の 1 行へ混ぜない
    #    （Job Summary が読めなくなる）。全件は --out-targets の CSV が正。
    payload = {
        "demand_csv": str(args.demand_csv),
        "schema": args.schema,
        "s2_level": args.s2_level,
        **{key: value for key, value in summary.items() if key != "crawl_targets"},
        "crawl_targets_top20": summary["crawl_targets"][:20],
    }
    line = json.dumps(payload, ensure_ascii=False)
    section("JSON（機械可読。db-script-run.yml の Job Summary から回収する）")
    logger.info("%s", line)
    if args.out_json:
        args.out_json.write_text(line + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
