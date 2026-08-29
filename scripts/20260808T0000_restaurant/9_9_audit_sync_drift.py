#!/usr/bin/env python3
"""同期の «ズレ» を数える（読み取り専用）。独立レビューの ③ と ① への対応。

## ③ 今回の catalog に居なかった行（＝溜まっていくゴミ）

9_1 は行を削除しない。閉店・Overture からの脱落・place_id の統合で catalog から
消えた店は、PG に残り続ける。**残っていること自体は正しい**（課金済みの
`restaurant_bids` が参照している行を、月次バッチの誤検知で消してはいけない）。
問題は「残っているものを数える手段が無い」ことだった。

`synced_at` は staging に居た行だけ更新されるので、**最新同期の開始時刻より
古い synced_at** が「今回の catalog に居なかった」の印になる。既に持っている
情報で数えられるのに、どこからも参照していなかった。

## ① 同じ実店舗が別の place_id で 2 行になっている疑い

`POST /v1/restaurants` は place_id の完全一致でしか既存を探さないので、
Google が別表現の ID を返すと新しい行ができる。パイプライン側も
「place_id が違えば別店」と判断するため、両方が正しいものとして公開される。

実際に dev で 1 件見つかっている（塩パン屋 pain･maison 銀座店、
`ChIJ_9oVOZ-LGGARTMN4dW-AI-4` と `ChIJAAAAAAAAAAARTMN4dW-AI-4` で後半 11 文字が一致）。

**「1 件だけ」と言えるだけの観測手段が無い**ので、まず数える。
直すのはその後。名前一致＋近接で拾い、件数と実例を出す。

**1 行も書き換えない。**
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pg_sync_common import connect_postgres  # noqa: E402
from pipeline_common import configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

# 重複候補の近接距離。別テナントを巻き込まないよう狭く取る。
DUPLICATE_RADIUS_M = 30.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="同期のズレを数えます（読み取り専用）")
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument("--radius-m", type=float, default=DUPLICATE_RADIUS_M)
    parser.add_argument("--examples", type=int, default=10)
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()

    connection = connect_postgres(args.schema, allow_public=args.allow_public)
    try:
        with connection.cursor() as cursor:
            # --- ③ catalog に居なかった行 ---
            cursor.execute("SELECT MAX(synced_at) FROM restaurants")
            latest = cursor.fetchone()[0]
            if latest is None:
                LOGGER.info("まだ一度も同期していません")
            else:
                LOGGER.info("最新の同期時刻: %s", latest)
                # 同じ同期の中でも synced_at は行ごとに少しずれるので、
                # 「最新から1時間以上前」を今回居なかった行とみなす。
                cursor.execute(
                    """
                    SELECT
                      COUNT(*) FILTER (WHERE synced_at IS NULL) AS never_synced,
                      COUNT(*) FILTER (
                        WHERE synced_at IS NOT NULL
                          AND synced_at < %s - INTERVAL '1 hour'
                      ) AS missing_from_latest_catalog
                    FROM restaurants
                    """,
                    (latest,),
                )
                never, missing = cursor.fetchone()
                LOGGER.info("一度も同期されていない行: %d件（アプリ製で seed が付かなかった行）", never)
                LOGGER.info(
                    "最新 catalog に居なかった行: %d件 ← 閉店・脱落・place_id 統合で溜まる分",
                    missing,
                )
                if missing:
                    cursor.execute(
                        """
                        SELECT google_place_id, name, synced_at, created_by_source
                        FROM restaurants
                        WHERE synced_at IS NOT NULL
                          AND synced_at < %s - INTERVAL '1 hour'
                        ORDER BY synced_at
                        LIMIT %s
                        """,
                        (latest, args.examples),
                    )
                    for gid, name, sat, cbs in cursor.fetchall():
                        LOGGER.info("    %s %r (%s, %s)", gid, name, sat, cbs)

            LOGGER.info("")
            # --- ① 同一店が別 place_id で 2 行 ---
            # 名前を NFKC 正規化して空白を除き、近接する別 place_id を探す。
            cursor.execute(
                """
                WITH n AS (
                  SELECT id, google_place_id, name, location,
                         regexp_replace(normalize(name, NFKC), '[\\s　]', '', 'g') AS nname
                  FROM restaurants
                )
                SELECT COUNT(*) FROM (
                  SELECT a.id
                  FROM n a JOIN n b
                    ON a.nname = b.nname
                   AND a.id < b.id
                   AND a.google_place_id <> b.google_place_id
                   -- PostGIS は extensions スキーマに居る。search_path は dev, public
                   -- なので **修飾しないと "type geography does not exist" で落ちる**（実測）。
                   -- 座標から作り直さず、生成列 `location`（geography）をそのまま使う。
                   AND extensions.ST_DWithin(a.location, b.location, %s)
                ) t
                """,
                (args.radius_m,),
            )
            dup_pairs = cursor.fetchone()[0]
            LOGGER.info(
                "同名かつ %.0fm 以内で place_id が違うペア: %d組 ← 同一店の二重登録の疑い",
                args.radius_m,
                dup_pairs,
            )
            if dup_pairs:
                cursor.execute(
                    """
                    WITH n AS (
                      SELECT id, google_place_id, name, location,
                             regexp_replace(normalize(name, NFKC), '[\\s　]', '', 'g') AS nname
                      FROM restaurants
                    )
                    SELECT a.name, a.google_place_id, b.google_place_id,
                           extensions.ST_Distance(a.location, b.location)
                    FROM n a JOIN n b
                      ON a.nname = b.nname AND a.id < b.id
                     AND a.google_place_id <> b.google_place_id
                     AND extensions.ST_DWithin(a.location, b.location, %s)
                    LIMIT %s
                    """,
                    (args.radius_m, args.examples),
                )
                for name, ga, gb, dist in cursor.fetchall():
                    LOGGER.info("    %r  %s / %s  (%.1fm)", name, ga, gb, dist)
    finally:
        connection.rollback()
        connection.close()


if __name__ == "__main__":
    main()
