#!/usr/bin/env python3
"""#1273 収集ルート «search_api»: 汎用 Web 検索 API で instagram 投稿URLを sns_post_raw へ入れる。

4_3（SERPER）と同じ «料理×エリアの検索でアカウント無しの単体投稿を集める» ルートの別プロバイダ版。
Graph API の business_discovery（200 req/時の壁）を通らない検索型ルートで、被覆の穴を面で埋める。

対応プロバイダ（いずれも **無料枠内**・要 API キー。keyless では叩けない）:

    --provider brave   Brave Search API   header X-Subscription-Token: $BRAVE_SEARCH_API_KEY
                       $5/月クレジット ≒ 1000 req/月。q に site:instagram.com を付ける。
    --provider tavily  Tavily Search      header Authorization: Bearer $TAVILY_API_KEY
                       1000 credits/月（basic=1 credit）。include_domains=["instagram.com"]。
    --provider exa     Exa /search        header x-api-key: $EXA_API_KEY
                       $10/月 + 初回 $20（$7/1k）。includeDomains=["instagram.com"]。
    --provider firecrawl / you / linkup / yep（#1273 追加。無料枠は FINDINGS.md 2026-09-03 参照）

#1273 P1 «店起点»（--store-mode）: sns_source_account の未収集 store_branch handle を BQ から読み、
«"@handle"» を include_domains=instagram.com で検索して、その店の投稿を caption 付きで集める。
snippet に handle か店名を含む投稿だけ discovery_seed_place_id を付け（seed-trust）、柱1として数える。

いずれも «一般 Web 検索を instagram.com に絞る» ので、返る URL から /p//reel//tv/ の投稿だけを拾う。
account_id は NULL（単体投稿）。#1273 検索結果の title+snippet を caption として保存し、
resolve へ渡すと IG を取りに行かず店/カテゴリ照合できる（＝大量並列 resolve の入力）。

入力は 4_3 と同形の TSV（--queries-file）で 1 行 1 セル:
    <query>\t<dish_category_id>\t<lat>\t<lng>
lat/lng は省略可（空欄）。query は「ラーメン 渋谷」のような検索語（site: 等は本スクリプトが付ける）。

鍵が無い環境では --help とドライ設計まで（実リクエストは各 provider の env が要る）。
"""

from __future__ import annotations

import argparse
import http.client
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import (PROVIDER_INSTAGRAM, TABLE_POST_RAW, TABLE_POST_RESOLVED,
                        STORE_ID_SQL, STORE_KNOWN_SQL)

LOGGER = logging.getLogger(__name__)

# instagram の投稿 permalink から (type, shortcode) を取り出す。common_sns._IG_SHORTCODE_RE と同義だが
# canonical_url を type ごと（p/reel/tv）に組み直したいので type も捕捉する。
_POST_RE = re.compile(
    r"instagram\.com/(?:[A-Za-z0-9_.]+/)?(p|reel|tv)/([A-Za-z0-9_-]+)", re.IGNORECASE
)

DISCOVERY_ROUTE = "search_api"
IG_DOMAIN = "instagram.com"


def _http_json(req: urllib.request.Request, timeout: float = 30.0) -> dict:
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


# --- provider 別 «クエリ → 結果URLの列» ------------------------------------------------
# 各関数は «そのプロバイダのネイティブ応答» を叩き、結果の生 URL 文字列を列で返す。
# instagram への絞り込み（site: / include_domains）は各関数内で行う。IG 投稿判定は呼び出し側。

def _brave_urls(key: str, q: str, num: int) -> list[str]:
    # site: 演算子は q の中に入れる（Brave は別パラメータではなく q 内の検索演算子を解釈する）。
    full_q = f"{q} site:{IG_DOMAIN}"
    qs = urllib.parse.urlencode(
        {"q": full_q, "count": min(num, 20), "country": "jp", "search_lang": "jp"}
    )
    req = urllib.request.Request(
        f"https://api.search.brave.com/res/v1/web/search?{qs}",
        headers={"X-Subscription-Token": key, "Accept": "application/json"},
        method="GET",
    )
    res = _http_json(req)
    return [
        (r.get("url") or "", _join_text(r.get("title"), r.get("description")))
        for r in ((res.get("web") or {}).get("results") or [])
    ]


def _tavily_urls(key: str, q: str, num: int) -> list[str]:
    body = json.dumps(
        {
            "query": q,
            "include_domains": [IG_DOMAIN],
            "max_results": min(num, 20),
            "search_depth": "basic",  # 1 credit/req。advanced(2 credit)は使わない
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.tavily.com/search",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    res = _http_json(req)
    return [
        (r.get("url") or "", _join_text(r.get("title"), r.get("content")))
        for r in (res.get("results") or [])
    ]


def _exa_urls(key: str, q: str, num: int) -> list[tuple[str, str]]:
    # includeDomains はドメインパスも取れる（instagram.com/p 等）が、reel/tv も拾うため
    # ここではホスト単位で絞り、投稿判定は _POST_RE に任せる。type=keyword で site 検索的に振る舞う。
    body = json.dumps(
        {
            "query": q,
            "includeDomains": [IG_DOMAIN],
            "numResults": min(num, 10),  # base 価格は 10 件まで。超過は課金増なので上限 10
            "type": "fast",  # 現行 API の enum（instant/fast/auto/deep-*）。keyword は無い
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.exa.ai/search",
        data=body,
        headers={"x-api-key": key, "Content-Type": "application/json"},
        method="POST",
    )
    res = _http_json(req)
    return [
        (r.get("url") or "", _join_text(r.get("title"), r.get("text")))
        for r in (res.get("results") or [])
    ]


def _firecrawl_urls(key: str, q: str, num: int) -> list[tuple[str, str]]:
    # #1273 実測（無鍵で HTTP 200・日本語の «料理×エリア» で IG 投稿URLが返る）:
    #   「焼き鳥 米原」→ /p//reel/ 18件, 「ラーメン 渋谷」→ 11件, 「寿司 金沢」→ 8件。
    # 地方セルでも投稿URLが返る（Serper が地方で死んでいた問題を回避）。
    # 鍵は無くても叩けるが keyless は IP/日で低上限。FIRECRAWL_API_KEY（無料・カード不要・
    # 1,000 credits/月）を入れると上限が上がる。あれば Bearer 認証、無ければ keyless で続行。
    body = json.dumps(
        {"query": q, "limit": min(num, 20), "includeDomains": [IG_DOMAIN]}
    ).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(
        "https://api.firecrawl.dev/v2/search", data=body, headers=headers, method="POST",
    )
    res = _http_json(req)
    return [
        (w.get("url") or "", _join_text(w.get("title"), w.get("description")))
        for w in ((res.get("data") or {}).get("web") or [])
    ]


def _you_urls(key: str, q: str, num: int) -> list[tuple[str, str]]:
    # You.com Search API（$100 無料 credit・カード不要・10 rps）。include_domains で instagram.com に絞る。
    # 規約(A12): API キー利用は §2.4.16 の例外で OK。keyless は使わない。
    body = json.dumps(
        {"query": q, "count": min(num, 100), "country": "JP", "language": "JA",
         "include_domains": [IG_DOMAIN]}
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://ydc-index.io/v1/search", data=body,
        headers={"X-API-Key": key, "Content-Type": "application/json"}, method="POST",
    )
    res = _http_json(req)
    out = []
    for r in (((res.get("results") or {}).get("web")) or []):
        snippets = r.get("snippets") or []
        out.append((r.get("url") or "", _join_text(r.get("title"), r.get("description"), *snippets[:2])))
    return out


def _linkup_urls(key: str, q: str, num: int) -> list[tuple[str, str]]:
    # Linkup（4,000 q 無料）。includeDomains で絞り、searchResults で name/url/content を得る。
    # 規約(A12): ToU §4.2 自社製品への統合として保存 OK。
    body = json.dumps(
        {"q": q, "depth": "standard", "outputType": "searchResults",
         "includeDomains": [IG_DOMAIN], "maxResults": min(num, 50)}
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.linkup.so/v1/search", data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, method="POST",
    )
    res = _http_json(req)
    return [
        (r.get("url") or "", _join_text(r.get("name"), r.get("content")))
        for r in (res.get("results") or []) if r.get("type", "text") == "text"
    ]


def _yep_urls(key: str, q: str, num: int) -> list[tuple[str, str]]:
    # Yep Search API（1,000 req 無料・カード不要）。include_domains はカンマ区切りのルートドメイン。
    body = json.dumps(
        {"query": q, "limit": min(num, 20), "include_domains": IG_DOMAIN,
         "language": ["ja"], "location": "JP"}
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://platform.yep.com/api/search", data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, method="POST",
    )
    res = _http_json(req)
    return [
        (r.get("url") or "", _join_text(r.get("title"), r.get("description"), r.get("snippet")))
        for r in (res.get("results") or [])
    ]


def _serper_urls(key: str, q: str, num: int) -> list[tuple[str, str]]:
    """SERPER（google.serper.dev）。**キーが GitHub Secrets に既にある唯一の provider。**

    #1815 他の 4 社（you / tavily / yep / linkup）のキーはこのリポジトリの Secrets に無く、
    CI から使えない。store-mode を CI で回せるのは今のところこれだけなので、4_3 と同じ
    呼び出しをここへも生やす（4_3 は queries-file 専用で store-mode を持たない）。
    無料プランは num>10 を 400 で弾くので 10 に丸める。
    """
    body = json.dumps({"q": f"{q} site:{IG_DOMAIN}", "num": min(num, 10), "gl": "jp", "hl": "ja"}).encode("utf-8")
    req = urllib.request.Request(
        "https://google.serper.dev/search", data=body,
        headers={"X-API-KEY": key, "Content-Type": "application/json"}, method="POST",
    )
    res = _http_json(req)
    return [
        (r.get("link") or "", _join_text(r.get("title"), r.get("snippet")))
        for r in (res.get("organic") or [])
    ]


# provider 名 → (必要な env 変数名, 呼び出し関数)。--provider の値域はこの辞書のキー。
# firecrawl は keyless でも動く（env 未設定を許す）。他は鍵必須。
_PROVIDERS = {
    "brave": ("BRAVE_SEARCH_API_KEY", _brave_urls),
    "tavily": ("TAVILY_API_KEY", _tavily_urls),
    "exa": ("EXA_API_KEY", _exa_urls),
    "firecrawl": ("FIRECRAWL_API_KEY", _firecrawl_urls),
    "you": ("YOU_API_KEY", _you_urls),
    "linkup": ("LINKUP_API_KEY", _linkup_urls),
    "yep": ("YEP_API_KEY", _yep_urls),
    "serper": ("SERPER_API_KEY", _serper_urls),
}
# 鍵が無くても動く provider（keyless 可）。main() の «鍵必須» チェックを免除する。
_KEYLESS_OK = {"firecrawl"}


def _retry_after_seconds(e: urllib.error.HTTPError, body: str) -> float | None:
    """429/5xx の待ち秒数。Retry-After ヘッダ → JSON の retry_after(_seconds) → None。"""
    ra = e.headers.get("Retry-After") if e.headers else None
    if ra:
        try:
            return float(ra)
        except ValueError:
            pass
    m = re.search(r'"retry_after(?:_seconds)?"\s*:\s*([0-9.]+)', body or "")
    return float(m.group(1)) if m else None


_LOOKS_LIKE_QUOTA = re.compile(
    r"usage limit|quota|out of credits|credit limit|exceeded your|plan's set|"
    r"insufficient|no credits|limit reached|upgrade your plan|"
    r"depleted|payment_required|add credit", re.I)


def _fetch_with_retry(fetch, key, q, num, max_retries: int, provider: str):
    """429/5xx は Retry-After（無ければ指数バックオフ）で再試行。日次上限（retry_after が 1h 超）は
    _QuotaExhausted を投げて呼び出し側に «このバッチは打ち切り» を知らせる。4xx（429 以外）は None（スキップ）。

    #1273 実測(A17): 旧実装は 429 で全体 break していたため 2,412 クエリ中 263 本しか走らなかった。
    """
    backoff = 5.0
    for attempt in range(max_retries + 1):
        try:
            return fetch(key, q, num)
        except urllib.error.HTTPError as e:
            try:
                body = e.read().decode("utf-8", "replace")[:500]
            except Exception:
                body = "(応答本文の読み取り失敗)"
            if e.code == 429 or e.code >= 500:
                # #1815 429 の本文が «残高切れ» を言っているなら、待っても回復しない。
                # linkup は INSUFFICIENT_CREDITS を 429 で返すので、リトライで時間を溶かしていた。
                if _LOOKS_LIKE_QUOTA.search(body):
                    LOGGER.warning("%s %s (q=%s) 残高切れ。バッチ打ち切り。body=%s", provider, e.code, q, body)
                    raise _QuotaExhausted(body)
                wait = _retry_after_seconds(e, body)
                if wait is not None and wait > 3600:
                    LOGGER.warning("%s %s (q=%s) retry_after=%.0fs＝日次/月次上限。バッチ打ち切り。body=%s",
                                   provider, e.code, q, wait, body)
                    raise _QuotaExhausted(body)
                if attempt >= max_retries:
                    LOGGER.warning("%s %s (q=%s) リトライ上限。スキップ。body=%s", provider, e.code, q, body)
                    return None
                wait = wait if wait is not None else backoff
                LOGGER.info("%s %s (q=%s) %.1fs 待って再試行 %d/%d", provider, e.code, q, wait, attempt + 1, max_retries)
                time.sleep(min(wait, 600))
                backoff = min(backoff * 2, 120)
                continue
            # #1815 上限切れは 429 だけではない。tavily は **432** に
            # "exceeds your plan's set usage limit" を載せて返す。これを «1 クエリの失敗» と
            # 扱うと、残りの数千クエリを空振りで舐め続けて時間を溶かす（実測でそうなった）。
            # 本文に上限の文言があれば、そのバッチは打ち切る。
            if _LOOKS_LIKE_QUOTA.search(body):
                LOGGER.warning("%s %s (q=%s) 上限切れ。バッチ打ち切り。body=%s", provider, e.code, q, body)
                raise _QuotaExhausted(body)
            LOGGER.warning("%s %s (q=%s) スキップ。body=%s", provider, e.code, q, body)
            return None
        except (urllib.error.URLError, TimeoutError, http.client.HTTPException, OSError) as e:
            # #1815 http.client.RemoteDisconnected は URLError を経由せず素で上がってくることがあり、
            # 17,158 クエリの実行を 1,150 本目で丸ごと落とした。接続系はすべてリトライ対象にする。
            if attempt >= max_retries:
                LOGGER.warning("%s 到達不可 (q=%s): %s。スキップ", provider, q, e)
                return None
            time.sleep(backoff)
            backoff = min(backoff * 2, 120)
    return None


class _QuotaExhausted(Exception):
    """provider の日次/月次上限に当たった（このバッチではもう取れない）。"""


def _join_text(*parts) -> str:
    """検索結果の title / snippet を 1 本のテキストに畳む（None・空は捨てる）。

    #1273 大量並列: この «URL と一緒に返ってくるテキスト» を caption として保存し、
    resolve へ渡すと IG を取りに行かずに店名・料理を照合できる（＝並列の壁を回避）。
    """
    return " ".join(str(p).strip() for p in parts if p and str(p).strip())


def _posts_from_urls(results: list[tuple[str, str]]):
    """(url, text) の列から instagram 投稿 (shortcode, canonical_url, caption) を取り出す。"""
    for link, text in results:
        m = _POST_RE.search(link or "")
        if m:
            kind, code = m.group(1).lower(), m.group(2)
            yield code, f"https://www.instagram.com/{kind}/{code}/", (text or "")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Web 検索 API（brave/tavily/exa）で投稿URLを収集する（ルート search_api・無料枠のみ）"
    )
    p.add_argument("--provider", required=True, choices=sorted(_PROVIDERS), help="使う検索 API")
    p.add_argument("--run-id", default=None)
    p.add_argument("--queries-file", default=None, help="TSV: query<TAB>category_id<TAB>lat<TAB>lng（--store-mode 無しのとき必須）")
    # #1273 P1 «店起点»: IG API を使わず、検索インデックスに «"@handle" site:instagram.com» を投げて
    # その店の投稿を caption 付きで集める（A6/A10 実測: 88% ヒット・13.6 投稿/handle・snippet 日本語 80%）。
    # 対象は sns_source_account の未収集 store_branch（discovery_seed_place_id 付き）。店は place_id で
    # 確定（seed-trust）するので、snippet に handle か店名が含まれる投稿だけ discovery_seed_place_id を
    # 付ける（同名他店・@mention だけの投稿の誤帰属を防ぐ）。
    p.add_argument("--store-mode", action="store_true",
                   help="sns_source_account の未収集 store_branch handle を BQ から読み、店起点で投稿を集める")
    p.add_argument("--account-run-id", default=None, help="--store-mode で読む sns_source_account の run_id（省略時は全 run）")
    # #1273 P2 «3-4 店セル狙い撃ち»: KPI（134 カテゴリ）で 3-4 店しか無いセルの市区町村にある、店名に
    # そのカテゴリ語を含む未使用 catalog 店へ «"店名" 市区町村» を投げる（A1 実測: 店名一致 94%）。
    # 店は place_id で seed-trust、snippet に店名を含む投稿だけ付与。
    p.add_argument("--cell-mode", action="store_true",
                   help="KPI で 3-4 店のセルを埋める店起点クエリを BQ から生成して回す")
    p.add_argument("--cell-min", type=int, default=3, help="--cell-mode: 対象セルの現店数の下限")
    p.add_argument("--cell-max", type=int, default=4, help="--cell-mode: 対象セルの現店数の上限")
    p.add_argument("--shards", type=int, default=1, help="--store-mode の handle 分割数（provider 間で互いに素にする）")
    p.add_argument("--shard", type=int, default=0, help="このバッチの担当シャード [0, shards)")
    # #1273 実測(A17): 10 件→20 件にするだけで投稿ヒットが 1.3→11.9/クエリ。各 provider 関数が
    # 自分の上限（exa 10・firecrawl 20 等）に丸めるので 20 を既定にする。
    p.add_argument("--num", type=int, default=20, help="1 クエリの取得件数（provider 側で上限に丸める）")
    p.add_argument("--max-retries", type=int, default=5, help="429/5xx のリトライ回数（Retry-After を尊重）")
    p.add_argument("--max-queries", type=int, default=None, help="このバッチのクエリ数上限")
    p.add_argument("--query-offset", type=int, default=0, help="queries-file の開始行（CI バッチ分割用。max-queries と併用で file を面で進める）")
    p.add_argument("--sleep-ms", type=int, default=1000, help="呼び出し間隔（無料枠に配慮）")
    p.add_argument("--dry-run", action="store_true", help="API を叩かず入力の読み取りと件数だけ出す")
    # #1815 検索 API のキーはこのリポジトリの GitHub Secrets に無い（オーナーがローカルへ渡した）。
    # BigQuery の書き込み資格情報が無い環境でも走らせられるよう、行を JSONL へ吐く口を用意する。
    # 出力は sns_post_raw の 1 行 1 JSON なので、そのまま BQ へ流し込める。
    p.add_argument("--out-jsonl", default=None,
                   help="BigQuery へ書かず、この JSONL へ行を書く（--queries-file と併用。BQ 資格情報が不要になる）")
    p.add_argument("--load-jsonl", default=None,
                   help="--out-jsonl で書いた JSONL（.gz 可）を sns_post_raw へ投入するだけのモード。"
                        "検索はしない。BQ 資格情報のある環境（CI）で使う")
    return p.parse_args()


def _read_cells(path: Path, max_queries, offset: int = 0):
    """TSV を読む。列は `query / category_id / lat / lng`（以降は省略可）。

    #1815 5・6 列目に `seed_place_id` と `store_name` を置くと、--store-mode と同じ
    seed-trust（snippet がその店を指していれば店を確定）が queries-file でも効く。
    BQ の読み取り資格情報が無い環境（ローカル）で店起点の検索を回すために要る。
    """
    cells, stores = [], []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.rstrip("\n")
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        q = parts[0].strip()
        cat = parts[1].strip() if len(parts) > 1 and parts[1].strip() else None
        lat = float(parts[2]) if len(parts) > 2 and parts[2].strip() else None
        lng = float(parts[3]) if len(parts) > 3 and parts[3].strip() else None
        place = parts[4].strip() if len(parts) > 4 and parts[4].strip() else None
        sname = parts[5].strip() if len(parts) > 5 and parts[5].strip() else None
        if q:
            cells.append((q, cat, lat, lng))
            stores.append({"handle": q.strip('"').lstrip("@").split()[0] if place else "",
                           "place_id": place, "store_name": sname})
    if offset:
        cells, stores = cells[offset:], stores[offset:]
    if max_queries:
        cells, stores = cells[:max_queries], stores[:max_queries]
    return cells, stores


def _read_store_handles(pipeline: BigQueryPipeline, account_run_id, max_queries, offset: int,
                        shards: int, shard: int) -> list[dict]:
    """未収集の店アカ handle（place_id・店名・市区町村付き）を BQ から読む。

    未収集 = sns_post_raw に account_id として 1 投稿も無い handle。FARM_FINGERPRINT(handle) で
    シャード分割し、複数 provider を互いに素な集合で同時に回せる。
    """
    from google.cloud import bigquery
    where = "a.provider = 'instagram' AND a.account_type = 'store_branch' AND a.discovery_seed_place_id IS NOT NULL"
    params = []
    if account_run_id:
        where += " AND a.run_id = @arid"
        params.append(bigquery.ScalarQueryParameter("arid", "STRING", account_run_id))
    if shards > 1:
        where += " AND MOD(ABS(FARM_FINGERPRINT(a.handle)), @shards) = @shard"
        params += [bigquery.ScalarQueryParameter("shards", "INT64", shards),
                   bigquery.ScalarQueryParameter("shard", "INT64", shard)]
    sql = f"""
      WITH acc AS (
        SELECT a.handle, a.discovery_seed_place_id AS place_id
        FROM `{pipeline.table('sns_source_account')}` a
        WHERE {where}
        QUALIFY ROW_NUMBER() OVER (PARTITION BY a.handle ORDER BY a.discovered_at DESC) = 1
      ),
      collected AS (SELECT DISTINCT account_id FROM `{pipeline.table(TABLE_POST_RAW)}` WHERE account_id IS NOT NULL),
      -- BQ は JOIN 条件にサブクエリを置けない（"Unsupported subquery with table in join predicate"）ので CTE に出す
      cat AS (
        SELECT google_place_id, name, address FROM `{pipeline.table('restaurant_catalog')}`
        WHERE run_id = (SELECT run_id FROM `{pipeline.table('restaurant_catalog')}` GROUP BY run_id ORDER BY COUNT(*) DESC LIMIT 1)
      )
      SELECT acc.handle, acc.place_id, c.name AS store_name,
             REGEXP_EXTRACT(c.address, r'(?:{_PREF_ALT})(.+?[市区町村])') AS city
      FROM acc
      LEFT JOIN collected ON collected.account_id = acc.handle
      LEFT JOIN cat c ON c.google_place_id = acc.place_id
      WHERE collected.account_id IS NULL
      ORDER BY acc.handle
      LIMIT {int(max_queries or 1000000)} OFFSET {int(offset or 0)}
    """
    return [dict(r) for r in pipeline.execute(sql, params)]


def _read_cell_targets(pipeline: BigQueryPipeline, max_queries, offset: int, shards: int, shard: int,
                       cell_min: int, cell_max: int) -> list[dict]:
    """KPI（134 カテゴリ）で cell_min〜cell_max 店のセルについて、同市区町村の «店名にカテゴリ語を含む
    未使用 catalog 店» を返す。1 店 1 クエリ。usable の定義・市区町村補完は 7_1 と同じ。"""
    from google.cloud import bigquery
    kpi_path = Path(__file__).resolve().parent / "kpi_dish_categories.json"
    kpi = json.loads(kpi_path.read_text(encoding="utf-8"))["kpi_qids"]  # qid -> label_ja
    sql = f"""
      WITH K AS (SELECT qid, label FROM UNNEST(@kpi_qids) qid WITH OFFSET o JOIN UNNEST(@kpi_labels) label WITH OFFSET o2 ON o = o2),
      latest AS (
        SELECT run_id, provider, post_id, status, google_place_id, dish_category_id
        FROM `{pipeline.table(TABLE_POST_RESOLVED)}`
        QUALIFY ROW_NUMBER() OVER (PARTITION BY run_id, provider, post_id ORDER BY resolved_at DESC) = 1
      ),
      cat AS (
        SELECT google_place_id, name, location,
          REGEXP_EXTRACT(address, r'(?:{_PREF_ALT})(.+?[市区町村])') AS city
        FROM `{pipeline.table('restaurant_catalog')}`
        WHERE run_id = (SELECT run_id FROM `{pipeline.table('restaurant_catalog')}` GROUP BY run_id ORDER BY COUNT(*) DESC LIMIT 1)
      ),
      usable AS (
        SELECT DISTINCT {STORE_ID_SQL} AS place, v.dish_category_id AS c
        FROM latest v JOIN `{pipeline.table(TABLE_POST_RAW)}` r
          ON r.run_id = v.run_id AND r.provider = v.provider AND r.post_id = v.post_id
        WHERE v.dish_category_id IN (SELECT qid FROM K) AND {STORE_KNOWN_SQL}
      ),
      need AS (SELECT u.place, ca.location FROM (SELECT DISTINCT place FROM usable) u JOIN cat ca ON ca.google_place_id = u.place WHERE ca.city IS NULL AND ca.location IS NOT NULL),
      ref AS (SELECT location, city FROM cat WHERE city IS NOT NULL AND location IS NOT NULL),
      nn AS (
        SELECT n.place, r.city, ST_DISTANCE(n.location, r.location) d FROM need n JOIN ref r ON ST_DWITHIN(n.location, r.location, 1500)
        QUALIFY ROW_NUMBER() OVER (PARTITION BY n.place ORDER BY d) = 1
      ),
      cells AS (
        SELECT u.c, COALESCE(ca.city, nn.city) AS city, COUNT(DISTINCT u.place) dsc
        FROM usable u JOIN cat ca ON ca.google_place_id = u.place LEFT JOIN nn ON nn.place = u.place
        WHERE COALESCE(ca.city, nn.city) IS NOT NULL
        GROUP BY u.c, city
        HAVING dsc BETWEEN @cmin AND @cmax
      ),
      cand AS (
        SELECT s.c AS category_id, k.label, s.city, s.dsc, ca.google_place_id AS place_id, ca.name AS store_name
        FROM cells s JOIN K k ON k.qid = s.c
        JOIN cat ca ON ca.city = s.city AND STRPOS(ca.name, k.label) > 0
        LEFT JOIN usable u ON u.place = ca.google_place_id AND u.c = s.c
        WHERE u.place IS NULL
      )
      SELECT * FROM cand
      {"WHERE MOD(ABS(FARM_FINGERPRINT(place_id)), @shards) = @shard" if shards > 1 else ""}
      ORDER BY dsc DESC, city, category_id, place_id
      LIMIT {int(max_queries or 1000000)} OFFSET {int(offset or 0)}
    """
    params = [
        bigquery.ArrayQueryParameter("kpi_qids", "STRING", list(kpi.keys())),
        bigquery.ArrayQueryParameter("kpi_labels", "STRING", list(kpi.values())),
        bigquery.ScalarQueryParameter("cmin", "INT64", cell_min),
        bigquery.ScalarQueryParameter("cmax", "INT64", cell_max),
    ]
    if shards > 1:
        params += [bigquery.ScalarQueryParameter("shards", "INT64", shards),
                   bigquery.ScalarQueryParameter("shard", "INT64", shard)]
    return [dict(r) for r in pipeline.execute(sql, params)]


_PREF_ALT = ("北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|"
             "神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|"
             "大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|"
             "福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県")


def _norm(s: str) -> str:
    return re.sub(r"[\s\u3000・\-−ー~〜()（）「」『』【】]", "", (s or "")).lower()


def _mentions_store(text: str, handle: str, store_name: str | None) -> bool:
    """snippet がその店を指しているか（handle か店名の 3 文字以上の連続一致）。seed-trust の誤付与ガード。"""
    t = _norm(text)
    if handle and handle.lower() in (text or "").lower():
        return True
    n = _norm(store_name or "")
    if len(n) >= 3 and n in t:
        return True
    # 店名が長い場合は先頭 4 文字の一致でも可（«焼肉きんぐ 渋谷店» → «焼肉きんぐ»）
    return len(n) >= 6 and n[:4] in t


def _append_jsonl(out: Path, rows: list[dict]) -> None:
    if not rows:
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("a", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


def _load_jsonl_into_bq(path: Path, run_id: str) -> None:
    """--out-jsonl で書いた行を sns_post_raw へ入れる（検索はしない）。

    #1815 検索 API のキーはローカルにしか無く、BigQuery の書き込み資格情報は CI にしか無い。
    その 2 つが交わらないので «ローカルで採って JSONL、CI で投入» に分けている。
    行の形は同じスクリプトが書いたものなので、ここでは run_id だけ上書きして流す。
    """
    import gzip

    pipeline = BigQueryPipeline()
    opener = gzip.open if path.suffix == ".gz" else open
    rows, seen = [], set()
    with opener(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if r["post_id"] in seen:
                continue
            seen.add(r["post_id"])
            r["run_id"] = run_id
            rows.append(r)
    LOGGER.info("%s から %d 投稿（重複除去後）を読みました", path, len(rows))
    with pipeline.step(run_id, "4_7_load_jsonl", parameters={"path": str(path)}, repo_root=None) as result:
        from google.cloud import bigquery

        ids = sorted(seen)
        for i in range(0, len(ids), 5000):
            pipeline.execute(
                f"DELETE FROM `{pipeline.table(TABLE_POST_RAW)}` WHERE run_id=@rid AND post_id IN UNNEST(@ids)",
                [bigquery.ScalarQueryParameter("rid", "STRING", run_id),
                 bigquery.ArrayQueryParameter("ids", "STRING", ids[i:i + 5000])])
        result["row_count"] = pipeline.load_json_rows(TABLE_POST_RAW, rows) if rows else 0
        LOGGER.info("sns_post_raw に %d 投稿を投入しました", result["row_count"])


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    if args.load_jsonl:
        _load_jsonl_into_bq(Path(args.load_jsonl), run_id)
        return
    env_var, fetch = _PROVIDERS[args.provider]

    stores: list[dict] = []
    if args.store_mode:
        pipeline0 = BigQueryPipeline()
        stores = _read_store_handles(pipeline0, args.account_run_id, args.max_queries, args.query_offset,
                                     args.shards, args.shard)
        # クエリ形 D（A1 実測: 店名一致 94%）に寄せる: «"@handle" site:instagram.com» は handle 経由で
        # 店確定できるので最優先。site: は provider 側の include_domains と二重でも害は無い。
        cells = [(f'"@{st["handle"]}"', None, None, None) for st in stores]
        LOGGER.info("store-mode: 未収集の店アカ %d 件（shard %d/%d, offset %d）", len(cells), args.shard, args.shards, args.query_offset)
    elif args.cell_mode:
        pipeline0 = BigQueryPipeline()
        stores = _read_cell_targets(pipeline0, args.max_queries, args.query_offset, args.shards, args.shard,
                                    args.cell_min, args.cell_max)
        # handle は無いので店名＋市区町村で引く（クエリ形 D）。discovery_category_id に狙いのカテゴリを残す。
        # 店名の全角スペースは検索語の区切りにならないので半角へ（"ランチカフェ　ログ" → "ランチカフェ ログ"）
        cells = [(f'"{" ".join((st["store_name"] or "").split())}" {st["city"]}', st["category_id"], None, None)
                 for st in stores]
        for st in stores:
            st["handle"] = ""
        LOGGER.info("cell-mode: %d-%d 店セル向けの店起点クエリ %d 件（shard %d/%d, offset %d）",
                    args.cell_min, args.cell_max, len(cells), args.shard, args.shards, args.query_offset)
    else:
        if not args.queries_file:
            raise SystemExit("--queries-file か --store-mode のどちらかが要ります")
        cells, file_stores = _read_cells(Path(args.queries_file), args.max_queries, args.query_offset)
        # 5 列目に place_id がある行だけ seed-trust の対象にする
        if any(st["place_id"] for st in file_stores):
            stores = file_stores
    LOGGER.info("%d クエリを %s で引きます（無料枠のみ）", len(cells), args.provider)
    sleep_s = max(args.sleep_ms, 0) / 1000.0

    if args.dry_run:
        # 鍵不要の設計確認。各クエリで叩く URL / body の形だけ確認し、投入はしない。
        for q, cat, lat, lng in cells[:5]:
            LOGGER.info("[dry] provider=%s q=%r cat=%s lat=%s lng=%s", args.provider, q, cat, lat, lng)
        LOGGER.info("[dry] env %s が要ります（keyless 不可）。実投入は --dry-run 無しで。", env_var)
        return

    key = os.getenv(env_var)
    if not key and args.provider not in _KEYLESS_OK:
        raise RuntimeError(f"{env_var} 未設定（db-script-run.yml の secret）。{args.provider} は keyless 不可。")
    if not key:
        LOGGER.info("%s は keyless で実行します（%s 未設定。上限UPは env 設定で）。", args.provider, env_var)

    import contextlib

    pipeline = None if args.out_jsonl else BigQueryPipeline()
    now_iso = utc_now().isoformat()

    step = (contextlib.nullcontext({}) if pipeline is None else pipeline.step(
        run_id,
        "4_7_collect_search_api_posts",
        parameters={"provider": args.provider, "queries": len(cells), "num": args.num},
        repo_root=Path(__file__).resolve().parents[1],
    ))
    with step as result:
        rows = []
        seen = set()
        n_ok = n_skip = n_seeded = 0
        for i, (q, cat, lat, lng) in enumerate(cells):
            st = stores[i] if i < len(stores) else None
            if st is not None and not st.get("place_id"):
                st = None
            try:
                urls = _fetch_with_retry(fetch, key, q, args.num, args.max_retries, args.provider)
            except _QuotaExhausted:
                break
            if urls is None:
                n_skip += 1
                continue
            n_ok += 1
            for code, url, caption in _posts_from_urls(urls):
                seed_place = None
                if st is not None and _mentions_store(caption, st["handle"], st.get("store_name")):
                    seed_place = st["place_id"]
                    n_seeded += 1
                pid = code  # shortcode。4_2/4_3 と同じキーで跨ルート重複を解決
                if pid in seen:
                    continue
                seen.add(pid)
                rows.append(
                    {
                        "post_id": pid,
                        "provider": PROVIDER_INSTAGRAM,
                        "canonical_url": url,
                        # store-mode で店に帰属できた投稿は柱1（store_account）として扱い、seed-trust で店確定。
                        "account_id": (st["handle"] if (seed_place and st.get("handle")) else None),
                        "discovery_route": ("store_account" if seed_place else DISCOVERY_ROUTE),
                        "discovery_method": (f"search_handle:{args.provider}" if args.store_mode
                                             else f"search_cell:{args.provider}" if args.cell_mode else args.provider),
                        "discovery_query": q,
                        "discovery_seed_place_id": seed_place,
                        "discovery_area_lat": lat,
                        "discovery_area_lng": lng,
                        "discovery_category_id": cat,
                        # #1273 検索結果の title+snippet を caption として保存。resolve へ渡すと
                        # IG を取りに行かず店/カテゴリ照合でき、大量並列できる（空なら NULL）。
                        "caption": caption or None,
                        "fetched_at": now_iso,
                        "run_id": run_id,
                    }
                )
            # --out-jsonl は BQ の逐次ロードが使えないぶん、ここで面倒を見る。
            # 末尾一括だと数千クエリぶんが 1 回の失敗で全部飛ぶし、進捗も数字で見えない。
            if pipeline is None and rows and (i + 1) % 50 == 0:
                _append_jsonl(Path(args.out_jsonl), rows)
                LOGGER.info("進捗 %d/%d クエリ・%d 投稿を書き出し", i + 1, len(cells), len(rows))
                rows = []
            if sleep_s:
                time.sleep(sleep_s)

        if pipeline is None:
            _append_jsonl(Path(args.out_jsonl), rows)
            LOGGER.info("%s へ書き終えました（検索 %d クエリ中 成功 %d・スキップ %d）",
                        args.out_jsonl, len(cells), n_ok, n_skip)
            return

        # 同 run 内の重複だけ消してから追記（4_3 と同じ MERGE 的処理）。
        if rows:
            from google.cloud import bigquery

            ids = sorted({r["post_id"] for r in rows})
            pipeline.execute(
                f"DELETE FROM `{pipeline.table(TABLE_POST_RAW)}` "
                f"WHERE run_id=@rid AND post_id IN UNNEST(@ids)",
                [
                    bigquery.ScalarQueryParameter("rid", "STRING", run_id),
                    bigquery.ArrayQueryParameter("ids", "STRING", ids),
                ],
            )
        count = pipeline.load_json_rows(TABLE_POST_RAW, rows) if rows else 0
        result["row_count"] = count
        result["queries_ok"] = n_ok
        result["queries_skipped"] = n_skip
        result["posts_seeded"] = n_seeded
        LOGGER.info(
            "sns_post_raw に %d 投稿を投入しました（%s / 検索 %d クエリ中 成功 %d・スキップ %d）",
            count, args.provider, len(cells), n_ok, n_skip,
        )


if __name__ == "__main__":
    main()
