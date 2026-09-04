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
TABLE_STORE_SITE_IG = "sns_store_site_ig"
TABLE_POST_RAW = "sns_post_raw"
TABLE_POST_RESOLVED = "sns_post_resolved"
TABLE_COVERAGE = "sns_coverage"
TABLE_DISH_MEDIA_CATALOG = "sns_dish_media_catalog"

PROVIDER_INSTAGRAM = "instagram"

# --- 日本の都道府県（正本）---
# «..[都府県]» のような形で書くと «神奈川県» の後ろ 3 文字だけを拾うなど静かに間違える。
# 47 個は閉じた集合なので列挙する。7_1（住所→都道府県/市区町村）・4_9（ソースページの地域）・
# 4_11（キャプションの地域）が同じ判定を持たないよう、ここを唯一の正とする。
PREF_PATTERN = ("北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|"
                "神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|"
                "大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|"
                "福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県")

_RE_PREF = re.compile(PREF_PATTERN)
_RE_CITY = re.compile(r"[一-龥ぁ-んァ-ヴー]{1,6}[市区町村]")

# 市区町村→座標の索引を作る SQL。restaurant_catalog.address から作り、外部ジオコーダを足さない。
CITY_INDEX_SQL = """
  WITH cityc AS (
    SELECT REGEXP_EXTRACT(address, r'(__PREF__)') pref,
           REGEXP_EXTRACT(address, r'(?:__PREF__)([^0-9０-９]{2,8}?[市区町村])') city,
           latitude lat, longitude lng
    FROM `__CATALOG__` WHERE run_id = @crid AND address IS NOT NULL
  )
  SELECT pref, city, AVG(lat) lat, AVG(lng) lng, COUNT(*) n
  FROM cityc WHERE pref IS NOT NULL AND city IS NOT NULL
  GROUP BY pref, city
"""


def city_index_sql(catalog_table: str) -> str:
    return CITY_INDEX_SQL.replace("__PREF__", PREF_PATTERN).replace("__CATALOG__", catalog_table)


def build_city_index(rows) -> tuple[dict, dict]:
    """city_index_sql の結果から (（県,市区町村）→座標, 全国で一意な市区町村→座標) を作る。"""
    by_pair: dict[tuple[str, str], tuple[float, float]] = {}
    prefs_of: dict[str, set[str]] = {}
    best: dict[str, tuple[int, float, float]] = {}
    for r in rows:
        by_pair[(r["pref"], r["city"])] = (r["lat"], r["lng"])
        prefs_of.setdefault(r["city"], set()).add(r["pref"])
        if r["city"] not in best or r["n"] > best[r["city"]][0]:
            best[r["city"]] = (r["n"], r["lat"], r["lng"])
    uniq = {c: (best[c][1], best[c][2]) for c, p in prefs_of.items() if len(p) == 1}
    return by_pair, uniq


def area_from_text(text: str, by_pair: dict, uniq: dict) -> tuple[float, float] | None:
    """文言から «resolve に渡す探索地点» を作る。#1273 の唯一の判定（写経しないこと）。

    resolve が店を探せる地点は «渡された lat/lng» か «キャプション中の郵便番号付き住所» の
    2 つしか無い。素の Instagram キャプションが住所を持つのは実測 0.6% なので、
    市区町村名から地点を作れるかどうかが «店が引けるか» を決める。

    誤爆させないための規則:
    - 都道府県が書いてあれば、その県の市区町村としてのみ当てる
    - 無ければ、全国で 1 県にしか無い市区町村名のときだけ当てる（«中央区» «北区» は捨てる）

    抜き出した塊は «神奈川県横浜市»（手前を巻き込む）や «大阪市東成区»（2 つ繋がる）に
    なるので、市/区/町/村 で終わる部分文字列を総当たりし、長い方から当てる。
    """
    if not text:
        return None
    m = _RE_PREF.search(text)
    pref = m.group(0) if m else None
    cands: set[str] = set()
    for token in _RE_CITY.findall(text):
        for j, ch in enumerate(token):
            if ch in "市区町村":
                for k in range(j):
                    if j - k + 1 >= 2:
                        cands.add(token[k:j + 1])
    for city in sorted(cands, key=len, reverse=True):
        if pref and (pref, city) in by_pair:
            return by_pair[(pref, city)]
        if not pref and city in uniq:
            return uniq[city]
    return None

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
        caption: str | None = None,
        author_name: str | None = None,
    ) -> dict[str, Any]:
        """resolve のレスポンス JSON をそのまま返す（判定は classify で行う）。

        #1273 大量並列: caption を渡すと resolve は IG を取りに行かない（投稿ごとの
        IG 取得がレート制限の元凶）。収集時に得たテキスト（検索の title/snippet・
        記事本文・business_discovery のキャプション）を渡すと、店照合/カテゴリ判定が
        純粋なテキスト処理になり、IG を叩かず好きなだけ並列できる。
        """
        body: dict[str, Any] = {"url": url}
        if lat is not None and lng is not None and radius is not None:
            body.update({"lat": lat, "lng": lng, "radius": radius})
        if caption is not None and caption.strip() != "":
            body["caption"] = caption
        if author_name is not None and author_name.strip() != "":
            body["authorName"] = author_name
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


def _unwrap(resp: dict[str, Any]) -> dict[str, Any]:
    """ResponseWrapInterceptor の {data, success} 包みを剥がす。

    api/src/core/interceptors/response-wrap.interceptor.ts が全レスポンスを
    ``{data: <payload>, success: true}`` に包む。resolve の実体はその ``data`` の中。
    包まれていない生 payload も一応そのまま通す（テスト用）。
    """
    if isinstance(resp, dict) and "status" not in resp and isinstance(resp.get("data"), dict):
        return resp["data"]
    return resp


# #1273 【設計】KPI 優先のカテゴリ選択。
# resolve の語彙は 1,577 QID だが、アプリ／カバレッジ KPI は 134 カテゴリ（140 QID）。実測（2026-09-03）では
# 店アカ caption 投稿のカテゴリ付き 75% のうち KPI 内は 38% しかなく、残りは «コーヒー» «シフォンケーキ» «札幌ラーメン»
# など KPI 外 QID に流れていた（その 74% は KPI 親を含む）。ここで (a) 候補の中に KPI の QID があればそれを優先し、
# (b) 無ければ «KPI 外 → KPI 親» の畳み表（kpi_dish_categories.json.fold_to_kpi）で親へ畳む。どちらも無ければ従来どおり rank1。
# 元の rank1 が KPI 内ならそのまま（挙動不変）。診断は resolve_reason の `k=` フラグに残す（p=優先 / f=畳み / -=そのまま）。
_KPI_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kpi_dish_categories.json")
_KPI_CACHE: dict[str, Any] | None = None


def _kpi_tables() -> tuple[set[str], dict[str, str]]:
    """(KPI QID 集合, KPI外→KPI親 の畳み表)。KPI_PREFER=0 で無効化（空集合）。読めなければ空で従来挙動。"""
    global _KPI_CACHE
    if _KPI_CACHE is None:
        qids: set[str] = set()
        fold: dict[str, str] = {}
        if os.getenv("KPI_PREFER", "1") != "0":
            try:
                with open(_KPI_JSON, encoding="utf-8") as f:
                    d = json.load(f)
                qids = set((d.get("kpi_qids") or {}).keys())
                fold = {k: v for k, v in (d.get("fold_to_kpi") or {}).items() if v in qids}
            except (OSError, ValueError):
                qids, fold = set(), {}
        _KPI_CACHE = {"qids": qids, "fold": fold}
    return _KPI_CACHE["qids"], _KPI_CACHE["fold"]


def pick_kpi_category(prefill_id: str | None, cat_cands: list[dict] | None) -> tuple[str | None, float | None, str]:
    """(category_id, confidence, kflag) を返す。kflag: '-'=従来どおり / 'p'=候補内の KPI を優先 / 'f'=親へ畳んだ。"""
    qids, fold = _kpi_tables()
    cands = sorted(cat_cands or [], key=lambda c: c.get("rank", 10**9))
    rank1 = cands[0] if cands else None
    base_id = prefill_id or (rank1.get("dishCategoryId") if rank1 else None)
    base_conf = rank1.get("confidence") if rank1 else None
    if not qids or base_id is None or base_id in qids:
        return base_id, base_conf, "-"
    # (a) 候補列に KPI の QID があればそれ（ランク順で最初のもの）
    for c in cands:
        cid = c.get("dishCategoryId")
        if cid in qids:
            return cid, c.get("confidence"), "p"
    # (b) 選ばれた QID（または候補列のどれか）が KPI 親へ畳めるなら畳む
    for cid, conf in [(base_id, base_conf)] + [(c.get("dishCategoryId"), c.get("confidence")) for c in cands]:
        if cid in fold:
            return fold[cid], conf, "f"
    return base_id, base_conf, "-"


def _rank1(cands: list[dict] | None) -> dict | None:
    for c in cands or []:
        if c.get("rank") == 1:
            return c
    return (cands or [None])[0]


def classify(resp: dict[str, Any]) -> ResolveOutcome:
    """resolve レスポンス → sns_post_resolved の 1 行分に落とす（#1273 設計 §4 の status 表）。

    «何割埋まる» の天井を測るため、prefill（resolve の自動確定＝高信頼）だけでなく
    candidates の rank1 も採用する。auto かどうかは confidence と resolve_reason 内の
    ``pf`` フラグで後から切り分けられるようにする（prefill は閾値超えのみ）。

    店の google_place_id は candidates.restaurants[].googlePlaceId から取る
    （dev の resolve には prefill.googlePlaceId が無いため）。店舗照合は pg dev の
    restaurants を引くので、matched は «その店が pg dev に居る» ことを意味する。
    """
    resp = _unwrap(resp)
    top_reason = resp.get("reason")
    status = resp.get("status")
    if status == "unsupported":
        return ResolveOutcome(STATUS_SKIPPED_UNSUPPORTED, None, None, None, None, top_reason)
    if status == "unavailable":
        return ResolveOutcome(STATUS_SKIPPED_UNAVAILABLE, None, None, None, None, top_reason)

    prefill = resp.get("prefill") or {}
    candidates = resp.get("candidates") or {}
    rsearch = resp.get("restaurantSearch") or {}
    cat_cands = candidates.get("dishCategories") or []
    rst_cands = candidates.get("restaurants") or []

    # --- 料理カテゴリ: prefill 優先、無ければ rank1 候補。さらに KPI（134）を優先／親へ畳む ---
    category_id, category_conf, kflag = pick_kpi_category(prefill.get("dishCategoryId"), cat_cands)

    # --- 店舗: prefill.restaurantId→candidate 逆引き、無ければ rank1 候補の place_id ---
    place_id = None
    rst_pick = None
    pref_rid = prefill.get("restaurantId")
    if pref_rid is not None:
        for c in rst_cands:
            if c.get("restaurantId") == pref_rid:
                rst_pick = c
                break
    if rst_pick is None:
        rst_pick = _rank1(rst_cands)
    if rst_pick:
        place_id = rst_pick.get("googlePlaceId") or None
    restaurant_conf = rst_pick.get("confidence") if rst_pick else None

    # --- 診断を resolve_reason 1 列に詰める（スキーマ非改変で天井分析を可能にする）---
    pf = ("c" if prefill.get("dishCategoryId") else "") + ("r" if pref_rid else "")
    diag = (
        f"{top_reason or '-'}|rs={rsearch.get('reason') or '-'}"
        f"|cat={len(cat_cands)}|rst={len(rst_cands)}|pf={pf or '-'}|k={kflag}"
    )

    if category_id is None:
        return ResolveOutcome(STATUS_SKIPPED_NO_CATEGORY, None, None, None, category_conf, diag)
    if not place_id:
        return ResolveOutcome(STATUS_SKIPPED_NO_STORE, None, category_id, None, category_conf, diag)
    return ResolveOutcome(STATUS_MATCHED, place_id, category_id, restaurant_conf, category_conf, diag)


# --- «その投稿はどの店のものか» の唯一の判定 -------------------------------------
#
# 【設計】#1273 seed-trust: 柱1（店アカウント）と柱1-B（店サイト埋め込み）は
# **収集時点で店が確定している**（そのアカウント＝その店 / その店の公式サイトに貼られた投稿）。
# discovery_seed_place_id はすべて in-catalog なので、resolve が店を引けなくても
# 店は分かっている。resolve はカテゴリ専用として使う。
#
# ⚠️ **この判定を SQL へ写経しないこと。** 7_1（KPI 台帳）と 9_1（実際に配信する行）に
# 同じ判定を別々に書いた結果、7_1 は seed を数えるのに 9_1 は status='matched' しか見ておらず、
# **カバレッジには計上されているのにアプリには 1 件も出ないデータ**が 2,676 店ぶん生まれていた。
# 数える側と配る側がずれると、KPI は «報告のための数字» になって意味を失う。
STORE_ID_SQL = "COALESCE(NULLIF(r.discovery_seed_place_id, ''), v.google_place_id)"

# 上の店 ID が非 NULL になる行の条件。matched か、seed を持っているか。
STORE_KNOWN_SQL = (
    "(v.status = 'matched' "
    "OR (r.discovery_seed_place_id IS NOT NULL AND r.discovery_seed_place_id != ''))"
)
