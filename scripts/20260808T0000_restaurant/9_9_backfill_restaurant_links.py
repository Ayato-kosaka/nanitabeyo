#!/usr/bin/env python3
"""本番投入で取りこぼした restaurant_links を、後から埋め直す。#1706

## なぜ要るか — 何が起きたか

2026-09-02 の本番投入（`--commit-every-chunks 10`）で、**新規に入った
547,941 店の電話・公式サイト・SNS が 1 本も入らなかった**。
`9_9_audit_column_coverage.py --schema public` の実測で、pipeline 側の
リンク保有率が全 kind で 0.0% だったことから判明した。

原因は 9_1 のリンク投入が `r.source_row_hash` を見ていたこと。この文より
前に走る «新規 INSERT» が、入れたばかりの行へ `source_row_hash = s.row_hash`
を既に書いているため、新規行は必ず «変化なし» と判定されて弾かれていた
（アプリ製の行は `source_row_hash` が NULL のまま入るので、そちらだけ
リンクが付き、合計 184,430 本という数字は «入っている» ように見えた）。
9_1 側は修正済み（比較相手を作業表の `pg_row_hash` へ変更）。

## なぜ 9_1 を流し直すだけでは直らないか

同期は冪等で、**作業表は «やることがある行» しか集めない**。投入後の本番は
`source_row_hash` が catalog と一致しているので、流し直しても作業表は
ほぼ空になり、リンクは 1 本も入らない。**取りこぼしを埋めるには、
«リンクを持っていない行» を対象にした別の入口が要る。**

## 何をするか

  1. catalog を BigQuery から取り出して staging へ載せる（9_1 と同じ）
  2. **open_data 由来のリンクを 1 本も持たない pipeline の行**だけを作業表に集める
  3. 回に分けて、9_1 と **同じ INSERT 文**でリンクを入れ、回ごとに commit する

**リンクを «消す» 処理は持たない。** 対象は 1 本も持っていない行なので
消すものが無く、DELETE を持たなければ «消してはいけないものを消す» 事故も
起きない。ユーザー・オーナーが足したリンク（source <> 'open_data'）は
そもそも対象外である。

投入する SQL は 9_1 の `LINK_INSERT_SQL` を **import して使う**（写経しない）。

  python3 9_9_backfill_restaurant_links.py --run-id <run_id> --schema public \\
      --allow-public --chunks 10
"""

from __future__ import annotations

import argparse
import importlib.util
import logging
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pg_sync_common import (  # noqa: E402
    check_db_pressure,
    connect_postgres,
    log_db_load,
)
from pipeline_common import BigQueryPipeline, configure_logging, require_run_id  # noqa: E402

LOGGER = logging.getLogger(__name__)

# 共有 DB なので、9_1 と同じ上限で自分から降りる。
TIME_BUDGET_SECONDS = 20 * 60


def load_9_1() -> Any:
    """9_1 をモジュールとして読み込む（先頭が数字なので import 文では書けない）。"""

    path = Path(__file__).resolve().parent / "9_1_sync_restaurants.py"
    spec = importlib.util.spec_from_file_location("sync_restaurants", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"9_1 を読み込めませんでした: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="取りこぼした restaurant_links を埋め直します"
    )
    parser.add_argument("--run-id")
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument("--allow-public", action="store_true")
    parser.add_argument(
        "--chunks",
        type=int,
        default=10,
        help="作業表を何回に分けて commit するか（既定 10）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="対象件数を数えるだけで、1 行も書かない",
    )
    return parser.parse_args()


def build_target_table(connection: Any) -> int:
    """**open_data のリンクを 1 本も持たない pipeline の行**を作業表に集める。

    `pg_row_hash` を NULL で持たせるのは小細工ではない。9_1 のリンク投入は
    «書き込み前のリンクの状態» と catalog を比べる文で、ここでの «書き込み前»
    は文字どおり «1 本も無い» である。NULL はそれを正しく表す
    （`NULL IS DISTINCT FROM s.row_hash` は常に真なので、全対象が入る）。
    """

    with connection.cursor() as cursor:
        started = time.monotonic()
        cursor.execute(
            """
            CREATE TEMP TABLE restaurant_link_backfill_all AS
            SELECT s.*, r.id AS pg_id, NULL::text AS pg_row_hash
            FROM restaurant_sync_staging s
            JOIN restaurants r ON r.google_place_id = s.google_place_id
            WHERE r.created_by_source = 'pipeline'
              -- 既に持っている行は対象外。冪等にするための条件でもある。
              AND NOT EXISTS (
                SELECT 1 FROM restaurant_links l
                WHERE l.restaurant_id = r.id AND l.source = 'open_data'
              )
              -- 入れるものが 1 つも無い店を作業表へ入れても、回が空回りするだけ。
              AND (
                   NULLIF(btrim(COALESCE(s.phone, '')), '') IS NOT NULL
                OR NULLIF(btrim(COALESCE(s.website, '')), '') IS NOT NULL
                OR jsonb_array_length(s.social_urls_json::jsonb) > 0
              )
            """
        )
        rows = cursor.rowcount
        cursor.execute(
            "CREATE INDEX ON restaurant_link_backfill_all (google_place_id)"
        )
        cursor.execute("ANALYZE restaurant_link_backfill_all")
        LOGGER.info(
            "  %-28s %6.1f秒 / %d行", "対象の抽出", time.monotonic() - started, rows
        )
    return rows


def materialize_chunk(connection: Any, chunk: int, chunks: int) -> int:
    """この回で処理する分を `restaurant_sync_work` という名前で切り出す。

    名前を 9_1 に合わせるのは、`LINK_INSERT_SQL` を 1 文字も変えずに使うため。
    """

    with connection.cursor() as cursor:
        cursor.execute("DROP TABLE IF EXISTS restaurant_sync_work")
        if chunks <= 1:
            cursor.execute(
                "CREATE TEMP TABLE restaurant_sync_work AS "
                "SELECT * FROM restaurant_link_backfill_all"
            )
        else:
            cursor.execute(
                """
                CREATE TEMP TABLE restaurant_sync_work AS
                SELECT * FROM restaurant_link_backfill_all
                WHERE abs(hashtext(google_place_id)) %% %s = %s
                """,
                (chunks, chunk),
            )
        rows = cursor.rowcount
        cursor.execute("CREATE INDEX ON restaurant_sync_work (google_place_id)")
        cursor.execute("ANALYZE restaurant_sync_work")
    return rows


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    sync = load_9_1()

    pipeline = BigQueryPipeline()
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as stream:
        staging_path = Path(stream.name)

    connection = None
    try:
        exported = sync.export_catalog(pipeline, run_id, staging_path)
        if exported == 0:
            raise RuntimeError("restaurant_catalogが0件です")
        connection = connect_postgres(args.schema, allow_public=args.allow_public)
        staging_rows = sync.load_staging(connection, staging_path)
        LOGGER.info("staging: %s 行", f"{staging_rows:,}")

        log_db_load(connection, "対象の抽出前")
        targets = build_target_table(connection)
        LOGGER.info("リンクを 1 本も持たない pipeline の行: %s 件", f"{targets:,}")
        if targets == 0:
            LOGGER.info("✅ 埋めるものはありません（取りこぼしなし）")
            connection.rollback()
            return
        if args.dry_run:
            LOGGER.info("dry-run のため、ここで終了します（1 行も書いていません）")
            connection.rollback()
            return

        chunks = max(args.chunks, 1)
        with connection.cursor() as cursor:
            # 回ごとに commit するので、トランザクション単位の lock では外れる。
            cursor.execute(
                "SELECT pg_advisory_lock(hashtext(%s))",
                (f"restaurant_link_backfill:{id(connection)}",),
            )
        connection.commit()

        started = time.monotonic()
        inserted_total = 0
        for chunk in range(chunks):
            spent = time.monotonic() - started
            if spent >= TIME_BUDGET_SECONDS:
                raise RuntimeError(
                    f"{spent / 60:.1f} 分を超えました（上限 "
                    f"{TIME_BUDGET_SECONDS / 60:.0f} 分）。共有 DB なのでここで"
                    "降ります。済んだ回は commit 済みで、流し直せば残りだけが"
                    "対象になります（#1706）"
                )
            rows = materialize_chunk(connection, chunk, chunks)
            LOGGER.info("── %d/%d 回目（対象 %s 行）", chunk + 1, chunks, f"{rows:,}")
            if rows == 0:
                connection.commit()
                continue
            with connection.cursor() as cursor:
                t0 = time.monotonic()
                cursor.execute(sync.LINK_INSERT_SQL)
                inserted = cursor.rowcount
                inserted_total += inserted
                LOGGER.info(
                    "  %-28s %6.1f秒 / %d行",
                    "リンク投入", time.monotonic() - t0, inserted,
                )
            connection.commit()
            LOGGER.info(
                "── %d/%d 回目を commit（経過 %.1f分）",
                chunk + 1, chunks, (time.monotonic() - started) / 60,
            )
            harmful, reason = check_db_pressure(connection)
            if harmful:
                raise RuntimeError(
                    f"{reason}。{chunk + 1}/{chunks} 回目まで commit 済みです。"
                    "空いている時間帯に流し直してください（冪等なので、済んだ分は"
                    "次回の対象に入りません）"
                )

        log_db_load(connection, "投入後")
        LOGGER.info("✅ リンクを %s 本入れました", f"{inserted_total:,}")
    except Exception:
        if connection:
            connection.rollback()
        raise
    finally:
        if connection:
            connection.close()
        staging_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
