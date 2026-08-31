#!/usr/bin/env python3
"""9_1 の同期を **ローカルの PostgreSQL で 62 万行のまま再現**して測る。#1706

## なぜ要るか

2026-08-31、同じ «statement timeout» に 6 回ぶつかり、そのたびに別の真因が
出てきた（staging の索引欠如 → 書き込み過多 → 表の肥大 → クエリプラン →
設計そのもの → 計測の書き間違い）。**6 回とも共有 DB で学んだ**ため、
1 回の学習に 1 時間を使い、途中で本番と dev のアプリを止めた。

**6 回とも、ここで再現できた性質のものだった。** 共有 DB を掴んで 1 時間に
1 回学ぶ代わりに、ここで数分に 1 回学ぶ。

## 何を «同じ» にしてあるか

- **本番の DDL と索引**（migration をそのまま適用する。GIST / GIN trgm / UNIQUE を含む）
- **行数**（既定 62 万行）
- **本番のコード**。SQL を写経せず、9_1 の `load_staging` /
  `build_work_tables` / `calculate_stats` / `apply_sync` を **import して呼ぶ**

## 何が «違う» か（数字を読むときの注意）

- **ハードウェアが違う。** 絶対値は Supabase と一致しない。見るべきは
  «どの文が支配的か» と «前後で何倍になったか» である
- 店名・住所は生成した文字列。trgm 索引の効き方は本物と完全には一致しない

    python3 tests/bench_9_1_local.py                  62 万行で測る
    python3 tests/bench_9_1_local.py --rows 50000     小さく試す
    python3 tests/bench_9_1_local.py --keep           終了後もクラスタを残す
"""

from __future__ import annotations

import argparse
import importlib.util
import logging
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent
REPO = SCRIPTS.parent.parent
MIGRATIONS = REPO / "infra" / "supabase" / "migrations"

sys.path.insert(0, str(SCRIPTS))

LOGGER = logging.getLogger("bench")

# 本番の restaurants を作るのに要る migration を、適用順に並べる。
# **写経しない。** ファイルをそのまま流す。
MIGRATION_FILES = [
    "20250802T0300_create_restaurants.sql",
    "20250903T1030_drop_not_null_plus_code_from_restaurants.sql",
    "20251112T1100_add_image_path_to_restaurants.sql",
    "20260823T0000_add_restaurant_recommendation_sync_metadata.sql",
    "20260824T0300_add_restaurants_name_trgm_index.sql",
    "20260827T0000_add_restaurants_created_by_source.sql",
    "20260828T0000_add_restaurants_address_country_and_links.sql",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="9_1 をローカルで再現して測ります")
    parser.add_argument("--rows", type=int, default=620_000)
    parser.add_argument("--app-rows", type=int, default=2_500, help="アプリ製の行数")
    parser.add_argument("--port", type=int, default=55500)
    parser.add_argument("--pgdata", default="/tmp/pgdata_1706_bench")
    parser.add_argument("--keep", action="store_true", help="終了後もクラスタを残す")
    parser.add_argument(
        "--changed-ratio",
        type=float,
        default=1.0,
        help="出所側が変わっている行の割合。1.0=初回の全件移行、0.005=定常運転",
    )
    return parser.parse_args()


def load_9_1():
    """本番のコードを import する（写経しない）。"""

    spec = importlib.util.spec_from_file_location(
        "sync_9_1", SCRIPTS / "9_1_sync_restaurants.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sh(cmd: str) -> None:
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(
            f"失敗: {cmd}\n--- stdout ---\n{r.stdout}\n--- stderr ---\n{r.stderr}"
        )


def start_cluster(pgdata: str, port: int) -> None:
    pgbin = os.environ.get("PGBIN", "/usr/lib/postgresql/16/bin")
    shutil.rmtree(pgdata, ignore_errors=True)
    Path(pgdata).mkdir(parents=True)
    sh(f"chown postgres:postgres {pgdata}")
    sh(f"su postgres -c '{pgbin}/initdb -D {pgdata} -U postgres --auth=trust'")
    # 共有 DB と同じ土俵にするため、既定のままで動かす。**work_mem は上げない**
    # （2026-08-31 に上げて本番を巻き込んだ。→ CLAUDE.md「共有 DB に負荷を…」§4）。
    sh(f"su postgres -c '{pgbin}/pg_ctl -D {pgdata} -o \"-p {port} -k /tmp\" -l {pgdata}/log start'")
    for _ in range(40):
        try:
            sh(f"psql -h /tmp -p {port} -U postgres -c 'select 1'")
            return
        except subprocess.CalledProcessError:
            time.sleep(0.5)
    raise RuntimeError("PostgreSQL が起動しませんでした")


# 20251112T1100 は dishes / dish_media から image_path を backfill する。
# ベンチには料理が 1 件も無いので backfill は 0 行だが、**表が無いと migration が
# 落ちる**。measurement 対象ではないので、参照される列だけの空表を置く。
# （本番のロジックではないので、ここを写経とは呼ばない）
DEPENDENCY_STUBS = """
CREATE TABLE IF NOT EXISTS dishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dish_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id UUID,
  thumbnail_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def apply_migrations(port: int) -> None:
    sh(f"psql -h /tmp -p {port} -U postgres -q -v ON_ERROR_STOP=1 "
       f"-c 'CREATE SCHEMA IF NOT EXISTS dev; CREATE SCHEMA IF NOT EXISTS extensions;'")
    # 本番は Supabase 側で有効になっている拡張。ここでも同じ索引を作れるようにする。
    # **trgm と PostGIS が無いと «索引の重さ» が再現できない**ので、省略しない。
    for ext in ("pg_trgm", "postgis"):
        sh(f"psql -h /tmp -p {port} -U postgres -q -v ON_ERROR_STOP=1 "
           f'-c \'CREATE EXTENSION IF NOT EXISTS "{ext}" WITH SCHEMA extensions;\'')
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as fh:
        fh.write("SET search_path=dev,extensions,public;\n" + DEPENDENCY_STUBS)
        stub_path = fh.name
    sh(f"psql -h /tmp -p {port} -U postgres -q -v ON_ERROR_STOP=1 -f '{stub_path}'")
    Path(stub_path).unlink(missing_ok=True)
    for name in MIGRATION_FILES:
        path = MIGRATIONS / name
        if not path.exists():
            raise RuntimeError(f"migration が見つかりません: {path}")
        # CONCURRENTLY はトランザクションの外でしか作れない。psql の -f は
        # 既定で自動コミットなので、そのまま流せる。
        sh(f"psql -h /tmp -p {port} -U postgres -q -v ON_ERROR_STOP=1 "
           f"-c 'SET search_path=dev,extensions,public;' -f '{path}'")
    LOGGER.info("migration を %d 本適用しました（本物のファイルをそのまま）", len(MIGRATION_FILES))


def place_id(i: int) -> str:
    return f"ChIJbench{i:012d}"


def seed_id(i: int) -> str:
    return f"{i:08x}-0000-4000-8000-{i:012d}"


def generate_catalog_csv(path: Path, rows: int, changed_ratio: float) -> None:
    """9_1 が BigQuery から書き出すのと同じ列順の CSV を作る。

    列順は 9_1 の `export_catalog` / staging の DDL と揃える必要がある。
    **写経しない**ため、staging の DDL から列名を読んで順番を確かめる。
    """

    rnd = random.Random(20260831)
    with path.open("w", encoding="utf-8") as out:
        for i in range(rows):
            changed = rnd.random() < changed_ratio
            row_hash = f"hash-{i}-{'v2' if changed else 'v1'}"
            lat = 24.0 + rnd.random() * 21.0
            lng = 123.0 + rnd.random() * 23.0
            out.write(
                ",".join(
                    [
                        seed_id(i),
                        place_id(i),
                        "box_unique_strict",
                        f"ベンチ食堂{i}号店",
                        "ja",
                        f"{lat:.6f}",
                        f"{lng:.6f}",
                        "",
                        r"\N",
                        "[]",
                        r"\N",
                        f"東京都ベンチ区{i}-1-1",
                        "JP",
                        f"03-0000-{i % 10000:04d}",
                        f"https://example.test/{i}",
                        '"[""https://example.test/x/' + str(i) + '""]"',
                        '"[""overture""]"',
                        row_hash,
                    ]
                )
                + "\n"
            )


def seed_existing_rows(connection, rows: int, app_rows: int) -> None:
    """同期«前»の PG を作る。62 万行のパイプライン製 + アプリ製を数千行。

    generate_series で一気に入れてから索引を作る。1 行ずつ INSERT すると
    索引の更新で桁違いに遅くなり、準備だけで日が暮れる。
    """

    with connection.cursor() as cursor:
        started = time.monotonic()
        cursor.execute(
            """
            INSERT INTO restaurants (
              google_place_id, name, name_language_code, latitude, longitude,
              image_url, image_path, address_components, plus_code,
              address, country_code,
              source_seed_id, source_names, source_row_hash, synced_at,
              created_by_source
            )
            SELECT
              'ChIJbench' || lpad(i::text, 12, '0'),
              'ベンチ食堂' || i || '号店', 'ja',
              24.0 + (i %% 210000) / 10000.0, 123.0 + (i %% 230000) / 10000.0,
              '', NULL, '[]'::jsonb, NULL,
              '東京都ベンチ区' || i || '-1-1', 'JP',
              (lpad(to_hex(i), 8, '0') || '-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
              ARRAY['overture'],
              'hash-' || i || '-v1',
              now(), 'pipeline'
            -- #1706 先頭 app_rows 件は «アプリ製» に譲る。dev ではアプリ製の行も
            -- catalog に載っている（実在の店なので open data にもある）ので、
            -- 範囲を重ねないと住所の穴埋め（1-a）が再現されない。
            FROM generate_series(%s, %s - 1) AS g(i)
            """,
            (app_rows, rows),
        )
        LOGGER.info("パイプライン製 %s 行を投入: %.1f秒", f"{rows - app_rows:,}", time.monotonic() - started)

        # アプリ製の行。**同期はこれらの表示値を書き換えてはいけない。**
        # 住所は空にしておく（1-a の穴埋めの対象になる）。
        started = time.monotonic()
        cursor.execute(
            """
            INSERT INTO restaurants (
              google_place_id, name, name_language_code, latitude, longitude,
              image_url, image_path, address_components, plus_code,
              address, country_code, created_by_source
            )
            SELECT
              'ChIJbench' || lpad(i::text, 12, '0'),
              'ユーザーの店' || i, 'ja',
              35.0, 139.0,
              'https://app.test/' || i || '.jpg', 'gs://app/' || i || '.jpg',
              '[{"types":["country"],"shortText":"JP"}]'::jsonb,
              '{"globalCode":"8Q7X"}'::jsonb,
              NULL, 'JP', 'user'
            FROM generate_series(0, %s - 1) AS g(i)
            """,
            (app_rows,),
        )
        LOGGER.info("アプリ製 %s 行を投入: %.1f秒", f"{app_rows:,}", time.monotonic() - started)

        started = time.monotonic()
        cursor.execute("ANALYZE restaurants")
        LOGGER.info("ANALYZE: %.1f秒", time.monotonic() - started)
    connection.commit()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s"
    )
    args = parse_args()

    start_cluster(args.pgdata, args.port)
    try:
        apply_migrations(args.port)

        os.environ["DATABASE_URL"] = (
            f"postgresql://postgres@/postgres?host=/tmp&port={args.port}"
        )
        sync = load_9_1()
        from pg_sync_common import connect_postgres, log_db_load  # noqa: E402

        connection = connect_postgres("dev", allow_public=False)
        seed_existing_rows(connection, args.rows, args.app_rows)

        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as fh:
            csv_path = Path(fh.name)
        started = time.monotonic()
        generate_catalog_csv(csv_path, args.rows, args.changed_ratio)
        LOGGER.info(
            "catalog CSV を生成: %s 行 / %.1f秒（変更率 %.1f%%）",
            f"{args.rows:,}", time.monotonic() - started, args.changed_ratio * 100,
        )

        LOGGER.info("=" * 60)
        LOGGER.info("ここから本番のコードをそのまま呼ぶ（SQL は写経していない）")
        LOGGER.info("=" * 60)

        overall = time.monotonic()
        log_db_load(connection, "同期前")

        started = time.monotonic()
        staging_rows = sync.load_staging(connection, csv_path)
        LOGGER.info("  %-28s %6.1f秒 / %d行", "staging へ COPY", time.monotonic() - started, staging_rows)

        sync.build_work_tables(connection)
        stats = sync.calculate_stats(connection, staging_rows)
        LOGGER.info(
            "plan: insert=%d update=%d skip=%d", stats.inserted, stats.updated, stats.skipped
        )

        sync.apply_sync(connection)
        log_db_load(connection, "同期後")
        elapsed = time.monotonic() - overall

        LOGGER.info("=" * 60)
        LOGGER.info("同期の DML 合計: %.1f秒（%.1f分）", elapsed, elapsed / 60)
        budget = sync.SYNC_TIME_BUDGET_SECONDS
        if elapsed >= budget:
            LOGGER.error(
                "❌ 予算 %.0f 分を超えました。この形では共有 DB へ流してはいけません",
                budget / 60,
            )
        else:
            LOGGER.info(
                "✅ 予算 %.0f 分に対して %.1f 分。余裕 %.1f 分",
                budget / 60, elapsed / 60, (budget - elapsed) / 60,
            )

        # 結果の妥当性も見る。速いだけで中身が壊れていては意味が無い。
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                  COUNT(*) FILTER (WHERE created_by_source = 'user' AND name LIKE 'ユーザーの店%'),
                  COUNT(*) FILTER (WHERE created_by_source = 'user' AND image_path LIKE 'gs://app/%'),
                  COUNT(*) FILTER (WHERE created_by_source = 'user' AND address IS NOT NULL),
                  COUNT(*) FILTER (WHERE created_by_source = 'pipeline' AND source_row_hash LIKE '%-v2')
                FROM restaurants
                """
            )
            kept_name, kept_image, filled_address, updated_hash = cursor.fetchone()
        LOGGER.info(
            "アプリ製の行: 店名を保持 %s / 画像を保持 %s / 住所を穴埋め %s",
            f"{kept_name:,}", f"{kept_image:,}", f"{filled_address:,}",
        )
        LOGGER.info("パイプライン製で hash が更新された行: %s", f"{updated_hash:,}")

        connection.rollback()
        connection.close()
        csv_path.unlink(missing_ok=True)
    finally:
        if not args.keep:
            pgbin = os.environ.get("PGBIN", "/usr/lib/postgresql/16/bin")
            subprocess.run(
                f"su postgres -c '{pgbin}/pg_ctl -D {args.pgdata} stop -m immediate'",
                shell=True, capture_output=True,
            )
            shutil.rmtree(args.pgdata, ignore_errors=True)


if __name__ == "__main__":
    main()
