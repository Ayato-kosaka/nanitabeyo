#!/usr/bin/env python3
"""#1641 取り込み投稿（render_type='external_embed'）に **表示できるサムネイルが在るか**を数える。

## なぜ要るのか

「再生できないと分かっている投稿では WebView を作らない」高速パスを入れたところ、
**その セルが真っ黒になった**（run 33223480840 の feed-05）。それまで見えていた料理の写真は
アプリが持っていたものではなく、**Instagram の埋め込みページが描いていた 1 コマ目**だった。
読み込みをやめた結果、その絵ごと消えた。

つまり «アプリ自身がサムネイルを持っているか» が問題である。持っていれば高速パスでも
料理の写真が出るし、持っていなければ黒いままになる。**推測せずに数える。**

- `dish_media.thumbnail_path` … 自ストレージへ複製できたパス。空文字は «複製できていない»
- `dish_media_external_embeddings.thumbnail_url` … provider の CDN URL。
  **Instagram の署名 URL は 4〜5 日で失効する**ので、在っても表示できるとは限らない

## 読むだけ

このスクリプトは SELECT しかしない。

## 使い方

    python scripts/db-checks/measure_external_embed_thumbnails.py --schema dev

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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", required=True, choices=["dev", "public"])
    args = parser.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        logger.error("❌ DATABASE_URL が未設定です")
        return 1

    connection = psycopg2.connect(dsn)
    try:
        with connection.cursor() as cursor:
            cursor.execute(f'SET search_path TO "{args.schema}"')
            cursor.execute(
                """
                SELECT
                  e.provider,
                  e.external_content_id,
                  e.playback_status,
                  (m.thumbnail_path IS NOT NULL AND m.thumbnail_path <> '') AS has_stored_thumbnail,
                  (e.thumbnail_url IS NOT NULL) AS has_external_thumbnail,
                  m.deleted_at IS NOT NULL AS deleted
                FROM dish_media_external_embeddings e
                JOIN dish_media m ON m.id = e.dish_media_id
                ORDER BY e.playback_status, e.provider, e.external_content_id
                """
            )
            rows = cursor.fetchall()

        logger.info("provider   content_id            playback      自前サムネ 外部URL 削除")
        blind = 0
        for provider, cid, status, stored, external, deleted in rows:
            if not stored and status == "not_playable" and not deleted:
                blind += 1
            logger.info(
                "%-10s %-21s %-13s %-9s %-6s %s",
                provider,
                cid,
                status,
                "あり" if stored else "**なし**",
                "あり" if external else "なし",
                "済" if deleted else "-",
            )
        logger.info("--- 合計 %d 行 ---", len(rows))
        logger.info(
            "⚠️ 高速パスで真っ黒になりうる行（not_playable かつ自前サムネ無し・未削除）: %d",
            blind,
        )
        return 0
    finally:
        connection.close()


if __name__ == "__main__":
    sys.exit(main())
