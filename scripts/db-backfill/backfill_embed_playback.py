#!/usr/bin/env python3
"""#1641 既に取り込まれた SNS 投稿の **再生可否**（`playback_*`）を 1 回きりで埋める。

あわせて、**サムネイル URL が空の行にはそれも入れる**。高速パス（再生できないと
分かっている投稿では WebView を作らない）を入れた結果、サムネイルが 1 つも無い行が
**真っ黒なセル**になった（run 33223480840 の feed-05）。判定のために埋め込み SSR を
どのみち引いているので、同じ HTML から拾って書けば追加のリクエストは要らない。

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

## 何度でも流してよい

`playback_status` がまだ `unknown` の行と、**自ストレージにサムネイルの複製が無い行**を拾う。
後者を残しているのは、そういう行にとって provider の署名 URL が**唯一の絵で、
しかも 4〜5 日で失効する**ためである。定期的に流し直せば絵が生き続ける
（複製が在る行は失効しないので触らない）。

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

# 埋め込み SSR のサムネイル。API 側 parseInstagramEmbedHtml と同じ目印を使う
IG_THUMBNAIL_MARKER = re.compile(
    r'<img[^>]*class="[^"]*EmbeddedMediaImage[^"]*"[^>]*src="([^"]+)"'
)


def _decode_entities(text: str) -> str:
    for old, new in (
        ("&amp;", "&"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&quot;", '"'),
        ("&#39;", "'"),
        ("&#x27;", "'"),
    ):
        text = text.replace(old, new)
    return text

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
) -> tuple[str, str | None, str | None]:
    """`(playback_status, playback_reason, thumbnail_url)` を返す。

    判定できなければ `('unknown', None, None)`。`thumbnail_url` は
    **Instagram の SSR から拾えたときだけ**入る（他 provider は None）。
    """
    if provider == "instagram":
        url = f"https://www.instagram.com/p/{external_content_id}/embed/captioned/"
        status, body = http_status_and_body(url)
        if status != 200:
            return "unknown", None, None
        # SSR が返っていること自体を先に確かめる。JS シェルには目印がひとつも無い
        if "EmbeddedMediaImage" not in body and 'class="Caption"' not in body:
            return "unknown", None, None
        thumbnail = IG_THUMBNAIL_MARKER.search(body)
        thumbnail_url = _decode_entities(thumbnail.group(1)) if thumbnail else None
        if VIDEO_URL_MARKER.search(body):
            return "playable", None, thumbnail_url
        return "not_playable", "no_video_in_embed", thumbnail_url

    if provider == "youtube":
        # ⚠️ API 側と同じ «canonical_url をそのまま渡す» を守る。ここで URL を
        #    組み直すと、取り込みのときと違う URL を問い合わせることになる
        url = "https://www.youtube.com/oembed?" + urllib.parse.urlencode(
            {"url": canonical_url, "format": "json"}
        )
        status, _ = http_status_and_body(url)
        if status == 200:
            return "playable", None, None
        if status == 401:
            return "not_playable", "embedding_disabled", None
        return "unknown", None, None

    # tiktok は判定材料が無い。«分からない» を «再生できない» に寄せない
    return "unknown", None, None


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
                SELECT e.dish_media_id, e.provider, e.external_content_id, e.canonical_url,
                       (m.thumbnail_path IS NULL OR m.thumbnail_path = '') AS needs_thumbnail
                FROM dish_media_external_embeddings e
                JOIN dish_media m ON m.id = e.dish_media_id
                -- ⚠️ 条件は `playback_checked_at IS NULL` ではなく status で見る。
                --    端末報告からの再検証（reportUnplayable）は «確かめたが分からなかった»
                --    行の日時だけを進めるので、日時で絞ると**その行を二度と拾えなくなる**
                --
                -- #1641 **自ストレージにサムネイルを持たない行**も拾う。判定が済んでいても
                --       絵が無ければ高速パスでセルが真っ黒になる（run 33223480840 の feed-05）。
                --
                -- ⚠️ 条件を `thumbnail_url IS NULL` にしない。自前の複製が無い行にとって
                --    provider の署名 URL は**唯一の絵で、しかも 4〜5 日で失効する**。
                --    «NULL のときだけ» にすると、一度入れた URL が死んだ後もう拾えない。
                --    自前の複製が在る行は触らない（そちらは失効しないので上書きの意味が無い）。
                WHERE (e.playback_status = 'unknown'
                       OR m.thumbnail_path IS NULL OR m.thumbnail_path = '')
                  AND e.provider IN ('instagram', 'youtube')
                  AND m.deleted_at IS NULL
                ORDER BY e.created_at
                LIMIT %s
                """,
                (args.limit,),
            )
            rows = cursor.fetchall()

        logger.info("対象 %d 件（schema=%s / apply=%s）", len(rows), args.schema, args.apply)
        counts: dict[str, int] = {}
        for index, (
            dish_media_id,
            provider,
            external_content_id,
            canonical_url,
            needs_thumbnail,
        ) in enumerate(rows, start=1):
            status, reason, thumbnail_url = verdict_for(
                provider, external_content_id, canonical_url
            )
            counts[f"{provider}:{status}"] = counts.get(f"{provider}:{status}", 0) + 1
            fills_thumbnail = bool(needs_thumbnail and thumbnail_url)
            logger.info(
                "[%d/%d] %s %s → %s%s%s",
                index,
                len(rows),
                provider,
                external_content_id,
                status,
                f" ({reason})" if reason else "",
                " +サムネイル" if fills_thumbnail else "",
            )

            # ⚠️ 判定できなかった行は触らない。checked_at も進めない
            #    （次に走らせたときにもう一度試せるようにするため）
            if args.apply and (status != "unknown" or fills_thumbnail):
                sets: list[str] = []
                values: list[object] = []
                if status != "unknown":
                    # ⚠️ status と reason は必ず同じ UPDATE で書く。reason だけ古い値が残ると
                    #    CHECK 制約（dmee_playback_reason_check）に当たる
                    sets += [
                        "playback_status = %s",
                        "playback_reason = %s",
                        "playback_checked_at = now()",
                    ]
                    values += [status, reason]
                if fills_thumbnail:
                    # 自ストレージに複製が無い行にだけ入れる（上の WHERE と同じ理由）。
                    # 複製が在る行はそちらが表示の一次ソースなので触らない
                    sets.append("thumbnail_url = %s")
                    values.append(thumbnail_url)
                with connection.cursor() as cursor:
                    cursor.execute(f'SET search_path TO "{args.schema}"')
                    cursor.execute(
                        f"""
                        UPDATE dish_media_external_embeddings
                        SET {", ".join(sets)}
                        WHERE dish_media_id = %s
                        """,
                        (*values, dish_media_id),
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
