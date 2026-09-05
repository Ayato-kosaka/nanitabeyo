#!/usr/bin/env python3
"""#1273 dev へ配信した SNS 取り込み投稿が «アプリから使える» かを、実 API で確かめる（読み取り専用）。

## なぜ要るか

`9_2_sync_sns_dish_media.py` の検算は «PostgreSQL の行が usable フィルタの 4 条件を満たす»
までしか言っていない。CLAUDE.md の「保存できたは納品条件ではなく、保存したものをユーザーが
使えたが納品条件」に照らすと、これは «DB に行がある» でしかない。

このスクリプトは dev の実 API を叩いて **行が返ること** と **返った行の中身**（mediaUrl /
thumbnailImageUrl / externalEmbed）を出す。判定はしない。数字と生のレスポンスを出すだけ。

## 読むだけ

PostgreSQL へは SELECT しか投げず、接続を read-only に倒す。API は GET だけ叩く。

## 使い方（db-script-run.yml から）

    script_path: scripts/db-checks/probe_dish_media_api_1273.py
    args: --schema dev
    requirements_path: scripts/20260808T0000_restaurant/requirements.txt

環境変数: DATABASE_URL / SUPABASE_JWT_SECRET
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import logging
import os
import sys
import time
import urllib.parse
import urllib.request

import psycopg2

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

BASE_URL = os.getenv("BACKEND_BASE_URL", "https://api-development.nanitabeyo.net").rstrip("/")
SERVICE_SUB = "00000000-0000-4000-8000-0000000015a5"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def mint_service_jwt(ttl_seconds: int = 900) -> str:
    secret = os.environ["SUPABASE_JWT_SECRET"]
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": SERVICE_SUB,
        "role": "service_role",
        "aud": "authenticated",
        "is_anonymous": False,
        "iat": now,
        "exp": now + ttl_seconds,
    }
    signing_input = (
        _b64url(json.dumps(header, separators=(",", ":")).encode())
        + "."
        + _b64url(json.dumps(payload, separators=(",", ":")).encode())
    ).encode("ascii")
    sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return signing_input.decode("ascii") + "." + _b64url(sig)


def api_get(path: str, params: dict, token: str) -> tuple[int, dict | str]:
    url = f"{BASE_URL}{path}?{urllib.parse.urlencode(params, doseq=True)}"
    req = urllib.request.Request(
        url,
        method="GET",
        headers={"authorization": f"Bearer {token}", "x-app-language": "ja"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:2000]


def summarize_entry(entry: dict) -> dict:
    dm = entry.get("dish_media", {})
    emb = dm.get("externalEmbed")
    return {
        "dish_media_id": dm.get("id"),
        "media_type": dm.get("media_type"),
        "render_type": dm.get("render_type"),
        "mediaUrl": dm.get("mediaUrl"),
        "thumbnailImageUrl": (dm.get("thumbnailImageUrl") or "")[:110] or None,
        "externalEmbed": None
        if emb is None
        else {
            "provider": emb.get("provider"),
            "canonicalUrl": emb.get("canonicalUrl"),
            "embedStatus": emb.get("embedStatus"),
            "playbackStatus": emb.get("playbackStatus"),
            "thumbnailUrl": emb.get("thumbnailUrl"),
        },
        "restaurant": entry.get("restaurant", {}).get("name"),
        "dish_name": entry.get("dish", {}).get("name"),
        "categoryLabels_ja": (entry.get("dish", {}).get("categoryLabels") or {}).get("ja"),
        "reviewCount": entry.get("dish", {}).get("reviewCount"),
        "reviews": len(entry.get("dish_reviews") or []),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", choices=["dev"], default="dev")
    args = parser.parse_args()

    dsn = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(dsn, connect_timeout=15)
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()
    cur.execute(f'SET search_path TO "{args.schema}", public, extensions')
    cur.execute("SET statement_timeout = '120000ms'")

    # ---- 1. 取り込み行の素性 -------------------------------------------------
    logger.info("=== 1. dev の external_embed 行（母数）===")
    cur.execute(
        """
        SELECT dm.render_type,
               COUNT(*),
               COUNT(*) FILTER (WHERE dm.media_path IS NULL),
               COUNT(*) FILTER (WHERE dm.thumbnail_path = ''),
               COUNT(*) FILTER (WHERE dm.media_processing_status = 'completed'),
               COUNT(*) FILTER (WHERE dm.deleted_at IS NOT NULL)
        FROM dish_media dm GROUP BY 1 ORDER BY 2 DESC
        """
    )
    logger.info("  %-16s %9s %9s %9s %9s %9s", "render_type", "行数", "path無", "thumb空", "completed", "削除済")
    for row in cur.fetchall():
        logger.info("  %-16s %9d %9d %9d %9d %9d", *row)

    logger.info("")
    logger.info("=== 2. dmee（provider / playback_status / thumbnail_url）===")
    cur.execute(
        """
        SELECT e.provider, e.playback_status, e.embed_status,
               COUNT(*), COUNT(e.thumbnail_url)
        FROM dish_media_external_embeddings e GROUP BY 1,2,3 ORDER BY 4 DESC
        """
    )
    logger.info("  %-10s %-14s %-12s %9s %9s", "provider", "playback", "embed", "行数", "thumb_url有")
    for row in cur.fetchall():
        logger.info("  %-10s %-14s %-12s %9d %9d", *row)

    logger.info("")
    logger.info("=== 3. 最後の受け皿（dish_categories.image_url）が在るか ===")
    cur.execute(
        """
        SELECT COUNT(*) AS rows_total,
               COUNT(*) FILTER (WHERE c.image_url IS NOT NULL AND c.image_url <> '') AS with_category_image
        FROM dish_media dm
        JOIN dishes d ON d.id = dm.dish_id
        JOIN dish_categories c ON c.id = d.category_id
        WHERE dm.render_type = 'external_embed'
        """
    )
    total, with_img = cur.fetchone()
    logger.info(
        "  external_embed 行 %d 件のうち、料理カテゴリ画像を持つ = %d 件（%.1f%%）。"
        "持たない行はセルが真っ黒になりうる",
        total,
        with_img,
        100.0 * with_img / total if total else 0.0,
    )

    # ---- 2. 検索が返るはずの (座標, カテゴリ) を選ぶ ---------------------------
    logger.info("")
    logger.info("=== 4. 取り込み行が最も濃い (店の座標 × カテゴリ) を探す ===")
    cur.execute(
        """
        SELECT r.id, r.name,
               ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
               d.category_id, COUNT(*) AS n
        FROM dish_media dm
        JOIN dishes d ON d.id = dm.dish_id
        JOIN restaurants r ON r.id = d.restaurant_id
        WHERE dm.render_type = 'external_embed'
          AND dm.deleted_at IS NULL
          AND dm.media_processing_status = 'completed'
        GROUP BY 1,2,3,4,5
        ORDER BY n DESC
        LIMIT 5
        """
    )
    picks = cur.fetchall()
    for p in picks:
        logger.info("  %s / %s / (%.5f, %.5f) / cat=%s / %d 件", p[0], p[1], p[2], p[3], p[4], p[5])
    if not picks:
        logger.error("❌ external_embed の行が 1 件も無い")
        return 1

    rid, rname, lat, lng, cat, _n = picks[0]

    cur.execute(
        """
        SELECT dm.id FROM dish_media dm
        JOIN dishes d ON d.id = dm.dish_id
        WHERE dm.render_type = 'external_embed' AND dm.deleted_at IS NULL
          AND d.restaurant_id = %s AND d.category_id = %s
        LIMIT 3
        """,
        (rid, cat),
    )
    ids = [r[0] for r in cur.fetchall()]

    cur.close()
    conn.close()

    # ---- 3. 実 API ------------------------------------------------------------
    token = mint_service_jwt()

    logger.info("")
    logger.info("=== 5. GET /v1/dish-media/search（フィードの入口）===")
    status, body = api_get(
        "/v1/dish-media/search",
        {"location": f"{lat},{lng}", "radius": 3000, "categoryId": cat, "limit": 5, "preferredLanguageCodes": "ja"},
        token,
    )
    logger.info("  HTTP %s  (location=%.5f,%.5f radius=3000 categoryId=%s)", status, lat, lng, cat)
    if isinstance(body, dict):
        items = body.get("data") or []
        logger.info("  返った件数: %d", len(items) if isinstance(items, list) else -1)
        for it in (items if isinstance(items, list) else [])[:3]:
            logger.info("  %s", json.dumps(summarize_entry(it), ensure_ascii=False))
    else:
        logger.info("  body: %s", body)

    # 半径を広げると何枚のカードが並ぶか（フィードは 1 店につき 1 枚）
    status, body = api_get(
        "/v1/dish-media/search",
        {"location": f"{lat},{lng}", "radius": 20000, "categoryId": cat, "limit": 20, "preferredLanguageCodes": "ja"},
        token,
    )
    items20 = (body.get("data") if isinstance(body, dict) else None) or []
    logger.info("  半径 20km・limit 20 での件数: HTTP %s / %d 枚", status, len(items20) if isinstance(items20, list) else -1)

    logger.info("")
    logger.info("=== 6. GET /v1/dish-media?ids=（フィードの実体取得）===")
    status, body = api_get("/v1/dish-media", {"ids": ids}, token)
    logger.info("  HTTP %s  ids=%s", status, ids)
    if isinstance(body, dict):
        data = body.get("data") or {}
        items = data.get("items") or []
        logger.info("  items=%d notFound=%s", len(items), data.get("notFound"))
        for it in items[:3]:
            logger.info("  %s", json.dumps(summarize_entry(it), ensure_ascii=False))
        if items:
            logger.info("")
            logger.info("  --- 1 件の生レスポンス（dish_media 部分だけ）---")
            logger.info("  %s", json.dumps(items[0].get("dish_media"), ensure_ascii=False, indent=2)[:3000])
    else:
        logger.info("  body: %s", body)

    logger.info("")
    logger.info("=== 7. GET /v1/restaurants/:id/dish-media（店舗詳細）===")
    status, body = api_get(f"/v1/restaurants/{rid}/dish-media", {"limit": 5}, token)
    logger.info("  HTTP %s  restaurant=%s (%s)", status, rid, rname)
    # ⚠️ 封筒は {data: {data: [...], nextCursor}}（PaginatedResponse を ResponseWrap が包む）
    if isinstance(body, dict):
        page = body.get("data") or {}
        items = page.get("data") if isinstance(page, dict) else None
        logger.info("  items=%d nextCursor=%s", len(items or []), (page or {}).get("nextCursor"))
        for it in (items or [])[:3]:
            logger.info("  %s", json.dumps(summarize_entry(it), ensure_ascii=False))
    else:
        logger.info("  body: %s", body)

    logger.info("")
    logger.info("=== 8. 受け皿すら無い行（真っ黒になる行）の内訳 ===")
    conn2 = psycopg2.connect(dsn, connect_timeout=15)
    conn2.set_session(readonly=True, autocommit=True)
    with conn2.cursor() as c2:
        c2.execute(f'SET search_path TO "{args.schema}", public, extensions')
        c2.execute(
            """
            SELECT d.category_id, COALESCE(c.labels->>'ja', c.label_en), COUNT(*)
            FROM dish_media dm
            JOIN dishes d ON d.id = dm.dish_id
            JOIN dish_categories c ON c.id = d.category_id
            WHERE dm.render_type = 'external_embed'
              AND (c.image_url IS NULL OR c.image_url = '')
            GROUP BY 1,2 ORDER BY 3 DESC LIMIT 15
            """
        )
        for cid, label, n in c2.fetchall():
            logger.info("  %-12s %-24s %6d 件", cid, label, n)
        # --- 9. «見える» 上限。search も店舗詳細も «1 dish につき 1 本» しか出さない ---
        logger.info("")
        logger.info("=== 9. 取り込んだ投稿のうち «画面に出られる» 上限 ===")
        c2.execute(
            """
            SELECT COUNT(*) AS media, COUNT(DISTINCT dm.dish_id) AS dishes,
                   COUNT(DISTINCT d.restaurant_id) AS restaurants
            FROM dish_media dm JOIN dishes d ON d.id = dm.dish_id
            WHERE dm.render_type = 'external_embed' AND dm.deleted_at IS NULL
              AND dm.media_processing_status = 'completed'
            """
        )
        media, dishes_n, rest_n = c2.fetchone()
        logger.info(
            "  投稿 %d 件 / 料理(店×カテゴリ) %d 件 / 店 %d 件。"
            "search も店舗詳細も «1 dish につき 1 本» なので、いま画面に出られるのは最大 %d 件（%.1f%%）",
            media, dishes_n, rest_n, dishes_n, 100.0 * dishes_n / media if media else 0.0,
        )

        # --- 10. canonical_url のサンプル（手元で «動画か静止画か» を測るため） ---
        logger.info("")
        logger.info("=== 10. canonical_url のサンプル 30 件（別々の店から）===")
        c2.execute(
            """
            SELECT canonical_url FROM (
              SELECT e.canonical_url, d.restaurant_id,
                     ROW_NUMBER() OVER (PARTITION BY d.restaurant_id ORDER BY e.dish_media_id) AS rn
              FROM dish_media_external_embeddings e
              JOIN dish_media dm ON dm.id = e.dish_media_id
              JOIN dishes d ON d.id = dm.dish_id
              WHERE dm.render_type = 'external_embed' AND e.playback_status = 'unknown'
                AND e.embed_status = 'unknown'
            ) t WHERE rn = 1 LIMIT 30
            """
        )
        for (u,) in c2.fetchall():
            logger.info("  %s", u)
    conn2.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
