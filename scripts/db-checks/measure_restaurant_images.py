#!/usr/bin/env python3
"""#1780 完了条件 5「既存の Google 由来画像資産の扱いを決めて実行する」の判断材料を測る
（読み取り専用）。

## なぜ要るか

#1780 の条件 5 は「保持 / 削除 / 差し替え」を決める、というものだが、**決めるための数字が
無い**まま «承認待ち» になっていた。オーナーへ «どうしますか» だけを投げないために、
先にこちらで測る（CLAUDE.md「問題を報告するときは «直せるのか» を最初に書く」）。

## 何が変わったのか（測る前に知っておくこと）

#1817 より前は、`restaurants.image_path` を消すと **その店の画像は無くなった**。
いまは `imageUrls` が次の順で埋まる:

  1. `restaurants.image_path`（Google 由来。これを消すか決めたい）
  2. **その店の dish_media サムネイル**（#1817 で追加）
  3. 画面側の受け皿（店アイコン。#1817 で追加）

つまり **«消すと真っ白になる» はもう起きない**。問題は «見た目が変わる店が何店あるか» に
変わっている。それをここで数える。

## 出すもの

1. `image_path` / `image_url` を持つ店の数（= 消す対象の母数）
2. そのうち **dish_media の代替がある店**（消しても料理写真が出る）
3. そのうち **代替も無い店**（消すと店アイコンになる。ここが «見た目が変わる» 店）

## 「使える dish_media」の判定は写経しない

本番（`usable-dish-media-filter.ts`）から書き出した
`sql/usable_dish_media_conditions.sql` を読む。判定を 2 箇所に書くと必ずずれる。

## 読み取り専用である

SELECT しか実行しない。接続直後に `SET default_transaction_read_only = on` を実行する。

## 使い方（db-script-run.yml から）

    script_path: scripts/db-checks/measure_restaurant_images.py
    args: --schema dev
    requirements_path: scripts/20251213T0000_wikidata_food_graph/requirements.txt

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

SQL_DIR = Path(__file__).resolve().parent / "sql"
USABLE_CONDITIONS_SQL_PATH = SQL_DIR / "usable_dish_media_conditions.sql"


def usable_dish_media_conditions_sql() -> str:
    """本番の «使える dish_media» の判定（AND 始まりの断片）を読む。

    ⚠️ ここで条件を書き足さない・書き換えないこと。変えるなら本番側を変えて
       スナップショットを書き出し直す（ファイル先頭のコメントに手順がある）。
    """
    if not USABLE_CONDITIONS_SQL_PATH.exists():
        raise SystemExit(
            f"❌ {USABLE_CONDITIONS_SQL_PATH} がない。"
            " UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest "
            "usable-dish-media-filter.spec.snapshot  で書き出すこと"
        )
    lines = [
        line
        for line in USABLE_CONDITIONS_SQL_PATH.read_text(encoding="utf-8").splitlines()
        if not line.lstrip().startswith("--")
    ]
    return "\n".join(lines).strip()


def build_sql() -> str:
    """画像を持つ店を、dish_media の代替の有無で切り分ける。"""
    return f"""
      WITH has_usable_media AS (
        SELECT DISTINCT d.restaurant_id
        FROM dish_media dm
        JOIN dishes d ON d.id = dm.dish_id
        WHERE dm.thumbnail_path <> ''
          {usable_dish_media_conditions_sql()}
      )
      SELECT
        count(*) AS restaurants_total,
        count(*) FILTER (WHERE r.image_path IS NOT NULL AND r.image_path <> '')
          AS with_image_path,
        count(*) FILTER (WHERE r.image_url IS NOT NULL AND r.image_url <> '')
          AS with_image_url,
        count(*) FILTER (
          WHERE (r.image_path IS NOT NULL AND r.image_path <> '')
            AND hum.restaurant_id IS NOT NULL
        ) AS image_path_with_media_fallback,
        count(*) FILTER (
          WHERE (r.image_path IS NOT NULL AND r.image_path <> '')
            AND hum.restaurant_id IS NULL
        ) AS image_path_without_fallback
      FROM restaurants r
      LEFT JOIN has_usable_media hum ON hum.restaurant_id = r.id
    """


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    parser.add_argument("--out-json", default=None)
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    import psycopg2

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SET default_transaction_read_only = on")
            cur.execute(f'SET search_path TO "{args.schema}", extensions')
            cur.execute("SELECT current_user, current_database()")
            user, db = cur.fetchone()
            logger.info("接続先: user=%s db=%s schema=%s", user, db, args.schema)

            cur.execute(build_sql())
            total, with_path, with_url, with_fallback, without_fallback = cur.fetchone()

    pct = (lambda n: f"{100.0 * n / total:.2f}%" if total else "n/a")

    logger.info("")
    logger.info("=" * 72)
    logger.info("# #1780 条件 5 — Google 由来画像を消したときに «見た目が変わる» 店")
    logger.info("=" * 72)
    logger.info("restaurants 総数                       : %10s", f"{total:,}")
    logger.info("image_path を持つ（消す対象の母数）      : %10s (%s)", f"{with_path:,}", pct(with_path))
    logger.info("image_url を持つ（非推奨列）            : %10s (%s)", f"{with_url:,}", pct(with_url))
    logger.info("")
    logger.info("  うち dish_media の代替がある          : %10s  ← 消しても料理写真が出る", f"{with_fallback:,}")
    logger.info("  うち代替も無い                        : %10s  ← 消すと店アイコンになる", f"{without_fallback:,}")
    logger.info("")
    logger.info(
        "⚠️ #1817 より前は «消すと画像が無くなる» だったが、いまは dish_media サムネイル →"
    )
    logger.info("   店アイコンの受け皿へ落ちる。**真っ白にはならない。**")

    result = {
        "schema": args.schema,
        "restaurants_total": total,
        "with_image_path": with_path,
        "with_image_url": with_url,
        "image_path_with_media_fallback": with_fallback,
        "image_path_without_fallback": without_fallback,
    }
    if args.out_json:
        Path(args.out_json).write_text(json.dumps(result, indent=2), encoding="utf-8")
        logger.info("")
        logger.info("JSON を書き出しました: %s", args.out_json)

    logger.info("")
    logger.info("=" * 72)
    logger.info("# JSON（機械可読）")
    logger.info("=" * 72)
    logger.info(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
