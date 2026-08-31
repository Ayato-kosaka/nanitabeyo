#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
9_5_remap_dish_categories_to_searchable.py

【目的】
#1748 検索から永久に到達できない料理カテゴリで保存された `dishes` を、
同じ日本語ラベルを持つ «検索に出る» カテゴリへ付け替える。

【なぜ必要か】
1 つの表記は 1 つの QID しか持てない。従来の変換表は表記が衝突したとき
Q 番号の小さい方を採っていたため、利用者が入力できるのに検索が決して要求しない QID が
表記を持っていた（例: 表記「焼肉」を Q844466 = 広東料理の焼豚 siu yuk が保持し、
検索が要求する Q2431975 = yakiniku には日本語の「焼肉」が無かった）。

`4_1_generate_variants.py` の修正で **これから保存されるもの**は正しい QID になるが、
**既に保存されたもの**は古い QID のままで、`findDishMediaIds` の
`d.category_id = :category_id` 完全一致に永久にヒットしない。この差を埋める。

【付け替えの決め方】
ハードコードしない。BigQuery から次を満たす対 (from → to) を導出する。

- `from` は `dish_category_features_catalog` に**居ない**（＝検索が要求しない）
- `to` は同じ `label_ja` を持ち、`dish_category_features_catalog` に**居る**
- その `label_ja` に対応する «居る» 側が**ちょうど 1 つ**（曖昧なら付け替えない）

【UNIQUE 制約の扱い】
`dishes` には UNIQUE (restaurant_id, category_id) がある
（infra/supabase/migrations/20251012T0900_add_unique_on_dishes_restaurant_category_and_fix_duplicates.sql）。
同じ店に付け替え先の dish が既にあると単純 UPDATE は落ちるので、その場合は
子（dish_media / dish_reviews）を既存の dish へ移し、空になった dish を消す。

【使用方法】
# ドライラン（読み取りのみ。件数と衝突を出す）
python3 9_5_remap_dish_categories_to_searchable.py --schema dev --dry-run

# 本実行
python3 9_5_remap_dish_categories_to_searchable.py --schema dev

【環境変数】
- DATABASE_URL: PostgreSQL 接続文字列（必須）

【ロールバック】
本実行は «付け替えた dish の id と元の category_id» を実行ログと
`--output-dir` のファイルへ残す。戻すときはその一覧に限定して逆 UPDATE すること。
一覧に限定するのは、元から付け替え先だった行へ逆写像が波及しないようにするためである。
"""

import sys
import os
import json
import argparse
import logging
from datetime import datetime, timezone
from typing import Dict, List, Tuple
from pathlib import Path

sys.path.append(str(Path(__file__).parent))
from loader_bigquery import BigQueryLoader
from sync_common import (
    PostgreSQLConnection, backup_table_to_gcs, GCP_PROJECT, BQ_DATASET
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def build_remap_pairs(loader: BigQueryLoader) -> List[Tuple[str, str, str]]:
    """
    #1748 «検索に出ない QID» → «同じ日本語ラベルで検索に出る QID» の対を導出する。

    曖昧なものは返さない。1 つの label_ja に «検索に出る» 側が 2 つ以上あるときは、
    どちらへ寄せるべきかをこのスクリプトでは決められないので対象から外す
    （黙って片方へ寄せると、直したつもりで別の取り違えを作る）。

    Args:
        loader: BigQueryLoader

    Returns:
        (from_qid, to_qid, label_ja) のリスト
    """
    query = f"""
        WITH searchable AS (
          SELECT DISTINCT item_qid
          FROM `{loader.dataset_ref}.dish_category_features_catalog`
          WHERE item_qid IS NOT NULL
        ),
        labeled AS (
          SELECT c.item_qid, c.label_ja,
                 c.item_qid IN (SELECT item_qid FROM searchable) AS is_searchable
          FROM `{loader.dataset_ref}.dish_category_catalog` c
          WHERE c.label_ja IS NOT NULL AND c.label_ja != ''
        ),
        -- その label_ja で «検索に出る» 側がちょうど 1 つのものだけを対象にする
        unique_targets AS (
          SELECT label_ja, ANY_VALUE(item_qid) AS to_qid
          FROM labeled
          WHERE is_searchable
          GROUP BY label_ja
          HAVING COUNT(DISTINCT item_qid) = 1
        )
        SELECT l.item_qid AS from_qid, t.to_qid, l.label_ja
        FROM labeled l
        JOIN unique_targets t ON t.label_ja = l.label_ja
        WHERE NOT l.is_searchable
        ORDER BY l.label_ja
    """
    rows = list(loader.client.query(query).result())
    pairs = [(r.from_qid, r.to_qid, r.label_ja) for r in rows]
    logger.info(f"Derived {len(pairs)} remap pairs from BigQuery")
    for from_qid, to_qid, label_ja in pairs:
        logger.info(f"  {from_qid} -> {to_qid}  ('{label_ja}')")
    return pairs


def filter_pairs_by_pg_categories(
    pg_conn: PostgreSQLConnection,
    pairs: List[Tuple[str, str, str]]
) -> List[Tuple[str, str, str]]:
    """
    付け替え先が PostgreSQL の `dish_categories` に存在する対だけを残す。

    `dishes.category_id` は `dish_categories.id` への外部キーなので、
    存在しない QID へ付け替えると FK 違反で落ちる。BigQuery のカタログに居ても
    PostgreSQL へまだ同期されていない QID はありうるため、ここで落とす。

    Args:
        pg_conn: PostgreSQL 接続
        pairs: build_remap_pairs の結果

    Returns:
        付け替え先が実在する対だけのリスト
    """
    if not pairs:
        return []

    to_qids = list({to_qid for _, to_qid, _ in pairs})
    pg_conn.cursor.execute(
        "SELECT id FROM dish_categories WHERE id = ANY(%s)", (to_qids,)
    )
    existing = {r[0] for r in pg_conn.cursor.fetchall()}

    kept, dropped = [], []
    for pair in pairs:
        (kept if pair[1] in existing else dropped).append(pair)

    for from_qid, to_qid, label_ja in dropped:
        logger.warning(
            f"[SKIP] 付け替え先が dish_categories に無い: {from_qid} -> {to_qid} ('{label_ja}')"
        )
    logger.info(f"Remap pairs after dish_categories check: {len(kept)} (dropped {len(dropped)})")
    return kept


def collect_affected(
    pg_conn: PostgreSQLConnection,
    pairs: List[Tuple[str, str, str]]
) -> List[Dict]:
    """
    付け替え対象の dish を、UNIQUE 衝突の有無つきで集める。

    Args:
        pg_conn: PostgreSQL 接続
        pairs: 付け替え対

    Returns:
        [{dish_id, restaurant_id, from_qid, to_qid, label_ja,
          media, reviews, merge_into}] のリスト。
        `merge_into` は同じ店に既にある付け替え先 dish の id（無ければ None）
    """
    affected = []
    for from_qid, to_qid, label_ja in pairs:
        pg_conn.cursor.execute(
            """
            SELECT d.id, d.restaurant_id,
                   (SELECT COUNT(*) FROM dish_media dm WHERE dm.dish_id = d.id),
                   (SELECT COUNT(*) FROM dish_reviews dr WHERE dr.dish_id = d.id),
                   (SELECT t.id FROM dishes t
                     WHERE t.restaurant_id = d.restaurant_id AND t.category_id = %s)
            FROM dishes d
            WHERE d.category_id = %s
            ORDER BY d.id
            """,
            (to_qid, from_qid),
        )
        for dish_id, restaurant_id, media, reviews, merge_into in pg_conn.cursor.fetchall():
            affected.append({
                "dish_id": str(dish_id),
                "restaurant_id": str(restaurant_id),
                "from_qid": from_qid,
                "to_qid": to_qid,
                "label_ja": label_ja,
                "media": media,
                "reviews": reviews,
                "merge_into": str(merge_into) if merge_into else None,
            })
    return affected


def summarize(affected: List[Dict]) -> None:
    """影響範囲を人間が読める形でログへ出す"""
    if not affected:
        logger.info("付け替え対象の dishes はありません")
        return

    by_pair: Dict[str, Dict[str, int]] = {}
    for a in affected:
        key = f"{a['from_qid']} -> {a['to_qid']} ('{a['label_ja']}')"
        agg = by_pair.setdefault(key, {"dishes": 0, "media": 0, "reviews": 0, "merges": 0})
        agg["dishes"] += 1
        agg["media"] += a["media"]
        agg["reviews"] += a["reviews"]
        agg["merges"] += 1 if a["merge_into"] else 0

    logger.info("-" * 80)
    logger.info("影響範囲")
    for key, agg in sorted(by_pair.items()):
        logger.info(
            f"  {key}: dishes={agg['dishes']}, media={agg['media']}, "
            f"reviews={agg['reviews']}, UNIQUE衝突（統合が要る）={agg['merges']}"
        )
    total_merges = sum(1 for a in affected if a["merge_into"])
    logger.info(
        f"  合計: dishes={len(affected)}, UNIQUE衝突={total_merges}"
    )
    logger.info("-" * 80)


def apply_remap(pg_conn: PostgreSQLConnection, affected: List[Dict]) -> Dict[str, int]:
    """
    付け替えを 1 トランザクションで適用する。

    衝突が無ければ `dishes.category_id` を UPDATE するだけ。
    衝突があれば子を既存 dish へ移してから、空になった dish を削除する。

    Args:
        pg_conn: PostgreSQL 接続
        affected: collect_affected の結果

    Returns:
        {"updated": n, "merged": n, "moved_media": n, "moved_reviews": n}
    """
    counts = {"updated": 0, "merged": 0, "moved_media": 0, "moved_reviews": 0}
    try:
        pg_conn.cursor.execute("BEGIN")
        for a in affected:
            if a["merge_into"]:
                # 同じ店に付け替え先が既にある。子を寄せてから空の dish を消す
                pg_conn.cursor.execute(
                    "UPDATE dish_media SET dish_id = %s WHERE dish_id = %s",
                    (a["merge_into"], a["dish_id"]),
                )
                counts["moved_media"] += pg_conn.cursor.rowcount
                pg_conn.cursor.execute(
                    "UPDATE dish_reviews SET dish_id = %s WHERE dish_id = %s",
                    (a["merge_into"], a["dish_id"]),
                )
                counts["moved_reviews"] += pg_conn.cursor.rowcount
                pg_conn.cursor.execute("DELETE FROM dishes WHERE id = %s", (a["dish_id"],))
                counts["merged"] += 1
            else:
                pg_conn.cursor.execute(
                    "UPDATE dishes SET category_id = %s, updated_at = now() WHERE id = %s",
                    (a["to_qid"], a["dish_id"]),
                )
                counts["updated"] += pg_conn.cursor.rowcount
        pg_conn.conn.commit()
        return counts
    except Exception:
        pg_conn.conn.rollback()
        raise


def write_report(affected: List[Dict], output_dir: str, dry_run: bool) -> str:
    """
    ロールバックに使える «付け替えた dish の一覧» をファイルへ残す。

    Args:
        affected: 対象の一覧
        output_dir: 出力先ディレクトリ
        dry_run: ドライランか

    Returns:
        書き出したファイルのパス
    """
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    mode = "dryrun" if dry_run else "applied"
    path = f"{output_dir}/remap_dish_categories_{mode}_{timestamp}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(affected, f, ensure_ascii=False, indent=2)
    logger.info(f"Report written: {path}")

    # ⚠️ GitHub Actions から流すとこのファイルは run の終了で消える。
    #    ロールバックに要る «どの dish を どの QID から動かしたか» は
    #    標準出力にも出しておく（Job Summary に残るのはこちらだけ）。
    if affected:
        logger.info("ロールバック用の一覧（dish_id, 元の category_id, 付け替え先, 統合先）:")
        for a in affected:
            logger.info(
                f"  {a['dish_id']}\t{a['from_qid']}\t{a['to_qid']}\t"
                f"{a['merge_into'] or '-'}"
            )

    return path


def main():
    parser = argparse.ArgumentParser(
        description="#1748 検索に出ないカテゴリで保存された dishes を、"
                    "同じ日本語ラベルの検索に出るカテゴリへ付け替える"
    )
    parser.add_argument('--schema', required=True, choices=['public', 'dev'],
                        help='PostgreSQL schema (public または dev)')
    parser.add_argument('--dry-run', action='store_true',
                        help='読み取りのみ。件数と UNIQUE 衝突を出して終わる')
    parser.add_argument('--output-dir', default='/tmp',
                        help='レポートの出力先ディレクトリ')
    parser.add_argument('--yes', action='store_true',
                        help='--schema public の対話確認をスキップする。'
                             'GitHub Actions のような非対話環境では必須'
                             '（input() が EOFError になるため）。dev では効果なし')

    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        sys.exit(1)

    logger.info("=" * 80)
    logger.info("#1748 Remap dishes.category_id to searchable categories")
    logger.info("=" * 80)
    logger.info(f"Schema: {args.schema}")
    logger.info(f"Dry-run: {args.dry_run}")
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")

    pg_conn = PostgreSQLConnection(database_url, args.schema)
    if not pg_conn.validate_schema(require_confirmation=not args.yes):
        sys.exit(1)

    loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)

    try:
        pg_conn.connect()

        pairs = build_remap_pairs(loader)
        pairs = filter_pairs_by_pg_categories(pg_conn, pairs)
        if not pairs:
            logger.info("付け替え対象の組み合わせがありません。終了します")
            return

        affected = collect_affected(pg_conn, pairs)
        summarize(affected)
        write_report(affected, args.output_dir, args.dry_run)

        if args.dry_run:
            logger.info("[DRY-RUN] 変更は行いません")
            return

        if not affected:
            logger.info("付け替える行がないので、バックアップも取らずに終了します")
            return

        # 本実行の前に必ずバックアップを取る。取れなければ実行しない
        backup_path = backup_table_to_gcs(pg_conn, "dishes", args.dry_run)
        if not backup_path:
            raise RuntimeError("Backup failed; aborting remap for safety.")
        logger.info(f"✅ Backup completed: {backup_path}")

        counts = apply_remap(pg_conn, affected)
        logger.info(
            f"✅ Remap done - updated: {counts['updated']}, merged: {counts['merged']}, "
            f"moved_media: {counts['moved_media']}, moved_reviews: {counts['moved_reviews']}"
        )

    except Exception as e:
        logger.error(f"❌ Failed: {e}")
        sys.exit(1)
    finally:
        pg_conn.close()


if __name__ == "__main__":
    main()
