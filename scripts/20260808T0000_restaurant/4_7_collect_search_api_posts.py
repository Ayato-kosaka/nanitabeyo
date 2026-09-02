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

いずれも «一般 Web 検索を instagram.com に絞る» ので、返る URL から /p//reel//tv/ の投稿だけを拾う。
account_id は NULL（単体投稿）。caption は保存しない（resolve が URL から取り直す）。

入力は 4_3 と同形の TSV（--queries-file）で 1 行 1 セル:
    <query>\t<dish_category_id>\t<lat>\t<lng>
lat/lng は省略可（空欄）。query は「ラーメン 渋谷」のような検索語（site: 等は本スクリプトが付ける）。

鍵が無い環境では --help とドライ設計まで（実リクエストは各 provider の env が要る）。
"""

from __future__ import annotations

import argparse
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
from common_sns import PROVIDER_INSTAGRAM, TABLE_POST_RAW

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
    return [r.get("url") or "" for r in ((res.get("web") or {}).get("results") or [])]


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
    return [r.get("url") or "" for r in (res.get("results") or [])]


def _exa_urls(key: str, q: str, num: int) -> list[str]:
    # includeDomains はドメインパスも取れる（instagram.com/p 等）が、reel/tv も拾うため
    # ここではホスト単位で絞り、投稿判定は _POST_RE に任せる。type=keyword で site 検索的に振る舞う。
    body = json.dumps(
        {
            "query": q,
            "includeDomains": [IG_DOMAIN],
            "numResults": min(num, 10),  # base 価格は 10 件まで。超過は課金増なので上限 10
            "type": "keyword",
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.exa.ai/search",
        data=body,
        headers={"x-api-key": key, "Content-Type": "application/json"},
        method="POST",
    )
    res = _http_json(req)
    return [r.get("url") or "" for r in (res.get("results") or [])]


def _firecrawl_urls(key: str, q: str, num: int) -> list[str]:
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
    return [w.get("url") or "" for w in ((res.get("data") or {}).get("web") or [])]


# provider 名 → (必要な env 変数名, 呼び出し関数)。--provider の値域はこの辞書のキー。
# firecrawl は keyless でも動く（env 未設定を許す）。他は鍵必須。
_PROVIDERS = {
    "brave": ("BRAVE_SEARCH_API_KEY", _brave_urls),
    "tavily": ("TAVILY_API_KEY", _tavily_urls),
    "exa": ("EXA_API_KEY", _exa_urls),
    "firecrawl": ("FIRECRAWL_API_KEY", _firecrawl_urls),
}
# 鍵が無くても動く provider（keyless 可）。main() の «鍵必須» チェックを免除する。
_KEYLESS_OK = {"firecrawl"}


def _posts_from_urls(urls: list[str]):
    """結果 URL の列から instagram 投稿 (shortcode, canonical_url) を取り出す。"""
    for link in urls:
        m = _POST_RE.search(link or "")
        if m:
            kind, code = m.group(1).lower(), m.group(2)
            yield code, f"https://www.instagram.com/{kind}/{code}/"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Web 検索 API（brave/tavily/exa）で投稿URLを収集する（ルート search_api・無料枠のみ）"
    )
    p.add_argument("--provider", required=True, choices=sorted(_PROVIDERS), help="使う検索 API")
    p.add_argument("--run-id", default=None)
    p.add_argument("--queries-file", required=True, help="TSV: query<TAB>category_id<TAB>lat<TAB>lng")
    p.add_argument("--num", type=int, default=10, help="1 クエリの取得件数（provider の無料枠上限に合わせ 10）")
    p.add_argument("--max-queries", type=int, default=None, help="このバッチのクエリ数上限")
    p.add_argument("--sleep-ms", type=int, default=1000, help="呼び出し間隔（無料枠に配慮）")
    p.add_argument("--dry-run", action="store_true", help="API を叩かず入力の読み取りと件数だけ出す")
    return p.parse_args()


def _read_cells(path: Path, max_queries):
    cells = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.rstrip("\n")
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        q = parts[0].strip()
        cat = parts[1].strip() if len(parts) > 1 and parts[1].strip() else None
        lat = float(parts[2]) if len(parts) > 2 and parts[2].strip() else None
        lng = float(parts[3]) if len(parts) > 3 and parts[3].strip() else None
        if q:
            cells.append((q, cat, lat, lng))
    return cells[:max_queries] if max_queries else cells


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    env_var, fetch = _PROVIDERS[args.provider]

    cells = _read_cells(Path(args.queries_file), args.max_queries)
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

    pipeline = BigQueryPipeline()
    now_iso = utc_now().isoformat()

    with pipeline.step(
        run_id,
        "4_7_collect_search_api_posts",
        parameters={"provider": args.provider, "queries": len(cells), "num": args.num},
        repo_root=Path(__file__).resolve().parents[1],
    ) as result:
        rows = []
        seen = set()
        for q, cat, lat, lng in cells:
            try:
                urls = fetch(key, q, args.num)
            except urllib.error.HTTPError as e:
                try:
                    err_body = e.read().decode("utf-8", "replace")[:500]
                except Exception:
                    err_body = "(応答本文の読み取り失敗)"
                LOGGER.warning("%s %s (q=%s) body=%s。中断します", args.provider, e.code, q, err_body)
                break
            for code, url in _posts_from_urls(urls):
                pid = code  # shortcode。4_2/4_3 と同じキーで跨ルート重複を解決
                if pid in seen:
                    continue
                seen.add(pid)
                rows.append(
                    {
                        "post_id": pid,
                        "provider": PROVIDER_INSTAGRAM,
                        "canonical_url": url,
                        "account_id": None,
                        "discovery_route": DISCOVERY_ROUTE,
                        "discovery_method": args.provider,
                        "discovery_query": q,
                        "discovery_seed_place_id": None,
                        "discovery_area_lat": lat,
                        "discovery_area_lng": lng,
                        "discovery_category_id": cat,
                        "fetched_at": now_iso,
                        "run_id": run_id,
                    }
                )
            if sleep_s:
                time.sleep(sleep_s)

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
        LOGGER.info(
            "sns_post_raw に %d 投稿を投入しました（%s / 検索 %d クエリ）",
            count,
            args.provider,
            len(cells),
        )


if __name__ == "__main__":
    main()
