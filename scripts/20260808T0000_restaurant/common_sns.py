"""#1273 SNS(Instagram) seed パイプラインの共通部品。

店提案パイプラインの ``pipeline_common`` を再利用し、SNS 固有のものだけを足す:
- BigQuery テーブル名（``restaurant_recommendation`` 同居）
- resolve API へ渡す自己署名 JWT（匿名サインインはバッチ用途でアンチパターンのため使わない）
- resolve クライアント（URL を渡し candidates/prefill を受けて status を決める）

業務ロジック（店舗照合・カテゴリ照合・住所ジオコーディング）は **resolve が単一頭脳**。
ここには一切写経しない。依存は標準ライブラリのみ（hmac / urllib）で足りる。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

# --- BigQuery テーブル名（dataset は pipeline_common の BQ_DATASET = restaurant_recommendation）---
TABLE_SOURCE_ACCOUNT = "sns_source_account"
TABLE_POST_RAW = "sns_post_raw"
TABLE_POST_RESOLVED = "sns_post_resolved"
TABLE_COVERAGE = "sns_coverage"
TABLE_DISH_MEDIA_CATALOG = "sns_dish_media_catalog"

PROVIDER_INSTAGRAM = "instagram"

# Instagram の投稿を跨ルートで一意に指すキーは shortcode（permalink 内）。
# business_discovery(4_2) と 検索(4_3) で同じ投稿を同じ post_id に正規化し、重複解決を防ぐ。
_IG_SHORTCODE_RE = re.compile(r"instagram\.com/(?:[A-Za-z0-9_.]+/)?(?:p|reel|tv)/([A-Za-z0-9_-]+)", re.IGNORECASE)


def ig_shortcode_from_url(url: str) -> str | None:
    m = _IG_SHORTCODE_RE.search(url or "")
    return m.group(1) if m else None

# --- sns_post_resolved.status の値域 ---
STATUS_MATCHED = "matched"
STATUS_SKIPPED_NO_STORE = "skipped_no_store"
STATUS_SKIPPED_NO_CATEGORY = "skipped_no_category"
STATUS_SKIPPED_UNAVAILABLE = "skipped_unavailable"
STATUS_SKIPPED_UNSUPPORTED = "skipped_unsupported"

# --- dev API ベース URL ---------------------------------------------------------
# 公開値（非機微）なので secret ではなく定数で持つ（オーナー方針 #1273）。
# ⚠️ dev の実 URL をここへ記入する。env BACKEND_BASE_URL があればそちらを優先する。
_BACKEND_BASE_URL_DEFAULT = "https://api-development.nanitabeyo.net"


def backend_base_url() -> str:
    url = os.getenv("BACKEND_BASE_URL", _BACKEND_BASE_URL_DEFAULT).rstrip("/")
    if "__FILL_" in url:
        raise RuntimeError(
            "BACKEND_BASE_URL 未設定。common_sns._BACKEND_BASE_URL_DEFAULT に dev API の URL を"
            "記入するか、環境変数 BACKEND_BASE_URL を渡してください。"
        )
    return url


# --- 自己署名 JWT（resolve の AuthAnonGuard を満たすため）------------------------
# api/src/core/auth/jwt.strategy.ts は HS256 署名・exp・sub のみ検証し iss/aud は見ない。
# よって dev の SUPABASE_JWT_SECRET で短命トークンを自己署名すれば API 無改造で通る。
# GoTrue 匿名サインインは使わない（auth.users 堆積・匿名レート制限のため）。
_SERVICE_SUB = "00000000-0000-4000-8000-0000000015a5"  # sns-seed パイプライン固定のシステム sub


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def mint_service_jwt(ttl_seconds: int = 600) -> str:
    """dev の SUPABASE_JWT_SECRET で HS256 の短命 JWT を自己署名して返す。"""
    secret = os.getenv("SUPABASE_JWT_SECRET")
    if not secret:
        raise RuntimeError("SUPABASE_JWT_SECRET 未設定（db-script-run.yml の env / secret）。")
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": _SERVICE_SUB,
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


@dataclass
class ResolveOutcome:
    status: str
    google_place_id: str | None
    dish_category_id: str | None
    restaurant_confidence: float | None
    category_confidence: float | None
    resolve_reason: str | None


class ResolveClient:
    """resolve API を «URL を渡すだけ» で叩く薄いクライアント。

    JWT は 1 run で 1 本を使い回し、失効が近づいたら自動で取り直す
    （匿名ユーザーを量産しないための設計）。
    """

    def __init__(self, base_url: str | None = None, *, jwt_ttl: int = 600, timeout: float = 20.0):
        self.base_url = (base_url or backend_base_url()).rstrip("/")
        self.jwt_ttl = jwt_ttl
        self.timeout = timeout
        self._jwt: str | None = None
        self._jwt_exp = 0.0

    def _auth_header(self) -> str:
        now = time.time()
        if self._jwt is None or now > self._jwt_exp - 30:
            self._jwt = mint_service_jwt(self.jwt_ttl)
            self._jwt_exp = now + self.jwt_ttl
        return f"Bearer {self._jwt}"

    def resolve_raw(
        self,
        url: str,
        *,
        lat: float | None = None,
        lng: float | None = None,
        radius: float | None = None,
    ) -> dict[str, Any]:
        """resolve のレスポンス JSON をそのまま返す（判定は classify で行う）。"""
        body: dict[str, Any] = {"url": url}
        if lat is not None and lng is not None and radius is not None:
            body.update({"lat": lat, "lng": lng, "radius": radius})
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/v1/dish-media/imports/resolve",
            data=data,
            method="POST",
            headers={
                "content-type": "application/json",
                "authorization": self._auth_header(),
            },
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))


def classify(resp: dict[str, Any]) -> ResolveOutcome:
    """resolve レスポンス → sns_post_resolved の 1 行分に落とす（#1273 設計 §4 の status 表）。"""
    status = resp.get("status")
    if status == "unsupported":
        return ResolveOutcome(STATUS_SKIPPED_UNSUPPORTED, None, None, None, None, resp.get("reason"))
    if status == "unavailable":
        return ResolveOutcome(STATUS_SKIPPED_UNAVAILABLE, None, None, None, None, resp.get("reason"))

    prefill = resp.get("prefill") or {}
    candidates = resp.get("candidates") or {}
    category_id = prefill.get("dishCategoryId")
    place_id = prefill.get("googlePlaceId")  # resolve PR #1704 で追加。無ければ restaurantId から引く
    if place_id is None and prefill.get("restaurantId") is not None:
        for c in candidates.get("restaurants") or []:
            if c.get("restaurantId") == prefill.get("restaurantId"):
                place_id = c.get("googlePlaceId") or None
                break

    def _conf(kind: str) -> float | None:
        for c in candidates.get(kind) or []:
            if c.get("rank") == 1:
                return c.get("confidence")
        return None

    if category_id is None:
        return ResolveOutcome(STATUS_SKIPPED_NO_CATEGORY, None, None, None, None, resp.get("reason"))
    if not place_id:
        return ResolveOutcome(STATUS_SKIPPED_NO_STORE, None, category_id, None, _conf("dishCategories"), resp.get("reason"))
    return ResolveOutcome(
        STATUS_MATCHED, place_id, category_id, _conf("restaurants"), _conf("dishCategories"), resp.get("reason")
    )
