#!/usr/bin/env python3
"""e2e の SNS 取り込みフィクスチャが dev に **同じ投稿の行を増やしていないか**を読み取り専用で採る（#1641）。

## なぜ要るのか

`e2e-mobile/utils/externalEmbedImport.ts` は «取り込む投稿» と «料理カテゴリ» の
組を、実行のたびに **お店フィードの状態から決め直している**。

    const mine = pool.find((id) => occupied.get(id) === contentId);   // 既に自分が代表なら再利用
    const free = pool.find((id) => !occupied.has(id));                // 空いていれば取る

`occupied` は `GET /v1/restaurants/:id/dish-media` の 1 ページから作るが、
この API は **«各料理につき、いいね数が最大の 1 件» しか返さない**
（`dish_media.repository.ts` の `ROW_NUMBER() OVER (PARTITION BY dish_id ...) WHERE rn = 1`）。

したがって、何らかの理由でその投稿が代表から外れる（別の投稿が同じ料理に付いて
いいね数で勝つ / 投稿が消える / ページから溢れる）と `mine` が外れ、
**同じ投稿が別の料理カテゴリへもう 1 行作られる**。
`dish_media_external_embeddings` の一意制約は `(provider, external_content_id, dish_id)` なので、
dish が違えば重複は止められない。

これが起きていると e2e は «同じ TikTok のセルが 2 枚» を見ることになり、
`my-dishes-grid-feed-concurrent-playback` の «2 つ同時に鳴った» が
**素材の重複なのか実装の欠陥なのか区別が付かなくなる**。

**このスクリプトは «起きているかどうか» を数字で出すだけである。** 消しはしない。

## 読み取り専用である

SELECT しか実行しない。接続自体を read-only に倒し、`public` は明示的に拒否する。

## 使い方

    python scripts/db-checks/audit_e2e_external_embed_rows.py --schema dev

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

import argparse
import logging
import os

import psycopg2

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

# e2e-mobile/utils/externalEmbedImport.ts が取り込む投稿。
# ⚠️ あちらを増やしたらここも足すこと。**片方だけ直すと «増えていない» と誤読する。**
FIXTURE_CONTENT_IDS = (
    ("instagram", "DZFdePPzzLI", "EXTERNAL_EMBED_IMPORT_URL（権利ブロック / 住所解決用）"),
    ("instagram", "CDg3owdFa6W", "EXTERNAL_EMBED_PLAYABLE_URL（再生できる対照）"),
    ("instagram", "Dcfhw8wFFm4", "EXTERNAL_EMBED_OWNER_REPORTED_URL（いまは spec 未使用）"),
    ("tiktok", "7588462458633735445", "EXTERNAL_EMBED_TIKTOK_URL"),
    ("youtube", "dQw4w9WgXcQ", "EXTERNAL_EMBED_YOUTUBE_URL"),
    ("youtube", "8KJDwppL0qg", "EXTERNAL_EMBED_YOUTUBE_BOT_CHECKED_URL"),
)


def section(title: str) -> None:
    logger.info("\n%s\n%s", title, "=" * len(title))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    args = parser.parse_args()

    if args.schema == "public":
        logger.error("❌ public は対象外です（e2e のフィクスチャは dev にしか作らない）")
        return 1

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    with psycopg2.connect(database_url) as conn:
        # 本番と同じインスタンスなので «SELECT しか書いていないつもり» に頼らない。
        # autocommit なのは SET を守るため（トランザクション内の SET は rollback で消える）
        try:
            conn.set_session(readonly=True, autocommit=True)
            logger.info("接続を read-only / autocommit に設定しました")
        except psycopg2.Error as exc:
            logger.warning("read-only 設定に失敗（SELECT のみのため続行）: %s", exc)

        with conn.cursor() as cur:
            cur.execute(f'SET search_path TO "{args.schema}", extensions')
            cur.execute("SET statement_timeout = '15s'")

            section("1. フィクスチャの投稿ごとの行数（削除済みを除く）")
            duplicated: list[tuple[str, str, int]] = []
            for provider, content_id, label in FIXTURE_CONTENT_IDS:
                cur.execute(
                    f"""
                    SELECT e.dish_id, d.category_id, d.restaurant_id, r.name,
                           m.created_at, m.deleted_at
                    FROM "{args.schema}".dish_media_external_embeddings e
                    JOIN "{args.schema}".dish_media m ON m.id = e.dish_media_id
                    JOIN "{args.schema}".dishes d ON d.id = e.dish_id
                    JOIN "{args.schema}".restaurants r ON r.id = d.restaurant_id
                    WHERE e.provider = %s AND e.external_content_id = %s
                    ORDER BY m.created_at
                    """,
                    (provider, content_id),
                )
                rows = cur.fetchall()
                alive = [row for row in rows if row[5] is None]
                mark = "⚠️" if len(alive) > 1 else "  "
                logger.info(
                    "%s %-9s %-22s 生存 %d 行 / 削除済み %d 行  — %s",
                    mark,
                    provider,
                    content_id,
                    len(alive),
                    len(rows) - len(alive),
                    label,
                )
                if len(alive) > 1:
                    duplicated.append((provider, content_id, len(alive)))
                for dish_id, category_id, restaurant_id, name, created_at, deleted_at in rows:
                    logger.info(
                        "      dish=%s category=%-10s 店=%s created=%s%s",
                        str(dish_id)[:8],
                        category_id,
                        (name or "")[:24],
                        created_at,
                        "  [削除済み]" if deleted_at else "",
                    )

            section("2. 判定")
            if duplicated:
                logger.info("⚠️ **同じ投稿が複数の料理へ入っています。**")
                for provider, content_id, n in duplicated:
                    logger.info("   %s / %s … %d 行", provider, content_id, n)
                logger.info(
                    "   → e2e のグリッドに同じ投稿のカードが並ぶので、"
                    "«2 枚見えた» が素材の重複か実装の欠陥か区別できません。"
                )
                logger.info(
                    "   → **増え続けるかどうかは created_at で見ること。** 割り当ては 2026-09-01 に"
                    " `DISH_CATEGORY_BY_URL`（固定表）へ変えたので、それ以降の行が増えていなければ"
                    " 残っているのは過去の残骸である。"
                )
                logger.info(
                    "   → それ以降にも増えているなら固定表が効いていない。"
                    " 解決した店（restaurant）が変わっていないかをまず疑うこと。"
                )
            else:
                logger.info("✅ 重複なし。フィクスチャの割り当ては安定しています。")
                logger.info("   （«同じ TikTok が 2 枚» の観測は、素材ではなく別の理由である）")

            logger.info("\n✅ 読み取りのみ完了（DDL / DML は 1 つも実行していません）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
