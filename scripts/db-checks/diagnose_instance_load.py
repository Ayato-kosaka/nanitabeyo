#!/usr/bin/env python3
"""インスタンス全体の «いま誰が重いか» と «累計で何が重かったか» を読み取り専用で採る（#2006）。

## なぜ diagnose_slow_db.py と別に要るのか

`diagnose_slow_db.py` は «推薦クエリが遅いのは dev の DB か アプリか» を切り分けるための
道具で、対象テーブルが allowlist で固定され、`public` を明示的に拒否する。

#2006 で要るのは逆向きの問いである。

- 本番（`public`）の `/v1/dish-media/search` が 09-21 から p95 1.7 秒 → 31 秒になった
- Supabase のインスタンスは dev と本番で **共有**である
- 同じ 2 日間に、別ブランチの `db-script-run` が **85 本**、うち複数が 5〜6 時間並走していた

つまり «本番のクエリ自体» ではなく «同じインスタンスに同居している他人» を疑う必要があり、
見る対象はスキーマ横断・インスタンス全体になる。

## 一度きりのスナップショットで終わらせない

`pg_stat_activity` は **いまこの瞬間** しか映さない。09-21 に何が走っていたかは出てこない。
そこを埋めるのが `pg_stat_statements` で、こちらは **stats_reset からの累計**なので
「この 2 日で延べ何秒 CPU を使ったのが誰か」を後追いで言える。両方を採る。

  - 2 章（pg_stat_activity）… いま誰が重いか。障害の最中に走らせる用
  - 5 章（pg_stat_statements）… 累計で誰が重かったか。障害が去った後でも読める

## 読み取り専用である

**SELECT と SHOW しか実行しない。** DDL / DML / ANALYZE / pg_stat_statements_reset() は
一切呼ばない（reset すると他の調査の累計まで消える）。
接続は `read_only` に落とし、1 文でも 15 秒を超えたらこちらが落ちる
（相手は本番と共有のインスタンスなので、診断が追い打ちをかけることは許されない）。

クエリ文は **引用符で囲まれたリテラルを `?` へ潰してから**表示する。
他スキーマのクエリも読むため、万一値が直書きされていても持ち出さない。

## 使い方

    python scripts/db-checks/diagnose_instance_load.py
    python scripts/db-checks/diagnose_instance_load.py --growth-table restaurants

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

import argparse
import logging
import os
import sys

import psycopg2

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

# 表示前にクエリ文から値を落とすための置換。
# 他スキーマ（dev / 他セッションの seed スクリプト）のクエリも読むので、
# «SELECT しか書いていない» ではなく «値を表示しない» 側で担保する
MASK_LITERALS = r"regexp_replace(regexp_replace({col}, '''[^'']*''', '''?''', 'g'), '\s+', ' ', 'g')"


def section(title: str) -> None:
    logger.info("\n%s", "=" * 78)
    logger.info("# %s", title)
    logger.info("%s", "=" * 78)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--growth-table",
        default="restaurants",
        choices=("restaurants", "dish_media", "dishes", "none"),
        help="created_at の日別ヒストグラムを採るテーブル（allowlist）",
    )
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    with psycopg2.connect(database_url) as conn:
        try:
            conn.set_session(readonly=True, autocommit=True)
            logger.info("接続を read-only / autocommit に設定しました")
        except psycopg2.Error as exc:
            logger.warning("read-only 設定に失敗（SELECT のみのため続行）: %s", exc)

        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '15s'")

            # ── 1. 素の応答速度 ──────────────────────────────────────────
            section("1. 素の応答速度（いまインスタンスが重いか）")
            import time as _t
            for label, sql in (("SELECT 1", "SELECT 1"), ("now()", "SELECT now()")):
                t0 = _t.perf_counter()
                cur.execute(sql)
                cur.fetchall()
                logger.info("  %-12s %8.1f ms", label, (_t.perf_counter() - t0) * 1000)

            # ── 2. いま走っているもの（インスタンス全体・長い順）─────────
            section("2. 実行中のクエリ（idle 以外・長い順・インスタンス全体）")
            cur.execute(
                f"""
                SELECT
                  pid,
                  coalesce(usename, '(none)'),
                  coalesce(application_name, '-'),
                  state,
                  coalesce(wait_event_type || '/' || wait_event, '-'),
                  round(EXTRACT(EPOCH FROM (now() - query_start))::numeric, 1),
                  left({MASK_LITERALS.format(col='query')}, 150)
                FROM pg_stat_activity
                WHERE state <> 'idle' AND pid <> pg_backend_pid()
                ORDER BY 6 DESC NULLS LAST
                LIMIT 20
                """
            )
            rows = cur.fetchall()
            if not rows:
                logger.info("  (実行中のクエリなし)")
            for pid, user, app, state, wait, sec, head in rows:
                logger.info("  pid=%-8s %-12s %-16s %-9s wait=%-20s %8s s", pid, user, app, state, wait, sec)
                logger.info("      %s", head)

            # ── 3. 接続の内訳 ────────────────────────────────────────────
            section("3. 接続数（インスタンス全体）")
            cur.execute("SHOW max_connections")
            logger.info("  max_connections: %s", cur.fetchone()[0])
            cur.execute("SELECT count(*) FROM pg_stat_activity")
            logger.info("  現在の接続数  : %s", cur.fetchone()[0])
            cur.execute(
                """
                SELECT coalesce(usename, '(none)'), coalesce(application_name, '-'),
                       coalesce(state, '-'), count(*)
                FROM pg_stat_activity GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 15
                """
            )
            for user, app, state, n in cur.fetchall():
                logger.info("  %-20s %-18s %-20s %4d", user, app, state, n)

            # ── 4. キャッシュに当たっているか ────────────────────────────
            # ⚠️ ここが #2006 の本丸である。
            # explain_dish_media_search.py の実測では、同じクエリが
            # **初回 1,439ms / 2 回目以降 15ms** だった（約 90 倍）。
            # つまり «プランが崩れる» のではなく «キャッシュから落ちる» だけで
            # 桁が変わる形をしている。重い同居プロセスが shared_buffers を
            # 洗い流していれば、本番の重いクエリだけが毎回ディスクを叩く
            section("4. キャッシュ命中率とディスク読み（DB 単位・累計）")
            cur.execute(
                """
                SELECT datname, blks_hit, blks_read,
                       CASE WHEN blks_hit + blks_read = 0 THEN NULL
                            ELSE round(100.0 * blks_hit / (blks_hit + blks_read), 2) END,
                       round(blk_read_time::numeric / 1000, 1),
                       round(blk_write_time::numeric / 1000, 1),
                       pg_size_pretty(temp_bytes), temp_files, deadlocks, stats_reset
                FROM pg_stat_database
                WHERE datname IS NOT NULL AND blks_hit + blks_read > 0
                ORDER BY blks_read DESC LIMIT 8
                """
            )
            logger.info("  %-14s %12s %12s %8s %10s %10s", "db", "blks_hit", "blks_read", "hit%", "read待ち", "temp")
            for db, hit, read, pct, rt, wt, temp, tfiles, dl, reset in cur.fetchall():
                logger.info("  %-14s %12s %12s %7s%% %9ss %10s", db, hit, read, pct, rt, temp)
                logger.info("      temp_files=%s deadlocks=%s stats_reset=%s", tfiles, dl, reset)
            cur.execute("SHOW track_io_timing")
            logger.info("  track_io_timing: %s  ← off なら «read待ち» は 0 のまま（値が無いだけ）", cur.fetchone()[0])
            for setting in ("shared_buffers", "effective_cache_size", "work_mem", "max_parallel_workers"):
                cur.execute(f"SHOW {setting}")
                logger.info("  %-22s %s", setting, cur.fetchone()[0])

            # ── 5. 累計で誰が重かったか（後追いできる唯一の材料）─────────
            section("5. pg_stat_statements（stats_reset からの累計）")
            cur.execute(
                "SELECT count(*) FROM pg_extension WHERE extname = 'pg_stat_statements'"
            )
            if cur.fetchone()[0] == 0:
                logger.info("  ⚠️ pg_stat_statements が入っていません。")
                logger.info("     → «過去に何が重かったか» は DB 側からは追えない（今この瞬間しか見えない）")
            else:
                for label, order_col in (
                    ("延べ実行時間が長い順（＝インスタンスを占有したもの）", "total_exec_time"),
                    ("ディスクから読んだブロックが多い順（＝キャッシュを洗い流したもの）", "shared_blks_read"),
                ):
                    logger.info("\n  ## %s", label)
                    try:
                        cur.execute(
                            f"""
                            SELECT calls,
                                   round((total_exec_time / 1000)::numeric, 1),
                                   round(mean_exec_time::numeric, 1),
                                   round(max_exec_time::numeric, 1),
                                   shared_blks_read, shared_blks_hit,
                                   left({MASK_LITERALS.format(col='query')}, 130)
                            FROM pg_stat_statements
                            ORDER BY {order_col} DESC LIMIT 12
                            """
                        )
                    except psycopg2.Error as exc:
                        logger.info("  読めません: %s", exc)
                        break
                    logger.info("  %8s %10s %9s %9s %12s", "calls", "延べ秒", "平均ms", "最大ms", "disk読")
                    for calls, total_s, mean_ms, max_ms, blk_read, blk_hit, q in cur.fetchall():
                        logger.info("  %8s %10s %9s %9s %12s", calls, total_s, mean_ms, max_ms, blk_read)
                        logger.info("      %s", q)

            # ── 6. 肥大しているテーブル（インスタンス全体）───────────────
            section("6. 大きいテーブル（スキーマ横断・上位 15）")
            cur.execute(
                """
                SELECT schemaname, relname, n_live_tup, n_dead_tup, n_tup_ins,
                       pg_size_pretty(pg_total_relation_size(relid)),
                       last_autovacuum, last_autoanalyze
                FROM pg_stat_user_tables
                ORDER BY pg_total_relation_size(relid) DESC LIMIT 15
                """
            )
            for sch, rel, live, dead, ins, size, vac, ana in cur.fetchall():
                logger.info("  %-8s %-30s live=%-10s dead=%-9s %10s", sch, rel, live, dead, size)
                logger.info("      n_tup_ins(累計)=%s last_autovacuum=%s last_autoanalyze=%s", ins, vac, ana)

            # ── 7. いつ積まれたか ────────────────────────────────────────
            # «09-21 に何かが変わった» の «何か» がデータ量なら、ここに段差が出る
            if args.growth_table != "none":
                section(f"7. {args.growth_table} が積まれた日（public / 直近 21 日）")
                try:
                    cur.execute(
                        f"""
                        SELECT date_trunc('day', created_at)::date, count(*)
                        FROM public.{args.growth_table}
                        WHERE created_at >= now() - interval '21 days'
                        GROUP BY 1 ORDER BY 1
                        """
                    )
                    rows = cur.fetchall()
                    if not rows:
                        logger.info("  直近 21 日に積まれた行はありません（＝この期間の増加が原因ではない）")
                    for day, n in rows:
                        logger.info("  %s  %8s 件  %s", day, n, "▇" * min(60, n // 2000))
                except psycopg2.Error as exc:
                    logger.info("  読めません: %s", exc)

    logger.info("\n✅ 読み取りのみ完了（DDL / DML / ANALYZE / reset は 1 つも実行していません）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
