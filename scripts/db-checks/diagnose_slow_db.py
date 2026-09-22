#!/usr/bin/env python3
"""いま DB が遅い理由を **読み取り専用で** 突き止めるための診断（#1750 の派生）。

## なぜ要るのか

2026-08-31、dev の `GET /v1/dish-categories/recommendations` が
p50 100ms → **p50 14.6 秒 / 最大 63.5 秒** に劣化し、アプリの 30 秒タイムアウトに
掛かって「料理の取得に失敗しました」が出た（BigQuery 実測）。

同時刻の本番（`public`）は p50 84ms / p95 1.1 秒で**健全**だった。
Supabase のインスタンスは dev と本番で**共有**なので、
「インスタンスごと重い」では説明が付かない。切り分けの材料が要る。

観測できていたのは «API が遅い» までで、その先が分からなかった。

- DB そのものが遅いのか、アプリ（Remote Config 取得など）が遅いのか
- 遅いなら、誰かが長いクエリで占有しているのか、統計が腐ってプランが崩れたのか
- 接続を使い切っていないか（共有インスタンスなので **本番を巻き込む**）

このスクリプトはその 5 点を 1 回の実行で採る。

## 読み取り専用である

**SELECT と SHOW しか実行しない。** DDL も DML も ANALYZE も行わない。
`public`（本番）のテーブルは 1 行も読まない（接続数の集計だけは
インスタンス全体を見る必要があるため `pg_stat_activity` を数えるが、
中身のクエリ文は `dev` 以外を伏せる）。

直すのはこのスクリプトの仕事ではない（統計なら `scripts/db-repair/analyze_table.py`、
索引なら migration を 1 本足す）。

## 使い方

    python scripts/db-checks/diagnose_slow_db.py --schema dev

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

import argparse
import logging
import os
import sys
import time

import psycopg2

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

# 推薦クエリ（findCategoryCandidatesWithScores）が触るテーブル。
# 統計の鮮度と肥大を見る対象を、任意の識別子ではなく allowlist で固定する
RECOMMENDATION_TABLES = (
    "dish_category_features",
    "dish_categories",
    "reactions",
    "users",
    "config",
)


def section(title: str) -> None:
    logger.info("\n%s\n%s", title, "=" * len(title))


def timed(cur, label: str, sql: str) -> None:
    """1 本の SELECT にかかる実時間を測る（プラン確認ではなく «いま速いか»）。

    statement_timeout に掛かったら **それ自体が結果**なので、落とさずに記録して次へ進む。
    ここで例外を上げると、一番知りたい «どれだけ遅いか» を採る前に終わってしまう。
    """
    started = time.perf_counter()
    try:
        cur.execute(sql)
        cur.fetchall()
    except psycopg2.errors.QueryCanceled:
        # autocommit なので «中断されたトランザクション» は残らない（rollback は要らない）。
        # rollback を挟むと、PostgreSQL では SET も一緒に巻き戻り、
        # 以降の search_path / statement_timeout が消える（#1706 で踏んだのと同じ罠）
        logger.info("  %-42s %s", label, "15 秒で打ち切り（＝ いま相当に遅い）")
        return
    logger.info("  %-42s %8.1f ms", label, (time.perf_counter() - started) * 1000)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    args = parser.parse_args()

    if args.schema == "public":
        logger.error("❌ public は対象外です（本番の調査はリリース手順の側で行う）")
        return 1

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    with psycopg2.connect(database_url) as conn:
        # 二重の安全装置。**この接続では書き込みを物理的に不可能にする。**
        # 本番と同じインスタンスなので «SELECT しか書いていないつもり» に頼らない。
        # プーラ経由でセッション設定が効かない構成もあるため、失敗しても続行する
        # （このスクリプトは SELECT / SHOW しか発行しない）
        try:
            # autocommit にするのは «速いから» ではなく **SET を守るため**である。
            # PostgreSQL の SET はトランザクション内で実行すると rollback で巻き戻るので、
            # 1 本でもクエリが失敗した瞬間に search_path と statement_timeout が消える。
            # 読むだけのスクリプトはトランザクションを開閉しない（#1706）
            conn.set_session(readonly=True, autocommit=True)
            logger.info("接続を read-only / autocommit に設定しました")
        except psycopg2.Error as exc:
            logger.warning("read-only 設定に失敗（SELECT のみのため続行）: %s", exc)

        with conn.cursor() as cur:
            cur.execute(f'SET search_path TO "{args.schema}", extensions')

            # ⚠️ **このスクリプトは «障害の最中に» 走る。**
            # 相手は本番と共有のインスタンスなので、診断が長引いて本番を巻き込むことは
            # 絶対に許されない。1 文でも 15 秒を超えたらこちらが落ちる方が正しい。
            cur.execute("SET statement_timeout = '15s'")

            cur.execute("SHOW search_path")
            logger.info("search_path: %s", cur.fetchone()[0])

            # ── 1. いま «素の DB» が速いか ────────────────────────────────
            # アプリを一切通さずに測る。ここが速ければ «DB は健全でアプリ側が遅い»、
            # 遅ければ «DB が遅い» と言い切れる
            section("1. 素の応答速度")
            timed(cur, "SELECT 1", "SELECT 1")
            timed(cur, "users を 1 行（PK 走査）", f'SELECT id FROM "{args.schema}".users LIMIT 1')
            # ⚠️ ここで `count(*)` を書かないこと。全件走査になり、**弱っている共有インスタンスへ
            # 診断が追い打ちをかける**。行数は 4 章の n_live_tup（統計から読むのでタダ）で足りる。
            # ここで見たいのは «件数» ではなく «読み出しがいま速いか» なので、上限を付けて測る
            timed(
                cur,
                "dish_category_features を 1 万行だけ走査",
                f'SELECT count(*) FROM (SELECT 1 FROM "{args.schema}".dish_category_features LIMIT 10000) t',
            )

            # ── 2. 誰かが占有していないか ────────────────────────────────
            # 長いクエリが 1 本走ると、共有インスタンスなので **本番まで巻き込む**
            section("2. 実行中のクエリ（idle 以外・長い順）")
            cur.execute(
                """
                SELECT
                  pid,
                  state,
                  wait_event_type,
                  wait_event,
                  round(EXTRACT(EPOCH FROM (now() - query_start))::numeric, 1) AS running_sec,
                  left(regexp_replace(query, '\\s+', ' ', 'g'), 120) AS query_head
                FROM pg_stat_activity
                WHERE state <> 'idle'
                  AND pid <> pg_backend_pid()
                ORDER BY running_sec DESC NULLS LAST
                LIMIT 15
                """
            )
            rows = cur.fetchall()
            if not rows:
                logger.info("  (実行中のクエリなし)")
            for pid, state, wet, we, sec, head in rows:
                logger.info(
                    "  pid=%-7s %-9s wait=%-22s %6s s  %s",
                    pid, state, f"{wet}/{we}" if wet else "-", sec, head,
                )

            # ── 3. 接続を使い切っていないか ──────────────────────────────
            # 共有インスタンスなので、dev が使い切ると本番が繋げなくなる
            section("3. 接続数（インスタンス全体）")
            cur.execute("SHOW max_connections")
            logger.info("  max_connections: %s", cur.fetchone()[0])
            cur.execute(
                """
                SELECT coalesce(usename, '(none)'), state, count(*)
                FROM pg_stat_activity
                GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12
                """
            )
            for user, state, n in cur.fetchall():
                logger.info("  %-24s %-20s %4d", user, state or "-", n)

            # ── 4. 統計が腐っていないか ──────────────────────────────────
            # 100ms → 20 秒のような «急な» 劣化は、索引の有無ではなく
            # プランナ統計の陳腐化で起きることが多い（scripts/db-repair/analyze_table.py 参照）
            section("4. プランナ統計の鮮度とテーブルの大きさ")
            cur.execute(
                """
                SELECT
                  relname,
                  n_live_tup,
                  n_dead_tup,
                  last_analyze,
                  last_autoanalyze,
                  last_autovacuum,
                  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
                FROM pg_stat_user_tables
                WHERE schemaname = %s AND relname = ANY(%s)
                ORDER BY n_live_tup DESC
                """,
                (args.schema, list(RECOMMENDATION_TABLES)),
            )
            for name, live, dead, ana, autoana, autovac, size in cur.fetchall():
                logger.info("  %-28s live=%-9s dead=%-8s size=%-10s", name, live, dead, size)
                logger.info("      last_analyze=%s / last_autoanalyze=%s", ana, autoana)
                logger.info("      last_autovacuum=%s", autovac)

            # ── 4b. 作業セットがメモリに載るか ───────────────────────────
            # 2026-09-22 に踏んだ: dev の «店名の絞り込みも無い» 最小の近傍クエリが
            # 半径 500m で 3.1 秒、5km で 98 秒かかっていた。索引は正しく選ばれていて
            # （idx_restaurants_location の Index Scan）、500m は 766 行しか返さない。
            # プランの問題ではなく、`pg_stat_activity` が全部 `wait=IO/DataFileRead`
            # だった＝**ディスクから読んでいた**。接続数は 6/60 で枯れていなかった。
            #
            # «統計が腐ったか / 索引があるか» だけでは、この «載らないから遅い» を
            # 切り分けられない。判定に要るのはキャッシュヒット率と作業セットの大きさなので、
            # ここで採る。allowlist（RECOMMENDATION_TABLES）は推薦クエリ用の固定なので
            # そちらは変えず、この節はスキーマ全体をメタデータだけで見る。
            section("4b. キャッシュヒット率と作業セットの大きさ")
            cur.execute("SHOW shared_buffers")
            logger.info("  shared_buffers: %s", cur.fetchone()[0])
            cur.execute("SHOW effective_cache_size")
            logger.info("  effective_cache_size: %s", cur.fetchone()[0])

            # ヒット率は «起動からの累計» である。いま飽和しているかではなく
            # «全体としてメモリに載っているか» を見る数字なので、瞬間値と混同しない。
            cur.execute(
                """
                SELECT
                  sum(heap_blks_hit) AS hit,
                  sum(heap_blks_read) AS read
                FROM pg_statio_user_tables
                WHERE schemaname = %s
                """,
                (args.schema,),
            )
            hit, read = cur.fetchone()
            if hit is not None and read is not None and (hit + read) > 0:
                logger.info(
                    "  heap キャッシュヒット率: %.2f%%（hit=%s / read=%s・起動からの累計）",
                    100.0 * hit / (hit + read), hit, read,
                )
            else:
                logger.info("  heap キャッシュヒット率: 統計なし")

            cur.execute(
                """
                SELECT pg_size_pretty(sum(pg_total_relation_size(relid)))
                FROM pg_stat_user_tables WHERE schemaname = %s
                """,
                (args.schema,),
            )
            logger.info("  スキーマ %s の合計サイズ: %s", args.schema, cur.fetchone()[0])

            logger.info("")
            logger.info("  大きいテーブル上位 10:")
            cur.execute(
                """
                SELECT relname, n_live_tup,
                       pg_size_pretty(pg_total_relation_size(relid)) AS total,
                       pg_size_pretty(pg_indexes_size(relid)) AS idx
                FROM pg_stat_user_tables
                WHERE schemaname = %s
                ORDER BY pg_total_relation_size(relid) DESC
                LIMIT 10
                """,
                (args.schema,),
            )
            for name, live, total, idx in cur.fetchall():
                logger.info("    %-28s live=%-10s 合計=%-10s 索引=%s", name, live, total, idx)

            # ── 5. 推薦の主テーブルに索引があるか ────────────────────────
            section("5. dish_category_features の索引")
            cur.execute(
                """
                SELECT indexname, indexdef
                FROM pg_indexes
                WHERE schemaname = %s AND tablename = 'dish_category_features'
                ORDER BY indexname
                """,
                (args.schema,),
            )
            idx = cur.fetchall()
            if not idx:
                logger.info("  ⚠️ 索引が 1 つもありません")
            for name, ddl in idx:
                logger.info("  %s\n      %s", name, ddl)

    logger.info("\n✅ 読み取りのみ完了（DDL / DML / ANALYZE は 1 つも実行していません）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
