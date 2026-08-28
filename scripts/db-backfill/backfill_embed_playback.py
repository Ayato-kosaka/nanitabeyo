#!/usr/bin/env python3
"""#1641 既に取り込まれた SNS 投稿の **再生可否**（`playback_*`）を 1 回きりで埋める。

## なぜ要るのか

`dish_media_external_embeddings` に `playback_status` を足したのは 2026-08-28 で、
**それ以前に取り込まれた行は全部 `unknown` のまま**である。`unknown` は
「判定していない」＝ 従来どおり読み込んで試す扱いなので壊れはしないが、
オーナーが実機で踏んだ «サムネだけ出て動かないセル» は既存行の側にある。
新規取り込みだけ直しても、いま入っている投稿は直らない。

## 判定の正本は API 側である

判定規則そのものは
`api/src/v1/dish-media-imports/sns-oembed.service.ts` に在る（`EmbedPlaybackVerdict`）。
**このスクリプトはその写しであって、正本ではない。** 規則を変えるときは向こうを直すこと。
ここへ写しを置いたのは、1 回きりのバックフィルのために API を叩く経路
（認証・権限・レート）を新しく作るほうが大掛かりだからである。
役目を終えたらこのファイルは消してよい。

| provider | 材料 | 判定 |
| --- | --- | --- |
| instagram | 埋め込み SSR HTML の `video_url` | 在れば playable / 無ければ not_playable(no_video_in_embed) |
| youtube   | oEmbed の HTTP ステータス | 200 → playable / **401 → not_playable(embedding_disabled)** |
| tiktok    | 無し | 触らない（unknown のまま） |

⚠️ **判定できなかった行を not_playable にしない。** ネットワーク失敗・5xx・
   SSR が返らなかった、はいずれも «分からなかった» であって «再生できない» ではない。
   ここで安全側に倒すと、**取り込み済みの投稿がまとめて検索から消える**。

⚠️ **UA を変えない。** Instagram の埋め込みはブラウザ UA に対しては JS シェル
   （SSR 無し）を返す。API 側と同じ既定 UA を使う。

## 安全装置

- `--schema public` は `--i-know-this-is-production` を併記しないと動かない
- 既定は **dry run**。`--apply` を付けたときだけ UPDATE する
- 1 件ごとに待ち時間を入れる（provider を叩く回数は行数ぶんある）

## 使い方

    # dev で、何がどう変わるかだけ見る
    python scripts/db-backfill/backfill_embed_playback.py --schema dev

    # dev へ実際に書く
    python scripts/db-backfill/backfill_embed_playback.py --schema dev --apply

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

import argparse
import logging
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import psycopg2

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

# API 側（SafeFetchService）と同じ既定 UA。ブラウザを騙らない
USER_AGENT = "nanitabeyo/1.0"
TIMEOUT_SEC = 15
# 埋め込み SSR は約 260KiB。API 側の上限（1MiB）と揃える
MAX_BYTES = 1024 * 1024

# api/src/v1/dish-media-imports/sns-oembed.service.ts の INSTAGRAM_VIDEO_URL_MARKER と同じ。
# `"video_url": null` を «在る» と数えないため、値が https で始まることまで見る
VIDEO_URL_MARKER = re.compile(r'\\?"video_url\\?"\s*:\s*\\?"https')

ALLOWED_SCHEMAS = {"dev", "public"}


def http_status_and_body(url: str) -> tuple[int, str]:
    """GET して (ステータス, 本文) を返す。**例外を投げない**（0 = 届かなかった）。"""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SEC) as response:
            body = response.read(MAX_BYTES).decode("utf-8", errors="replace")
            return response.status, body
    except urllib.error.HTTPError as error:
        return error.code, ""
    except Exception as error:  # noqa: BLE001 — 届かなかったことだけ分かればよい
        logger.debug("  取得失敗: %s", error)
        return 0, ""


def verdict_for(
    provider: str, external_content_id: str, canonical_url: str
) -> tuple[str, str | None]:
    """`(playback_status, playback_reason)` を返す。判定できなければ `('unknown', None)`。"""
    if provider == "instagram":
        url = f"https://www.instagram.com/p/{external_content_id}/embed/captioned/"
        status, body = http_status_and_body(url)
        if status != 200:
            return "unknown", None
        # SSR が返っていること自体を先に確かめる。JS シェルには目印がひとつも無い
        if "EmbeddedMediaImage" not in body and 'class="Caption"' not in body:
            return "unknown", None
        if VIDEO_URL_MARKER.search(body):
            return "playable", None
        return "not_playable", "no_video_in_embed"

    if provider == "youtube":
        # ⚠️ API 側と同じ «canonical_url をそのまま渡す» を守る。ここで URL を
        #    組み直すと、取り込みのときと違う URL を問い合わせることになる
        url = "https://www.youtube.com/oembed?" + urllib.parse.urlencode(
            {"url": canonical_url, "format": "json"}
        )
        status, _ = http_status_and_body(url)
        if status == 200:
            return "playable", None
        if status == 401:
            return "not_playable", "embedding_disabled"
        return "unknown", None

    # tiktok は判定材料が無い。«分からない» を «再生できない» に寄せない
    return "unknown", None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", required=True, choices=sorted(ALLOWED_SCHEMAS))
    parser.add_argument("--apply", action="store_true", help="実際に UPDATE する（既定は dry run）")
    parser.add_argument("--i-know-this-is-production", action="store_true")
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--sleep", type=float, default=1.0, help="1 件ごとの待ち（秒）")
    args = parser.parse_args()

    if args.schema == "public" and not args.i_know_this_is_production:
        logger.error("❌ public を対象にするなら --i-know-this-is-production を付けてください")
        return 1

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        logger.error("❌ DATABASE_URL が未設定です")
        return 1

    connection = psycopg2.connect(dsn)
    connection.autocommit = False
    try:
        with connection.cursor() as cursor:
            cursor.execute(f'SET search_path TO "{args.schema}"')
            cursor.execute(
                """
                SELECT dish_media_id, provider, external_content_id, canonical_url
                FROM dish_media_external_embeddings
                -- ⚠️ 条件は `playback_checked_at IS NULL` ではなく status で見る。
                --    端末報告からの再検証（reportUnplayable）は «確かめたが分からなかった»
                --    行の日時だけを進めるので、日時で絞ると**その行を二度と拾えなくなる**
                WHERE playback_status = 'unknown'
                  AND provider IN ('instagram', 'youtube')
                ORDER BY created_at
                LIMIT %s
                """,
                (args.limit,),
            )
            rows = cursor.fetchall()

        logger.info("対象 %d 件（schema=%s / apply=%s）", len(rows), args.schema, args.apply)
        counts: dict[str, int] = {}
        for index, (dish_media_id, provider, external_content_id, canonical_url) in enumerate(
            rows, start=1
        ):
            status, reason = verdict_for(provider, external_content_id, canonical_url)
            counts[f"{provider}:{status}"] = counts.get(f"{provider}:{status}", 0) + 1
            logger.info(
                "[%d/%d] %s %s → %s%s",
                index,
                len(rows),
                provider,
                external_content_id,
                status,
                f" ({reason})" if reason else "",
            )

            # ⚠️ 判定できなかった行は触らない。checked_at も進めない
            #    （次に走らせたときにもう一度試せるようにするため）
            if status != "unknown" and args.apply:
                with connection.cursor() as cursor:
                    cursor.execute(f'SET search_path TO "{args.schema}"')
                    # ⚠️ status と reason は必ず同じ UPDATE で書く。
                    #    reason だけ古い値が残ると CHECK 制約（dmee_playback_reason_check）に当たる
                    cursor.execute(
                        """
                        UPDATE dish_media_external_embeddings
                        SET playback_status = %s,
                            playback_reason = %s,
                            playback_checked_at = now()
                        WHERE dish_media_id = %s
                        """,
                        (status, reason, dish_media_id),
                    )
                connection.commit()

            if args.sleep > 0 and index < len(rows):
                time.sleep(args.sleep)

        logger.info("--- 内訳 ---")
        for key in sorted(counts):
            logger.info("  %s: %d", key, counts[key])
        if not args.apply:
            logger.info("dry run のため 1 行も更新していません（--apply で実行）")
        return 0
    finally:
        connection.close()


if __name__ == "__main__":
    sys.exit(main())
