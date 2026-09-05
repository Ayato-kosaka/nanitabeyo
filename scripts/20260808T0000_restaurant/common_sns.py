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
import random
import re
import http.client
import socket
import threading
import time
import urllib.error
import urllib.parse
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
# #1815 店の国・住所・座標を持つ唯一の表（9_1_sync_restaurants が PG へ配る表）。
# sns_post_raw / sns_post_resolved は国を持たないので、国の判定は必ずここと突き合わせる。
TABLE_RESTAURANT_CATALOG = "restaurant_catalog"

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
  SELECT pref, city, AVG(lat) lat, AVG(lng) lng, COUNT(*) n,
         -- #1841 市区町村の «広がり»。矩形 locationRestriction の辺に使う。
         -- 飛び地・住所の誤りで端が伸びるので、上下 2% を落とした範囲を市域と見なす。
         APPROX_QUANTILES(lat, 100)[OFFSET(2)] lat_lo, APPROX_QUANTILES(lat, 100)[OFFSET(98)] lat_hi,
         APPROX_QUANTILES(lng, 100)[OFFSET(2)] lng_lo, APPROX_QUANTILES(lng, 100)[OFFSET(98)] lng_hi
  FROM cityc WHERE pref IS NOT NULL AND city IS NOT NULL
  GROUP BY pref, city
"""


def city_index_sql(catalog_table: str) -> str:
    return CITY_INDEX_SQL.replace("__PREF__", PREF_PATTERN).replace("__CATALOG__", catalog_table)


def build_city_bbox_index(rows) -> tuple[dict, dict]:
    """city_index_sql の結果から (（県,市区町村）→矩形, 全国で一意な市区町村名→県) を作る。

    #1841 で足した。矩形は `locationRestriction` の辺（= «この市の中に居ること» の裏取り）に、
    県の逆引きは «全国で一意な市区町村名» から検索語 «東京都八王子市» を組むために使う。
    `build_city_index` と同じ行を読むので、SQL は 1 回で足りる。
    """
    boxes: dict[tuple[str, str], tuple[float, float, float, float]] = {}
    prefs_of: dict[str, set[str]] = {}
    for r in rows:
        boxes[(r["pref"], r["city"])] = (r["lat_lo"], r["lng_lo"], r["lat_hi"], r["lng_hi"])
        prefs_of.setdefault(r["city"], set()).add(r["pref"])
    pref_of_unique_city = {c: next(iter(p)) for c, p in prefs_of.items() if len(p) == 1}
    return boxes, pref_of_unique_city


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


def city_name_candidates(text: str) -> list[str]:
    """文言に含まれる «市区町村名らしい部分文字列» を、長い順に返す。

    抜き出した塊は «神奈川県横浜市»（手前を巻き込む）や «大阪市東成区»（2 つ繋がる）に
    なるので、市/区/町/村 で終わる部分文字列を総当たりする。長い方が具体的なので先に当てる。
    """
    cands: set[str] = set()
    for token in _RE_CITY.findall(text or ""):
        for j, ch in enumerate(token):
            if ch in "市区町村":
                for k in range(j):
                    if j - k + 1 >= 2:
                        cands.add(token[k:j + 1])
    # 長さが同じ候補の順序は set の反復順（= PYTHONHASHSEED）で変わる。同じキャプションが
    # run ごとに別の市区町村へ落ちると、4_18 が «済みのキー» を別キーとして数え直し、
    # 1 日 75,000 request の上限を無駄に使う（実測で 238/239 と揺れた）。
    #
    # 同じ長さのときは **先に書いてある方**を採る。名前順（辞書順）で固定すると、
    # 「大衆馬肉酒場 うまる 新潟駅前店」のキャプションで «新潟市» ではなく «中央区» が
    # 先に来て、東京の店として問い合わせてしまった（実測）。投稿の主語は普通、先に書かれる。
    source = text or ""
    return sorted(cands, key=lambda c: (-len(c), source.find(c)))


def city_from_text(text: str, by_pair: dict, uniq: dict) -> tuple[str | None, str] | None:
    """文言から «どの市区町村か» を決めて (都道府県, 市区町村) を返す。当てられなければ None。

    #1841 で足した。`area_from_text` は «座標» を返すが、Google へ投げる検索語には
    «東京都八王子市» という **文字列**が要る。同じ走査を 2 か所に書かないよう、
    判定本体をこちらへ移し、`area_from_text` はこの結果を座標へ引き直すだけにする。

    誤爆させないための規則:
    - 都道府県が書いてあれば、その県の市区町村としてのみ当てる
    - 無ければ、全国で 1 県にしか無い市区町村名のときだけ当てる（«中央区» «北区» は捨てる）。
      このとき県は分からないので、第 1 要素は None を返す
    """
    if not text:
        return None
    prefs = [m.group(0) for m in _RE_PREF.finditer(text)]
    pref = prefs[0] if prefs else None
    candidates = city_name_candidates(text)
    # «新潟県新潟市» のように県と市区町村が**隣り合って**書かれているものが最優先。
    # これが無いと、キャプションのどこかに «東京都» と書いてあるだけで «中央区» を拾い、
    # 「大衆馬肉酒場 うまる 新潟駅前店」を東京の店として問い合わせてしまう（実測）。
    # 県は 1 か所目に限らない（先に別の県が話題として出てくることがある）。
    for city in candidates:
        for candidate_pref in prefs:
            if (candidate_pref, city) in by_pair and candidate_pref + city in text:
                return (candidate_pref, city)
    for city in candidates:
        if pref and (pref, city) in by_pair:
            return (pref, city)
        if not pref and city in uniq:
            return (None, city)
    return None


def area_from_text(text: str, by_pair: dict, uniq: dict) -> tuple[float, float] | None:
    """文言から «resolve に渡す探索地点» を作る。#1273 の唯一の判定（写経しないこと）。

    resolve が店を探せる地点は «渡された lat/lng» か «キャプション中の郵便番号付き住所» の
    2 つしか無い。素の Instagram キャプションが住所を持つのは実測 0.6% なので、
    市区町村名から地点を作れるかどうかが «店が引けるか» を決める。

    どの市区町村と見なすかは `city_from_text` が決める（ここには書かない）。
    """
    key = city_from_text(text, by_pair, uniq)
    if key is None:
        return None
    pref, city = key
    return by_pair[(pref, city)] if pref else uniq[city]

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

    def __init__(self, base_url: str | None = None, *, jwt_ttl: int = 600, timeout: float = 20.0,
                 keep_alive: bool = True, retries: int = 2):
        self.base_url = (base_url or backend_base_url()).rstrip("/")
        self.jwt_ttl = jwt_ttl
        self.timeout = timeout
        self.keep_alive = keep_alive
        # #1273 【設計】**429 / 5xx は投稿を捨てずに待って投げ直す。**
        # 実測（2026-09-05, dev）: 同時 24 リクエストで 1 分に 82 件の 500 が出て、
        # 中身は `EMAXCONNSESSION: max clients reached in session mode - pool_size: 15`
        # ＝ **Supabase のプーラの接続上限**であって API のバグではない。上限を踏むのは
        # «こちらが投げすぎた» ときだけなので、少し待てば通る。ここで捨てると
        # その投稿は次の fetch まで «未処理» のまま残り、同じ混雑にまた当たる。
        self.retries = max(retries, 0)
        # リトライした回数（診断用。呼び出し側がログへ出す）
        self.retried = 0
        self._jwt: str | None = None
        self._jwt_exp = 0.0
        self._jwt_lock = threading.Lock()
        # #1273 【設計】**TCP+TLS を毎回張り直さない。**
        # urllib.request.urlopen は 1 リクエストごとに接続を作って捨てる。resolve は
        # 1 投稿 = 1 リクエストで数万回叩くので、これだけで «サーバが何もしない投稿»
        # （キャプションだけ・エリア無し＝店舗検索が走らない経路）の所要時間の大半を占める。
        # スレッドごとに 1 本の HTTPS 接続を持ち回して keep-alive で使い回す。
        # 接続はスレッド間で共有しない（http.client は thread-safe ではない）。
        self._local = threading.local()

    def _auth_header(self) -> str:
        # 並列 resolve から同時に呼ばれる。ロックが無いと同じ TTL の JWT を人数分作る
        # （害は無いが無駄）。取り直しの瞬間だけ直列化する。
        with self._jwt_lock:
            now = time.time()
            if self._jwt is None or now > self._jwt_exp - 30:
                self._jwt = mint_service_jwt(self.jwt_ttl)
                self._jwt_exp = now + self.jwt_ttl
            return f"Bearer {self._jwt}"

    @staticmethod
    def _backoff_s(attempt: int) -> float:
        """再送までの待ち。全スレッドが揃って投げ直すと混雑を作り直すのでばらす。"""
        return (0.75 * (3 ** attempt)) * (0.5 + random.random())

    def _conn(self):
        """このスレッド専用の HTTPS 接続。無ければ張る。"""
        conn = getattr(self._local, "conn", None)
        if conn is None:
            parts = urllib.parse.urlsplit(self.base_url)
            cls = (http.client.HTTPSConnection if parts.scheme == "https"
                   else http.client.HTTPConnection)
            conn = cls(parts.netloc, timeout=self.timeout)
            self._local.conn = conn
        return conn

    def _drop_conn(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            try:
                conn.close()
            except OSError:
                pass
            self._local.conn = None

    def _post_keep_alive(self, path: str, data: bytes, headers: dict[str, str]) -> bytes:
        """keep-alive で POST する。相手に切られていたら 1 度だけ張り直して再送する。

        ⚠️ 呼び出し側は `urllib.error.URLError` / `TimeoutError` / `ValueError` しか
        捕まえない（5_1）。ここで http.client の例外をそのまま外へ出すと «失敗した投稿だけ
        飛ばす» が効かずジョブごと落ちるので、必ず URLError 系へ翻訳する。
        """
        base_path = urllib.parse.urlsplit(self.base_url).path.rstrip("/")
        url = f"{self.base_url}{path}"
        for attempt in (0, 1):
            conn = self._conn()
            try:
                conn.request("POST", base_path + path, body=data, headers=headers)
                resp = conn.getresponse()
                body = resp.read()
                if resp.status < 400:
                    return body
                self._drop_conn()
                status, reason, hdrs = resp.status, resp.reason, resp.headers
            except (http.client.HTTPException, ConnectionError, socket.gaierror) as e:
                # 使い回した接続が既に閉じられていた等。1 度だけ張り直して再送する。
                self._drop_conn()
                if attempt == 1:
                    raise urllib.error.URLError(e) from e
                continue
            except TimeoutError:
                self._drop_conn()
                raise
            except OSError as e:
                self._drop_conn()
                raise urllib.error.URLError(e) from e
            # ⚠️ 4xx/5xx は **try の外**で投げる。`HTTPError` は `OSError` の子なので、
            #    上の `except OSError` の中で投げると自分で捕まえて `URLError` に包み直し、
            #    **ステータスコードが消えて 5xx のリトライ判定ができなくなる**（実際にやった）。
            raise urllib.error.HTTPError(url, status, reason, hdrs, None)
        raise urllib.error.URLError("unreachable")

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
        headers = {
            "content-type": "application/json",
            "authorization": self._auth_header(),
        }
        path = "/v1/dish-media/imports/resolve"

        def once() -> dict[str, Any]:
            if self.keep_alive:
                headers["content-length"] = str(len(data))
                return json.loads(self._post_keep_alive(path, data, headers).decode("utf-8"))
            req = urllib.request.Request(
                f"{self.base_url}{path}", data=data, method="POST", headers=headers)
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))

        for attempt in range(self.retries + 1):
            try:
                return once()
            except urllib.error.HTTPError as e:
                # 混雑（429）とサーバ側の一時失敗（5xx）だけ待って投げ直す。
                # 4xx（400/401 等）はこちらの組み立てが悪いので、投げ直しても同じ。
                if attempt >= self.retries or not (e.code == 429 or 500 <= e.code < 600):
                    raise
            except TimeoutError:
                if attempt >= self.retries:
                    raise
            self.retried += 1
            time.sleep(self._backoff_s(attempt))
        raise urllib.error.URLError("unreachable")


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

    # ⚠️ 片方が決まらなかったからといって、決まっていた方まで捨てない。
    # 2026-09-05 実測: カテゴリが決まらなかった行のうち **8,383 行は店が決まっていた**のに
    # `google_place_id` を None で書いていた（`skipped_no_store` の側はカテゴリを残していて
    # 非対称だった）。resolve に «取り消し» は無く、決まらなかったのは «決められなかった»
    # だけである。同じ考え違いで `LATEST_RESOLVED_QUALIFY` が «解けなかった解き直し» に
    # 先の結果を殺させていた（cov13 987 → cov14 961）。捨てた情報は後から復元できない。
    #
    # 保持しても «カテゴリの無い行» が配信されることはない: 9_1 は
    # `WHERE v.dish_category_id IS NOT NULL` で絞っている。効くのは収集ターゲット選び
    # （4_7 / 4_17 の «もう投稿を持っている店» 判定）と、キャプションを足しての再 resolve。
    if category_id is None:
        return ResolveOutcome(STATUS_SKIPPED_NO_CATEGORY, place_id, None,
                              restaurant_conf, category_conf, diag)
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
#
# ⚠️⚠️ **#1846: seed-trust には «看板が 1 店を指しているとき» という前提がある。**
# 下の 2 つ（`*_ANY_SQL`）は «その投稿に紐づき得る店» を広く取る式で、**配信・計上に
# 使ってはいけない**。1 投稿 1 店を確定するのは `post_store_cte_sql()` の `post_store`。
# 実測（sns-catalog-2026-09-05 / 142,489 行）: この広い式で配信カタログを組んだ結果、
# **1,388 投稿が 2 店以上に紐づき**、どちらが出るかは 9_2 の `google_place_id ASC` ＝
# place_id の辞書順で決まっていた。内訳は「チェーンのブランドサイトが全支店の place_id に
# 登録されている」985 / 「1 つの IG アカウントが複数支店の place_id に紐づいている」292 /
# 「seed があるのに resolve の店が混ざった」41 / 他 70。候補どうしは 65% が 5km 以上離れており
# （381 投稿は 50km 以上）、辞書順で選ぶのは «別の市の店に付ける» のと同じだった。
#
# `*_ANY_SQL` は «この (店, カテゴリ) はもう投稿を持っているか»（4_7 / 4_17 の収集ターゲット
# 選び）にだけ残す。そこでは広すぎても «取りに行かない店が少し増える» だけで、
# ユーザーに間違った店を見せることはない。
STORE_ID_ANY_SQL = "COALESCE(NULLIF(r.discovery_seed_place_id, ''), v.google_place_id)"

# --- «その投稿の resolve 結果はどれか» の唯一の判定 ------------------------------
#
# 【設計】再解決は非破壊追記なので、1 つの post_id に複数の resolve_version が並ぶ
# （実測: sns-2026-09-03-storecap は raw 87,304 に対し resolved 183,132 行）。
# 集計・配信のどちらも «その投稿の最新の判断» だけを見なければならない。
#
# ⚠️ **この判定も 3 通りに分かれていた。** 7_1 は (provider, post_id) の最新、4_7 は
# (run_id, provider, post_id) の最新、**9_1 は絞っていなかった**。そのため 9_1 の出力は
# 171,531 行 / 139,774 投稿＝ **18.5% が重複**し、うち 20,536 は «同じ投稿に別カテゴリ» だった。
# dish_media は 1 投稿 1 行なので、これは同じ投稿が 2 つの料理として並ぶことを意味する。
#
# ⚠️ **«最新» だけで選ぶと、後から来た解けなかった解き直しが、先に解けていた結果を殺す。**
# 2026-09-05 実測: cov13 (≥5 セル 987) → cov14 (961) と **26 セル減った**。原因は
# `sns-2026-09-04-ccwat` の 5_1 が 00:26〜05:46 と長時間書き続けたこと。ccwat は収率が低く
# （84,034 投稿でカテゴリ付き 10,592・matched 386）、その «解けなかった» 行が resolved_at で
# 勝ってしまい、**4,802 投稿がカテゴリを失い 1,272 投稿が matched を失った**。
#
# resolve に «取り消し» は無い。カテゴリ無し／matched でない行は «決められなかった» であって
# «前の判断を否定した» ではないので、成功した判断を残す方が正しい。
# 順序は «カテゴリ有り → matched → 最新»（この順で実測: ≥5 セル 961 → 994 / 使える店
# 17,554 → 17,878。収集ゼロで取り戻せる）。
LATEST_RESOLVED_QUALIFY = (
    "QUALIFY ROW_NUMBER() OVER ("
    "PARTITION BY provider, post_id "
    "ORDER BY COALESCE(dish_category_id IS NOT NULL, FALSE) DESC, "
    "COALESCE(status = 'matched', FALSE) DESC, "
    "resolved_at DESC) = 1"
)

# 上の店 ID が非 NULL になる行の条件。matched か、seed を持っているか。
STORE_KNOWN_ANY_SQL = (
    "(v.status = 'matched' "
    "OR (r.discovery_seed_place_id IS NOT NULL AND r.discovery_seed_place_id != ''))"
)


# --- «看板» が指している店の数 ---------------------------------------------------
#
# 【設計】#1846: 収集経路が示すのは «どの店の看板の下で見つけたか» であって
# «どの店の投稿か» ではない。看板が 1 店を名乗っているのに実際は複数店を指している
# とき（チェーンのブランドサイト／ブランドアカウント）、seed は店を決めていない。
#
# 看板の識別子（identity key）は経路ごとに違う。
# - `store_account`    … その投稿を採ってきた IG アカウント（`account_id`）
# - `store_site_embed` … 投稿が埋め込まれていた公式サイトのドメイン（`discovery_query`）
#                        www 有無で別ドメイン扱いになるため揃える（実測: `hachibei.com` と
#                        `www.hachibei.com` が別々に入っていた）
# それ以外の経路（cc_wat / gourmet_media / search_api）は «第三者のページが店に言及した»
# ものなので、ホストが多数の店を指すのは当たり前で欠陥ではない（実測でもこの経路だけで
# 衝突している投稿は 2 件）。だから identity key を持たせず、共有度で落とさない。
SEED_IDENTITY_KEY_SQL = r"""CASE r.discovery_route
        WHEN 'store_account'    THEN CONCAT('account:', IFNULL(r.account_id, ''))
        WHEN 'store_site_embed' THEN CONCAT('site:', REGEXP_REPLACE(
               LOWER(IFNULL(r.discovery_query, '')), r'^www\.', ''))
        ELSE NULL
      END"""

# 看板の «強さ»。小さいほど強い。同じ投稿に複数の候補が立ったときはここで決める。
# 1: 店自身のアカウント > 2: 店の公式サイトの埋め込み > 3: 第三者ページの seed >
# 4: resolve の店照合（seed がどれも使えないときだけ）。
SEED_STORE_RANK_SQL = """CASE r.discovery_route
        WHEN 'store_account'    THEN 1
        WHEN 'store_site_embed' THEN 2
        ELSE 3
      END"""
RESOLVED_STORE_RANK = 4


TABLE_DISH_CATEGORY_IMAGES = "dish_category_images"


# --- «その料理カテゴリの絵があるか» の唯一の判定 ---------------------------------
#
# 【設計】#1273: 取り込み投稿（render_type='external_embed'）はアプリ側に画像を 1 枚も
# 持たない。`9_1` は thumbnail_url を常に NULL で組み（IG はサムネイル複製不可）、
# `9_2` は thumbnail_path='' で dish_media を作る。したがって画面に絵を出す最後の受け皿は
# **料理カテゴリの絵**（`dish_categories.image_url`）だけである
# （api/src/v1/dish-media/dish-media.assembler.ts の thumbnailImageUrl）。
#
# その受け皿が «必ず埋まっている» と仮定したまま一度も数えていなかった。実測（dev / 2026-09-05、
# scripts/db-checks/measure_delivered_but_invisible.py）:
#
#     usable 145,392 行のうち 3 段とも絵が無い行 = 3,119 行（2.15%）
#     その 221 カテゴリのほぼ全部は JP ゲート（KPI が数える 134 カテゴリ）の外
#
# ⚠️ **«1 つも JP ゲートに無い» は誤りだった（2026-09-05 実測、run sns-catalog-2026-09-05c）。**
# KPI の 140 QID のうち **`Q65241114`（ナポリタン）だけが `dish_category_images` に
# 非空の行を 1 件も持たない**。この 1 カテゴリのぶんだけ、このゲートは KPI の分子を削る:
#
#     ナポリタンで落ちた投稿 34 / 異なり店 22（他の 228 カテゴリ 3,369 投稿は KPI 外）
#
# 直し方は **ゲートを緩めることではなく、ナポリタンの絵を 1 枚入れること**。
# 絵が無いまま配れば «真っ黒なセル» が戻るだけで、KPI のセルは埋まらない。
# この 1 行が 0 に戻ったかは `dish_category_images` を数えれば分かる。
#
# `dish_categories.image_url` は `9_1_sync_dish_categories.py` が
# `COALESCE(rep.image_url, '')`（`dish_category_images` の代表 1 枚）で作る。
# つまり **この表に非空の行が無いカテゴリは、PostgreSQL でも必ず空文字になる**。
# 配信の可否をここで判定できるのはそのためで、PG を見に行く必要はない。
#
# ⚠️ 判定をここに 1 本だけ置く。9_1（配る側）が個別に書き直すと、
#    «絵が無いカテゴリへ配って真っ黒を作る» が黙って戻る。
def category_with_image_cte_sql(images_table: str, *, cte_name: str = "category_with_image") -> str:
    """絵を持つ料理カテゴリだけを列挙する CTE（列は ``dish_category_id`` 1 本）。"""
    return (
        f"{cte_name} AS (\n"
        f"        SELECT DISTINCT dish_category_id\n"
        f"        FROM `{images_table}`\n"
        f"        WHERE image_url IS NOT NULL AND image_url != ''\n"
        f"      )"
    )


def post_store_cte_sql(raw_table: str, *, latest_cte: str, runs_param: str | None = None) -> str:
    """«1 投稿 = 1 店» を確定する CTE 群（末尾の CTE 名は ``post_store``）を返す。

    ⚠️ **配信（9_1）と計上（7_1）は必ずこれを使う。** 店の決め方を SQL へ書き写すと、
    数える側と配る側がずれる（`STORE_ID_ANY_SQL` のコメント参照）。

    規則は 2 つだけ。

    1. **複数店を指している看板の seed は候補にしない。** そのアカウント / そのサイトが
       2 店以上の place_id に紐づいているなら、その seed は «ブランド» を指しているだけで
       店を決めていない。共有度は run を跨いで数える（run を絞ると «この run では 1 店»
       という理由で共有に気づけない）。
    2. **残った候補が 1 店に絞れないなら、その投稿は使わない。** 間違った店に付けるより
       落とす方が正しい（実測で候補どうしの 65% は 5km 以上離れている）。

    Args:
        raw_table: ``sns_post_raw`` の完全修飾名。
        latest_cte: 直前に定義済みの «投稿ごとの最新 resolve» CTE 名
            （``status`` / ``google_place_id`` / ``post_id`` を持つこと）。
        runs_param: seed を採る run を絞るクエリパラメータ名（``@`` は付けない）。
            None なら全 run。**共有度の集計は常に全 run で行う**。
    """
    run_filter = f"AND r.run_id IN UNNEST(@{runs_param})" if runs_param else ""
    return f"""
      seed_identity AS (
        -- 共有度は «全 run» で測る。run を絞ると看板の共有に気づけない。
        SELECT r.discovery_seed_place_id AS place_id, {SEED_IDENTITY_KEY_SQL} AS identity_key
        FROM `{raw_table}` r
        WHERE r.provider = '{PROVIDER_INSTAGRAM}'
          AND r.discovery_seed_place_id IS NOT NULL AND r.discovery_seed_place_id != ''
      ),
      identity_place_count AS (
        SELECT identity_key, COUNT(DISTINCT place_id) AS n_place
        FROM seed_identity WHERE identity_key IS NOT NULL GROUP BY identity_key
      ),
      store_candidate AS (
        SELECT DISTINCT r.post_id, r.discovery_seed_place_id AS google_place_id,
               {SEED_STORE_RANK_SQL} AS store_rank
        FROM `{raw_table}` r
        LEFT JOIN identity_place_count k ON k.identity_key = {SEED_IDENTITY_KEY_SQL}
        WHERE r.provider = '{PROVIDER_INSTAGRAM}' {run_filter}
          AND r.discovery_seed_place_id IS NOT NULL AND r.discovery_seed_place_id != ''
          AND ({SEED_IDENTITY_KEY_SQL} IS NULL OR IFNULL(k.n_place, 0) <= 1)
        UNION ALL
        -- seed がひとつも使えなかった投稿だけ resolve の店照合に落ちる（rank で自動的にそうなる）
        SELECT v.post_id, v.google_place_id, {RESOLVED_STORE_RANK}
        FROM {latest_cte} v
        WHERE v.status = 'matched' AND v.google_place_id IS NOT NULL
      ),
      post_store AS (
        -- ⚠️ HAVING は SELECT の別名を先に見るので、集計列と同じ名前を候補列に付けない
        --    （`HAVING COUNT(DISTINCT google_place_id)` が `ANY_VALUE(...)` を指して
        --    «Aggregations of aggregations» で落ちる）。候補側は cand_place に分ける。
        SELECT post_id, ANY_VALUE(cand_place) AS google_place_id,
               ANY_VALUE(cand_rank) AS store_rank
        FROM (
          SELECT c.post_id, c.google_place_id AS cand_place, c.store_rank AS cand_rank,
                 MIN(c.store_rank) OVER (PARTITION BY c.post_id) AS best_rank
          FROM store_candidate c
        )
        WHERE cand_rank = best_rank
        GROUP BY post_id
        HAVING COUNT(DISTINCT cand_place) = 1
      )"""


# --- 素のハンドル（@ の無い IG handle）抽出の唯一の正 -----------------------------
#
# 【設計】#1273 4_17: 埋め込み経路（`/embed/captioned/`・第三者ページの blockquote）で
# 採ったキャプションは、**`@` がタグごと剥がれて素のトークンだけが残る**
# （`sns_html.strip_tags` が `<a>@handle</a>` を本文へ畳む）。実測でもキャプション
# 592,329 件のうち `@` を含むものは 5.5% しか無く、`@` 前提の抽出
# （4_1 --source caption_mentions）は大半を取りこぼしていた。ここは
# «キャプションから素のハンドル候補を切り出す» 規則を **1 箇所だけ**に固定する場所である。
#
# ⚠️ この規則を SQL / 別スクリプトへ写経しないこと。使う側は `bare_handle_candidate_sql()`
#    が返す SQL 片を組み込む（BigQuery の RE2 と Python の re が同じ結果になるよう、
#    後読み・先読みを使わない書き方だけにしてある）。
#
# ⚠️ トークンの «形» は `shared/utils/textNormalize.ts` の `extractBareHandles`
#    （`BARE_HANDLE_PATTERN` / `HAS_LATIN_LETTER`）と同じものを使う。あちらは «行まるごとが
#    ハンドル» の行だけを見る（resolve は 1 投稿しか見ないので誤爆の害が大きい）。
#    こちらは行構造が消えた埋め込みキャプションを相手にするので、行ではなく
#    **`[a-z0-9._]` の最大ラン**をトークンにし、代わりに下の一般語ガードで誤爆を止める。

# 1. URL とハッシュタグは先に落とす。落とさないと `instagram.com/xxx` の `xxx` や
#    `#lunchtime` がハンドル候補になる（ハッシュタグを残すと当たりは +8% 増えるが、
#    «語» が紛れ込む経路を 1 本増やすので採らない）。
BARE_HANDLE_URL_RE = r"https?://[^\s]+"
BARE_HANDLE_HASHTAG_RE = r"#[^\s#]+"

# 2. 残りから `[a-z0-9._]` の最大ランを切り出す（区切り記号が自動的に境界になる）。
BARE_HANDLE_TOKEN_RE = r"[a-z0-9._]+"

# 3. 端の `.` `_` を落としてから形を見る（`textNormalize.ts` と同じ形）。
BARE_HANDLE_TRIM_LEAD_RE = r"^[._]+"
BARE_HANDLE_TRIM_TRAIL_RE = r"[._]+$"
BARE_HANDLE_SHAPE_RE = r"^[a-z0-9][a-z0-9._]{1,29}$"
BARE_HANDLE_HAS_LETTER_RE = r"[a-z]"

# 4. 一般語ガード（**KPI を汚さないための本体**）。
#
# 実測（2026-09-04、キャプション 592,329 件）: 素のトークンを店ハンドル辞書に当てると
# 76,987 ペア当たるが、そのうち **87.5% は下の stopword のどれか 1 語**である
# （`instagram` だけで 58,495 ペア）。「辞書に載っている店ハンドルが、たまたま英単語だった」
# ために起きる誤爆なので、語彙で落とすしかない。
GENERIC_HANDLE_STOPWORDS: tuple[str, ...] = (
    # プラットフォーム・投稿定型
    "instagram", "instagram.com", "facebook", "twitter", "tiktok", "youtube", "line",
    "threads", "pinterest", "use.repost", "repost", "reel", "reels", "story", "stories",
    "link", "bio", "dm", "follow", "share", "profile",
    # 飲食まわりの一般名詞
    "restaurant", "restaurants", "kitchen", "cafe", "coffee", "bar", "shop", "store",
    "food", "foods", "lunch", "dinner", "breakfast", "menu", "open", "close", "closed",
    "name", "top", "new", "news", "best", "good", "zero", "pain", "american", "meetup",
    # 地名・曜日・月（キャプションに素で書かれる）
    "japan", "japanese", "tokyo", "osaka", "kyoto", "nagoya", "fukuoka", "sapporo",
    "yokohama", "kobe", "sendai",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "today", "tomorrow",
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
    # 飲食店ではない有名ブランド（辞書に 1 店として載っていることがある）
    "ikea", "dior", "subway", "reebok", "ralphlauren", "diesel", "kfc",
    # 実測で «語» として多用されていた日本語ローマ字
    "irodori", "mare", "toto", "sano", "suma", "aman", "attic", "supports", "tenpura",
)

# 5. 語彙で列挙しきれない一般語は «コーパス内の広がり» で落とす。
#    英字だけのトークン（`tokyo` `kitchen`）は語と被りやすいので、**異なり投稿者が
#    この人数以上のものは «語» とみなして捨てる**。`_` `.` 数字を含むトークン
#    （`cafe_fune` `202currydou`）は語と被らないので、この guard は当てない
#    （当てると `eclatdepaix_chocolat` のような «よく言及される店» を落としてしまう）。
BARE_HANDLE_MAX_POSTERS = 4


def bare_handle_candidate_sql(post_raw_table: str) -> str:
    """キャプション → 素のハンドル候補までの CTE 群を返す（`WITH` の中身。末尾カンマ無し）。

    公開する CTE:

    | CTE | 中身 |
    | --- | --- |
    | `cand_all` | (post_id, poster, seed, handle, pure_alpha)。形だけ見た候補。**stopword 適用前** |
    | `cand` | `cand_all` から stopword を落としたもの |
    | `cand_freq` | (handle, posters) コーパス全体での異なり投稿者数 |
    | `ok` | `cand` に一般語ガードを当てたもの。**これが «抜けたハンドル»** |

    `cand_all` を残してあるのは、**誤爆率（stoplist 前後）を同じクエリで数えられるように**
    するため（別のクエリで数え直すと、片方だけ規則が変わっても気づけない）。

    クエリパラメータ `@stopwords`（ARRAY<STRING>）と `@max_posters`（INT64）を要求する。
    """
    return f"""
      cap_src AS (
        SELECT post_id,
               LOWER(IFNULL(account_id, '')) AS poster,
               discovery_seed_place_id AS seed,
               LOWER(NORMALIZE(caption, NFKC)) AS caption_norm
        FROM `{post_raw_table}`
        WHERE caption IS NOT NULL AND caption != ''
      ),
      cap_clean AS (
        SELECT post_id, poster, seed,
               REGEXP_REPLACE(REGEXP_REPLACE(caption_norm, r'{BARE_HANDLE_URL_RE}', ' '),
                              r'{BARE_HANDLE_HASHTAG_RE}', ' ') AS text
        FROM cap_src
      ),
      cap_token AS (
        SELECT DISTINCT post_id, poster, seed, token
        FROM cap_clean, UNNEST(REGEXP_EXTRACT_ALL(text, r'{BARE_HANDLE_TOKEN_RE}')) AS token
      ),
      cand_all AS (
        SELECT post_id, poster, seed, handle, REGEXP_CONTAINS(handle, r'^[a-z]+$') AS pure_alpha
        FROM (
          SELECT post_id, poster, seed,
                 REGEXP_REPLACE(REGEXP_REPLACE(token, r'{BARE_HANDLE_TRIM_LEAD_RE}', ''),
                                r'{BARE_HANDLE_TRIM_TRAIL_RE}', '') AS handle
          FROM cap_token
        )
        WHERE REGEXP_CONTAINS(handle, r'{BARE_HANDLE_SHAPE_RE}')
          AND REGEXP_CONTAINS(handle, r'{BARE_HANDLE_HAS_LETTER_RE}')
          AND handle != poster
      ),
      cand AS (
        SELECT * FROM cand_all WHERE handle NOT IN UNNEST(@stopwords)
      ),
      cand_freq AS (
        SELECT handle, COUNT(DISTINCT NULLIF(poster, '')) AS posters FROM cand GROUP BY handle
      ),
      ok AS (
        SELECT c.*, f.posters FROM cand c JOIN cand_freq f USING (handle)
        WHERE NOT (c.pure_alpha AND f.posters >= @max_posters)
      )"""


def store_handle_dict_sql(store_site_ig_table: str, source_account_table: str,
                          *, corroborated_only: bool = True) -> str:
    """handle → google_place_id 辞書（CTE `handle_dict`）を返す。

    柱1（店公式サイト crawl の `sns_store_site_ig`）と、オープンデータ／柱1-B が入れた
    `sns_source_account.discovery_seed_place_id` の両方を合わせる。
    **複数の店に付く handle はチェーン公式**なので採らない（4_1 の
    `store_branch_rows_from_crawl` と同じ規律。あちらは «登録するか»、ここは
    «引き当ててよいか» を決める）。

    ## `corroborated_only`（既定 True）

    店の公式サイトに貼られた IG が **その店のアカウントとは限らない**。実測（4_17 の
    精度サンプル 200 件）では、誤帰属 24 件のうち **18 件が `corroborated = FALSE` の
    site crawl 由来**だった（観光協会・地域情報誌・スタッフ個人・靴店など、店ではない
    アカウントを店の place_id へ結びつけていた）。

    そこで既定では «裏取り済み» だけを引き当てに使う:

    - `sns_store_site_ig.corroborated = TRUE`（ドメイン／店名の裏取りあり）
    - `sns_source_account` のうち **site crawl 由来ではない**もの（オープンデータの
      `social_urls` や Foursquare。店のレコード自体が持っていた IG）

    引き換えに辞書は 49,548 → 31,910 handle になり、確定できる投稿は 6,056 → 4,319 件、
    新規店は 1,721 → 1,191 店に減る。**«当たる数» より «当てた店が合っていること» を
    採る**（誤帰属はカバレッジ KPI を汚し、アプリでは別の店の動画として出てしまう）。
    広げたいときだけ `corroborated_only=False` にする。
    """
    site_where = " AND corroborated" if corroborated_only else ""
    account_where = (" AND discovery_method != 'official_site_crawl'"
                     if corroborated_only else "")
    return f"""
      handle_dict AS (
        -- ⚠️ 内側の列名を `place_id` にすると、HAVING の `COUNT(DISTINCT place_id)` が
        --    出力エイリアス（ANY_VALUE(...)）を指してしまい «Aggregations of aggregations»
        --    で落ちる。内側は `pid` のままにすること。
        SELECT handle, ANY_VALUE(pid) AS place_id
        FROM (
          SELECT LOWER(handle) AS handle, google_place_id AS pid
          FROM `{store_site_ig_table}`
          WHERE handle IS NOT NULL AND google_place_id IS NOT NULL
            AND google_place_id != ''{site_where}
          UNION ALL
          SELECT LOWER(handle), discovery_seed_place_id
          FROM `{source_account_table}`
          WHERE handle IS NOT NULL AND discovery_seed_place_id IS NOT NULL
            AND discovery_seed_place_id != ''{account_where}
        )
        GROUP BY handle
        HAVING COUNT(DISTINCT pid) = 1
      )"""


# --- «その店は日本の店か» の唯一の判定 ---------------------------------------------
#
# 【設計】#1815 / #1273: `restaurant_catalog` 620,428 行のうち **100,058 行（16.13%）が
# 日本以外の店**（大半が韓国、次いでロシア沿海地方）なのに `country_code` は全行 'JP' で、
# うち 126 店 / dish_media 1,025 行が `sns_dish_media_catalog` に載って dev へ配信された。
#
# ⚠️⚠️ **取り込みの矩形（緯度20.0–46.5 / 経度122.0–154.0）を «日本かどうか» の判定に
# 使ってはいけない。** それは 1_3 が «取り込む» ために使った条件であり、取り込んだ結果へ
# 当て直しても構造上いつでも真になる。実際 8_1 の海外チェックはそれをやっていたので、
# 韓国の店が 97,726 行入った run でも緑だった。**取り込み条件を検査条件へ流用しない。**
#
# 判定は独立した 3 本の根拠の OR で、この 3 本以外を足さない。
#
# | 根拠 | 何を見るか | 独立性 |
# | --- | --- | --- |
# | (a) `country_code` | 1_3 が Overture の `addresses[1].country` から運んだ実測値 | 出所のある値 |
# | (b) 文字と住所の形 | ハングル / キリル語 / 韓国式の住所トークン | 座標を一切見ない |
# | (c) 国外領域の矩形 | ソウル・釜山・済州・鬱陵島・沿海地方 «だけ» を囲う矩形 | 文字を一切見ない |
#
# (c) は «日本を囲う矩形»（＝取り込み条件）ではなく **«国外を囲う矩形»** である。
# 前者は «中に居れば日本» という嘘をつくが、後者は «ソウルの真ん中に居る» という
# 単独で成立する事実しか言わない。対馬（韓国本土の矩形と重なる日本領）は矩形から除く。
#
# ## 実測（run=restaurant-2026-08-23 / 620,428 行、2026-09-05）
#
# - (b) 文字ルールが挙げる行: 99,862 / (c) 国外矩形に入る行: 100,058
# - 両方に当たる: 99,857。**独立な 2 つの根拠が 99.8% 一致する**
# - (b) だけ = 5 行。うち 3 行は白翎島・楸子島の実在の韓国店（矩形の穴）で、
#   **日本の店の誤検知は 2 行だけ**（「용녀」/2370-2 Awayamachi、
#   「yong sundubu 집」/大船1-20-2。店名がハングルなのに住所に日本語が 1 文字も無い）
# - (c) だけ = 201 行。全て韓国の店で、住所が `Chungmuro 2(i)-ga` `Yongsan Dong 2 Ga`
#   のように韓国式トークンが空白区切りで書かれていて (b) が拾えないもの
# - 目視した 291 行（無作為 120 / 国外矩形の外にある該当行の全 91 / 住所ルールのみ 20 /
#   未検出 60）のうち、**日本国内の韓国料理店を «海外» と誤判定したものは 0 件**
#
# ## 日本国内の韓国料理店を弾かないための規則（誤検知の本体）
#
# ハングルを含む店名は新大久保・鶴橋・福岡に大量にある。**文字だけで判定してはいけない。**
# 修正前の 8_1（ハングル or キリル 1 文字）は日本国内 62 店を海外と誤判定していた
# （新大久保「하남돼지집」、大阪「정낙지」、福岡「골목게장」など 51 店＋
# 「ＢＡＲ ＢＯＯＴ ＣＡМＰ」「Lounge Я」のようにキリル文字を装飾に使う日本の店 11 店）。
# そこで:
#   - 文字の根拠は **«日本語の手がかり» が無いときだけ**有効にする（下の JAPAN_TEXT_RE）
#   - キリル文字は **3 文字以上連続** したときだけ数える（「МASU」の М 1 文字は装飾）
#   - 韓国式住所トークンは «住所» 欄だけを見る（店名の「Lo-ro」「Cafe Cheonghak-dong」で
#     誤爆する）。`-gun` は日本の «郡» と衝突するので**採らない**
#   - 文字の根拠は **住所が入っている行にだけ**当てる。«日本語の手がかりが無い» は
#     住所を見て初めて言えることで、住所が空の行では «情報が無い» と区別が付かない。
#     PostgreSQL の `restaurants.address` はユーザー登録行で NULL のことがあり、実測でも
#     「韓国料理TonTon 한국식당 톤톤」（大阪）「板前焼肉一雅 이치마사」（大阪）
#     「韓国料理専門店 佳楽 가락」（東京）を海外と誤判定していた。
#     restaurant_catalog 側で住所が空なのは 620,428 行中 128 行だけで、この条件を
#     足しても検出は 100,063 行のまま **1 行も減らない**（実測）
#
# ⚠️ **この判定を SQL / 別スクリプトへ写経しないこと。** 使う側は
# `foreign_restaurant_sql()` が返す式を埋め込む。写経した複製は、本番だけが直ったときに
# 緑のまま古い挙動を守り続ける（CLAUDE.md「列を足したら〜」の事故）。

# ⚠️ 文字クラスは **実体文字**で書く（`\uAC00` や `\x{AC00}` を使わない）。
#    この 3 つの正規表現は BigQuery(RE2) / Python(re) / PostgreSQL(ARE) の 3 方言で
#    そのまま使う。3 方言が同じに解釈する書き方は «実体文字» と «先頭の (?i)» だけで、
#    Unicode エスケープの綴りは方言ごとに違う（RE2 は `\x{}`、他は `\u`）。
#    同じ理由で `(?i)` はパターンの **先頭にしか置けない**（PostgreSQL の ARE の制約）。
#    語中の大小文字は `[Cc]home` のように文字クラスで書く。

# ハングル（音節・字母）と、3 文字以上続くキリル文字。
FOREIGN_SCRIPT_RE = r"[가-힣ᄀ-ᇿ]|[Ѐ-ӿ]{3,}"

# 韓国式の住所トークン（ローマ字表記）。**住所欄にだけ当てる。**
# `gun`（郡）は日本の住所（「北安曇郡」= Kitaazumi-gun）と衝突するので入れない。
KOREAN_ADDRESS_RE = (
    r"(?i)(^|[^a-z])[a-z0-9]+-(dong|eup|myeon|myun|gil|ro|daero|ri|ga)([^a-z]|$)"
)

# 日本語の手がかり。これがあるときは «文字» の根拠を無効にする（新大久保の韓国料理店）。
JAPAN_TEXT_RE = r"[぀-ヿ]|丁目|番地|〒|[Cc][Hh][Oo][Mm][Ee]|" + PREF_PATTERN

# 国外領域の矩形（lat_lo, lat_hi, lng_lo, lng_hi, ラベル）。
# ⚠️ «日本を囲う矩形» を足さないこと（取り込み条件の流用になる）。ここは «そこに居れば
#    日本ではない» と単独で言える土地だけを囲う。
FOREIGN_TERRITORY_BOXES: tuple[tuple[float, float, float, float, str], ...] = (
    (34.0, 38.7, 124.5, 129.6, "韓国本土"),
    (33.1, 33.99, 126.1, 126.99, "済州・楸子島"),
    (37.4, 37.6, 130.7, 131.0, "鬱陵島"),
    (42.0, 49.0, 130.0, 137.0, "ロシア沿海地方"),
)
# 上の «韓国本土» の矩形と重なる日本領。ここに入る行は矩形の根拠から外す。
JAPAN_ENCLAVE_BOXES: tuple[tuple[float, float, float, float, str], ...] = (
    (34.0, 34.8, 129.1, 129.6, "対馬"),
)


def _box_sql(latitude: str, longitude: str, boxes) -> str:
    return " OR ".join(
        f"({latitude} BETWEEN {lo} AND {hi} AND {longitude} BETWEEN {wlo} AND {whi})"
        for lo, hi, wlo, whi, _ in boxes
    )


def foreign_restaurant_sql(
    *,
    name: str,
    address: str,
    country_code: str,
    latitude: str,
    longitude: str,
    dialect: str = "bigquery",
) -> str:
    """«この店は日本の店ではない» を判定する SQL 式（BOOLEAN）を返す。

    引数は列名ではなく **列を指す式**（``rc.name`` / ``r.address`` など）を渡す。
    BigQuery でも PostgreSQL でも同じ規則を使えるよう、方言差だけをここで吸収する。

    Args:
        dialect: ``"bigquery"``（RE2 / ``REGEXP_CONTAINS``）または
            ``"postgres"``（ARE / ``~``）。
    """
    if dialect not in ("bigquery", "postgres"):
        raise ValueError(f"未知の dialect: {dialect!r}")

    def contains(expr: str, pattern: str) -> str:
        if dialect == "bigquery":
            return f"REGEXP_CONTAINS({expr}, r'{pattern}')"
        return f"({expr} ~ '{pattern}')"

    text = (
        f"CONCAT(COALESCE({name}, ''), ' ', COALESCE({address}, ''))"
        if dialect == "bigquery"
        else f"(COALESCE({name}, '') || ' ' || COALESCE({address}, ''))"
    )
    addr = f"COALESCE({address}, '')"
    return (
        "(\n"
        "        -- (a) 取り込み時の国。NULL は «分からない» なので日本扱いにする\n"
        f"        COALESCE({country_code}, 'JP') != 'JP'\n"
        "        -- (b) 韓国式の住所（住所欄だけ。店名の 'Lo-ro' で誤爆させない）\n"
        f"        OR {contains(addr, KOREAN_ADDRESS_RE)}\n"
        "        -- (b') ハングル / キリル語。**住所がある行にだけ**当て、\n"
        "        --      日本語の手がかりがある行には当てない\n"
        f"        OR ({addr} != ''\n"
        f"            AND {contains(text, FOREIGN_SCRIPT_RE)}\n"
        f"            AND NOT {contains(text, JAPAN_TEXT_RE)})\n"
        "        -- (c) 国外領域の矩形（«日本を囲う矩形» ではない）。日本領の飛び地は除く\n"
        f"        OR (({_box_sql(latitude, longitude, FOREIGN_TERRITORY_BOXES)})\n"
        f"            AND NOT ({_box_sql(latitude, longitude, JAPAN_ENCLAVE_BOXES)}))\n"
        "      )"
    )


def foreign_store_sql(alias: str = "rc") -> str:
    """`restaurant_catalog` の 1 行が «日本以外の店» かを判定する式を返す。

    どの列が国の根拠になるのかを決めるのはここ 1 箇所だけにする。呼ぶ側
    （9_1_build_sns_dish_media_catalog / 9_2 / 9_1_sync_restaurants / 8_1 / 9_9 監査）は
    列名を書かない。
    """
    return foreign_restaurant_sql(
        name=f"{alias}.name",
        address=f"{alias}.address",
        country_code=f"{alias}.country_code",
        latitude=f"{alias}.latitude",
        longitude=f"{alias}.longitude",
    )
