#!/usr/bin/env python3
# #1273 アイデアF: Openverse / Flickr による dish_media 無料Discovery の実測。
#
# #1273 【仕様】検証対象は2つ。
#   (1) Openverse (api.openverse.org) … CC画像の横断検索。APIキー不要、100req/min・10000req/day。
#       Flickr の CC 画像も provider として取り込んでいるので、Flickr CC 分の上位互換になる。
#   (2) Flickr REST API (api.flickr.com/services/rest/) … geo検索が本命だが APIキー必須。
#       キー無しで到達できる公開フィード (services/feeds/geo/) が lat/lon を尊重するかを実測する。
#
# #1273 【設計】カバレッジは必ず out/supply_ceiling_2026-08-13.json の同じ600店で測る。
# 部分集合にする場合は SHA-256(id) の昇順ソートで先頭N件という決定的規則のみを使う。

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import re
import sys
import threading
import time
import unicodedata
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "out"
SAMPLE = OUT / "supply_ceiling_2026-08-13.json"
SLUG = "openverse-flickr"

OPENVERSE = "https://api.openverse.org/v1/images/"
UA = "nanitabeyo-poc/1.0 (+research; contact via github issue 1273)"

# #1273 【仕様】商用利用が可能な CC ライセンスだけを「使える」と数える。
# nanitabeyo は飲食店から対価を得る事業なので NC(非商用) と ND(改変禁止) は採用不可。
# Openverse の license 値は小文字。by-nc/by-nc-sa/by-nc-nd/nd 系を除外する。
COMMERCIAL_OK = {"cc0", "pdm", "by", "by-sa"}


# ---------------------------------------------------------------- 正規化
def normalize_ja(s: str) -> str:
    """全角半角・空白・記号を落として突き合わせ用のキーにする。"""
    s = unicodedata.normalize("NFKC", s or "")
    s = s.lower()
    # #1273 【バグ】過去に「空白除去して部分一致」で偽陽性まみれになった事故がある。
    # ここでは除去するのは空白と一部の飾り記号のみに留め、語そのものは削らない。
    s = re.sub(r"[\s　・･,，.。/／\-–—_'\"“”‘’()（）\[\]【】]+", "", s)
    return s


def has_cjk(s: str) -> bool:
    return any("぀" <= c <= "ヿ" or "一" <= c <= "鿿" for c in s)


# ---------------------------------------------------------------- HTTP
_rate_lock = threading.Lock()
_rate_slots: list[float] = []
RATE_PER_MIN = 85  # #1273 【パフォーマンス】公称100/minに対し安全側で85/min。


def _rate_wait() -> None:
    while True:
        with _rate_lock:
            now = time.time()
            while _rate_slots and now - _rate_slots[0] > 60.0:
                _rate_slots.pop(0)
            if len(_rate_slots) < RATE_PER_MIN:
                _rate_slots.append(now)
                return
            sleep_for = 60.0 - (now - _rate_slots[0]) + 0.05
        time.sleep(max(sleep_for, 0.05))


def get_json(url: str, timeout: int = 30, retries: int = 2) -> dict | None:
    for attempt in range(retries + 1):
        _rate_wait()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            if attempt >= retries:
                print(f"[err] {exc} :: {url[:120]}", file=sys.stderr)
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


# ---------------------------------------------------------------- サンプル
def load_sample(limit: int | None) -> list[dict]:
    data = json.loads(SAMPLE.read_text(encoding="utf-8"))
    rows = [r["restaurant"] for r in data["results"]]
    # #1273 【設計】決定的部分集合: SHA-256(id) の16進文字列でソートして先頭N件。
    rows.sort(key=lambda r: hashlib.sha256(r["id"].encode()).hexdigest())
    return rows[:limit] if limit else rows


# ---------------------------------------------------------------- 判定
def result_text(item: dict) -> str:
    tags = " ".join(t.get("name", "") for t in (item.get("tags") or []))
    return f"{item.get('title') or ''} {tags} {item.get('creator') or ''}"


def judge(store: dict, items: list[dict]) -> list[dict]:
    """店名が画像のタイトル/タグに実際に現れているものだけを候補とする。

    #1273 【仕様】ここで緩めると偽陽性まみれになる。要求は2段:
      1. 正規化した店名（2文字以上、日本語なら3文字以上）がタイトル/タグに含まれること
      2. さらに locality（市区町村）か region が同じテキストに含まれること（裏取り）
    2 を満たさないものは weak として別に数え、目視検証に回す。
    """
    name = store.get("name") or ""
    key = normalize_ja(name)
    min_len = 3 if has_cjk(name) else 4
    if len(key) < min_len:
        return []
    loc = normalize_ja(store.get("locality") or "")
    hits = []
    for it in items:
        txt = normalize_ja(result_text(it))
        if key and key in txt:
            strong = bool(loc) and loc in txt
            hits.append({
                "id": it.get("id"),
                "title": it.get("title"),
                "tags": [t.get("name") for t in (it.get("tags") or [])][:12],
                "license": it.get("license"),
                "license_version": it.get("license_version"),
                "provider": it.get("provider"),
                "foreign_landing_url": it.get("foreign_landing_url"),
                "url": it.get("url"),
                "indexed_on": it.get("indexed_on"),
                "strong": strong,
                "commercial_ok": (it.get("license") or "").lower() in COMMERCIAL_OK,
            })
    return hits


# ---------------------------------------------------------------- 1店の測定
def probe_store(store: dict) -> dict:
    name = store.get("name") or ""
    # #1273 【設計】店名そのものを引用符付きで検索する。地名を足すと Openverse の
    # 索引が小さいため 0 件ばかりになり、上限の測定にならない。まず店名単独で上限を測る。
    q = urllib.parse.quote(f'"{name}"')
    url = f"{OPENVERSE}?q={q}&page_size=20&mature=true"
    data = get_json(url)
    if data is None:
        return {"restaurant": store, "error": "request_failed", "n_results": 0, "hits": []}
    items = data.get("results") or []
    hits = judge(store, items)
    return {
        "restaurant": store,
        "error": None,
        "n_results": data.get("result_count", 0),
        "n_returned": len(items),
        "hits": hits,
        "hit": bool(hits),
        "hit_strong": any(h["strong"] for h in hits),
        "hit_commercial": any(h["commercial_ok"] for h in hits),
    }


# ---------------------------------------------------------------- 補助実測
def probe_generic() -> list[dict]:
    """「料理名 + 地名」検索の件数と鮮度。日本の飲食店由来かどうかの母数を見る。"""
    out = []
    queries = [
        "ramen tokyo", "sushi tokyo", "izakaya osaka", "ラーメン 東京", "寿司 大阪",
        "焼肉", "居酒屋", "japanese restaurant food", "yakitori", "定食",
    ]
    for q in queries:
        data = get_json(f"{OPENVERSE}?q={urllib.parse.quote(q)}&page_size=20&mature=true")
        if not data:
            out.append({"query": q, "error": "request_failed"})
            continue
        items = data.get("results") or []
        years: dict[str, int] = {}
        for it in items:
            y = (it.get("indexed_on") or "")[:4]
            years[y] = years.get(y, 0) + 1
        out.append({
            "query": q,
            "result_count": data.get("result_count"),
            "providers": sorted({it.get("provider") for it in items}),
            "indexed_on_years": years,
            "sample_titles": [it.get("title") for it in items[:5]],
        })
    return out


def probe_flickr_geo() -> dict:
    """#1273 【仕様】Flickr は geo検索が本命。キー無しで到達できる手段があるかを実測する。"""
    res: dict = {}
    # (a) REST API をキー無しで叩く
    rest = get_json(
        "https://api.flickr.com/services/rest/?method=flickr.photos.search"
        "&format=json&nojsoncallback=1&lat=35.6586&lon=139.6973&radius=0.1"
    )
    res["rest_without_key"] = rest
    # (b) 公開 geo フィードが lat/lon を尊重するか。離れた2点を引いて重複を見る。
    def feed(lat: float, lon: float) -> list[str]:
        d = get_json(
            f"https://api.flickr.com/services/feeds/geo/?lat={lat}&lon={lon}"
            "&format=json&nojsoncallback=1"
        )
        return [i.get("link") for i in (d or {}).get("items", [])]

    a = feed(35.6586, 139.6973)   # 渋谷
    b = feed(40.7128, -74.0060)   # ニューヨーク
    overlap = len(set(a) & set(b))
    res["geo_feed"] = {
        "n_shibuya": len(a), "n_nyc": len(b), "overlap": overlap,
        # #1273 【バグ】重複があるということは lat/lon が無視され全世界の新着が返っている、
        # つまりこのフィードでは地理検索にならない、という判定。
        "respects_latlon": overlap == 0 and bool(a) and bool(b),
    }
    return res


# ---------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=600)
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    stores = load_sample(args.limit)
    print(f"[info] stores={len(stores)} (SHA-256順の決定的先頭N件)", file=sys.stderr)

    flickr = probe_flickr_geo()
    print(f"[flickr] {json.dumps(flickr.get('geo_feed'), ensure_ascii=False)}", file=sys.stderr)

    generic = probe_generic()
    print(f"[generic] {len(generic)} queries", file=sys.stderr)

    results: list[dict] = []
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for r in ex.map(probe_store, stores):
            results.append(r)
            done += 1
            if done % 50 == 0:
                nh = sum(1 for x in results if x.get("hit"))
                print(f"[prog] {done}/{len(stores)} hits={nh}", file=sys.stderr)

    n_eval = sum(1 for r in results if r.get("error") is None)
    n_hit = sum(1 for r in results if r.get("hit"))
    n_strong = sum(1 for r in results if r.get("hit_strong"))
    n_comm = sum(1 for r in results if r.get("hit_commercial"))
    payload = {
        "slug": SLUG,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "method": "Openverse /v1/images/ に店名を引用符付きで問い合わせ、"
                  "タイトル/タグに正規化店名が含まれるものを候補、さらに locality 一致を strong とする",
        "sample_source": str(SAMPLE.name),
        "sample_selection": "SHA-256(id) 昇順ソートの先頭N件（決定的）",
        "sample_n": len(stores),
        "n_evaluated": n_eval,
        "n_errors": len(results) - n_eval,
        "n_hit_any": n_hit,
        "n_hit_strong": n_strong,
        "n_hit_commercial_license": n_comm,
        "coverage_pct_any": round(100.0 * n_hit / n_eval, 3) if n_eval else 0.0,
        "coverage_pct_strong": round(100.0 * n_strong / n_eval, 3) if n_eval else 0.0,
        "coverage_pct_commercial": round(100.0 * n_comm / n_eval, 3) if n_eval else 0.0,
        "flickr": flickr,
        "generic_queries": generic,
        "results_with_hits": [r for r in results if r.get("hit")],
        "n_results_total": len(results),
    }
    OUT.mkdir(exist_ok=True)
    (OUT / f"{SLUG}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in payload.items()
                      if k not in ("results_with_hits", "generic_queries", "flickr")},
                     ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
