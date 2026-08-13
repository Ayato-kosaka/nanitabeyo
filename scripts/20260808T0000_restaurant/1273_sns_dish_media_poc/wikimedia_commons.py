#!/usr/bin/env python3
"""#1273 Round4 アイデアE: Wikimedia Commons / Wikidata の画像で dish_media を賄えるか

Commons は CC ライセンスなので商用利用が可能（表示義務あり）。日本の個店の
「その店の料理写真」がどれだけ収録されているかを、他アイデアと同じ無作為600店で実測する。

測る経路は3つ:
  A) 地理検索 list=geosearch（半径100m, ns=6）… 本命。店名を知らなくても座標で拾える
  B) 全文検索 list=search（srsearch=店名, ns=6）… 店名一致
  C) Wikidata の飲食店エンティティ（P18=image を持つもの）を1本のSPARQLで全部落として
     600店と座標+店名で突合

判定は3段階に分ける。ここを混ぜると「渋谷の道路写真が渋谷の焼鳥屋の料理写真」に化ける:
  1. any_photo_nearby   … 半径100mに何らかの画像がある（＝その店の写真とは限らない）
  2. store_matched      … 画像タイトル/説明に**その店の名前**が入っている
  3. dish_photo         … store_matched のうち、目視で**料理**が写っていると確認できたもの

実行:
    python3 wikimedia_commons.py --limit 600
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from measure_channel_traversal import has_cjk, normalize_ja, normalize_latin  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
SAMPLE = OUT / "supply_ceiling_2026-08-13.json"

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
WD_SPARQL = "https://query.wikidata.org/sparql"
# #1273 【仕様】Wikimedia の API 利用規約は User-Agent に連絡先を要求する。
UA = "nanitabeyo-1273-poc/1.0 (https://github.com/nanitabeyo; sharess117@gmail.com)"

GEO_RADIUS_M = 100
# #1273 【設計】店名一致の閾値は measure_channel_traversal.py の事故（空白除去の部分一致で
# 偽陽性まみれ）を踏まえ、日本語3文字以上・ラテンは語境界つき5文字以上とする。
MIN_JA = 3
MIN_LATIN = 5
STOPWORDS = {
    "食堂", "カフェ", "レストラン", "居酒屋", "喫茶店", "ラーメン", "そば", "うどん",
    "寿司", "すし", "焼肉", "定食", "弁当", "cafe", "bar", "restaurant", "coffee",
    "コーヒー", "ダイニング", "キッチン", "ビストロ", "食事処", "お食事処", "スナック",
}
# #1273 【仕様】料理写真かどうかのタイトル語彙。目視分類の**前段の当たりをつける**ためだけに
# 使い、最終判定は必ず目視で行う（自動分類の数字を実測として報告しない）。
DISH_WORDS = ["料理", "ラーメン", "麺", "丼", "寿司", "鮨", "そば", "うどん", "定食", "カレー",
              "ケーキ", "パン", "ドリンク", "コーヒー", "ビール", "食事", "弁当", "刺身", "天ぷら",
              "ramen", "sushi", "soba", "udon", "curry", "food", "dish", "noodle", "cuisine",
              "meal", "cake", "coffee", "beer", "lunch", "dinner", "bento", "tempura", "donburi"]


def http_json(url: str, retries: int = 3) -> dict:
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            if i == retries - 1:
                return {"__error__": f"{type(exc).__name__}: {exc}"}
            time.sleep(1.5 * (i + 1))
    return {"__error__": "unreachable"}


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def name_keys(name: str) -> list[str]:
    """店名から一致に使えるキーを作る。短すぎる・一般名詞すぎるものは捨てる。"""
    keys = []
    for part in re.split(r"[\s　/／|｜]+", name):
        part = part.strip()
        if not part:
            continue
        if has_cjk(part):
            k = normalize_ja(part)
            if len(k) >= MIN_JA and k not in {normalize_ja(s) for s in STOPWORDS}:
                keys.append(("ja", k))
        else:
            k = normalize_latin(part)
            if len(k.strip()) >= MIN_LATIN and k.strip() not in {normalize_latin(s).strip() for s in STOPWORDS}:
                keys.append(("la", k))
    # 店名全体もキーにする（分割で落ちる短い名前を救う）
    if has_cjk(name):
        k = normalize_ja(name)
        if len(k) >= MIN_JA and k not in {normalize_ja(s) for s in STOPWORDS}:
            keys.append(("ja", k))
    else:
        k = normalize_latin(name)
        if len(k.strip()) >= MIN_LATIN:
            keys.append(("la", k))
    return list(dict.fromkeys(keys))


def title_matches(name: str, text: str) -> bool:
    """画像タイトル/説明に店名が含まれるか。日本語は部分一致、ラテンは語境界一致。"""
    if not text:
        return False
    t_ja = normalize_ja(text)
    t_la = normalize_latin(text)
    for kind, key in name_keys(name):
        if kind == "ja" and key and key in t_ja:
            return True
        if kind == "la" and key and key in t_la:
            return True
    return False


def geosearch(lat: float, lon: float, radius: int = GEO_RADIUS_M) -> dict:
    q = urllib.parse.urlencode({
        "action": "query", "format": "json", "formatversion": "2",
        "list": "geosearch", "gscoord": f"{lat}|{lon}",
        "gsradius": str(radius), "gslimit": "100", "gsnamespace": "6",
    })
    return http_json(f"{COMMONS_API}?{q}")


def textsearch(name: str, locality: str) -> dict:
    q = urllib.parse.urlencode({
        "action": "query", "format": "json", "formatversion": "2",
        "list": "search", "srsearch": f"{name} {locality}".strip(),
        "srnamespace": "6", "srlimit": "20",
    })
    return http_json(f"{COMMONS_API}?{q}")


def fetch_wikidata_restaurants() -> list[dict]:
    """#1273 【パフォーマンス】600回SPARQLを投げず、日本の飲食系エンティティで
    P18(image) を持つものを1本で全部落として手元で突合する。"""
    # #1273 【パフォーマンス】初版は wdt:P31/wdt:P279* の推移閉包を使ったが WDQS が60秒で
    # タイムアウトした。VALUES で直接の P31 に限定すると23秒で返る。
    query = """
    SELECT ?item ?itemLabel ?lat ?lon ?img WHERE {
      ?item wdt:P17 wd:Q17 ; wdt:P18 ?img ; wdt:P625 ?coord ; wdt:P31 ?cls .
      VALUES ?cls { wd:Q11707 wd:Q30022 wd:Q4830453 wd:Q838948 wd:Q27686
                    wd:Q2360219 wd:Q187456 wd:Q1043639 wd:Q5307 wd:Q1057767 }
      BIND(geof:latitude(?coord) AS ?lat) BIND(geof:longitude(?coord) AS ?lon)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
    }
    """
    # #1273 【バグ】WDQS は障害中で 1req/min の 429 を返すことがある。取れた結果は
    # out/ にキャッシュし、429 のときはキャッシュから読む（実測値であることは変わらない）。
    cache = OUT / "wikidata_jp_food_p18_cache.json"
    url = f"{WD_SPARQL}?{urllib.parse.urlencode({'query': query, 'format': 'json'})}"
    data = http_json(url, retries=2)
    if "__error__" in data:
        print(f"[wikidata] live error: {data['__error__']} -> cache", file=sys.stderr)
        if not cache.exists():
            return []
        data = json.loads(cache.read_text(encoding="utf-8"))
    else:
        cache.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    rows = []
    for b in data.get("results", {}).get("bindings", []):
        try:
            rows.append({
                "qid": b["item"]["value"].rsplit("/", 1)[-1],
                "label": b.get("itemLabel", {}).get("value", ""),
                "lat": float(b["lat"]["value"]), "lon": float(b["lon"]["value"]),
                "image": b["img"]["value"],
            })
        except Exception:  # noqa: BLE001
            continue
    return rows


def fetch_licenses(titles: list[str]) -> dict[str, dict]:
    """ヒットしたファイルのライセンスと説明を取る（imageinfo extmetadata）。"""
    out: dict[str, dict] = {}
    for i in range(0, len(titles), 40):
        chunk = titles[i:i + 40]
        q = urllib.parse.urlencode({
            "action": "query", "format": "json", "formatversion": "2",
            "titles": "|".join(chunk), "prop": "imageinfo|coordinates",
            "iiprop": "url|extmetadata", "iiurlwidth": "320",
        })
        data = http_json(f"{COMMONS_API}?{q}")
        for page in data.get("query", {}).get("pages", []):
            ii = (page.get("imageinfo") or [{}])[0]
            em = ii.get("extmetadata", {}) or {}
            coords = (page.get("coordinates") or [{}])[0]
            out[page.get("title", "")] = {
                "license": em.get("LicenseShortName", {}).get("value", ""),
                "license_url": em.get("LicenseUrl", {}).get("value", ""),
                "artist": re.sub(r"<[^>]+>", "", em.get("Artist", {}).get("value", ""))[:120],
                "description": re.sub(r"<[^>]+>", "", em.get("ImageDescription", {}).get("value", ""))[:300],
                "categories": em.get("Categories", {}).get("value", "")[:400],
                "thumb": ii.get("thumburl", ""),
                "url": ii.get("descriptionurl", ""),
                "lat": coords.get("lat"), "lon": coords.get("lon"),
            }
        time.sleep(0.1)
    return out


def looks_like_dish(text: str) -> bool:
    t = text.lower()
    return any(w in t for w in DISH_WORDS)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=600)
    ap.add_argument("--workers", type=int, default=10)
    args = ap.parse_args()

    sample = json.load(SAMPLE.open(encoding="utf-8"))["results"]
    # #1273 【仕様】部分集合を取る場合も他アイデアと合算できるよう、id の SHA-256 で
    # 決定的にソートして先頭N件を使う。
    sample.sort(key=lambda r: hashlib.sha256(r["restaurant"]["id"].encode()).hexdigest())
    sample = sample[:args.limit]
    print(f"[sample] n={len(sample)}", file=sys.stderr)

    wd = fetch_wikidata_restaurants()
    print(f"[wikidata] JP飲食エンティティ with P18: {len(wd)}", file=sys.stderr)

    def work(rec: dict) -> dict:
        r = rec["restaurant"]
        lat, lon, name = r["latitude"], r["longitude"], r["name"]
        loc = r.get("locality") or ""
        res = {"id": r["id"], "name": name, "locality": loc, "tier": r.get("tier"),
               "lat": lat, "lon": lon, "geo_n": 0, "geo_error": None,
               "geo_name_hits": [], "text_n": 0, "text_hits": [], "text_error": None,
               "wd_hits": []}

        g = geosearch(lat, lon)
        if "__error__" in g:
            res["geo_error"] = g["__error__"]
        else:
            items = g.get("query", {}).get("geosearch", [])
            res["geo_n"] = len(items)
            for it in items:
                if title_matches(name, it.get("title", "")):
                    res["geo_name_hits"].append({"title": it["title"], "dist": it.get("dist")})

        s = textsearch(name, loc)
        if "__error__" in s:
            res["text_error"] = s["__error__"]
        else:
            items = s.get("query", {}).get("search", [])
            res["text_n"] = len(items)
            for it in items:
                blob = it.get("title", "") + " " + re.sub(r"<[^>]+>", "", it.get("snippet", ""))
                if title_matches(name, it.get("title", "")) or title_matches(name, blob):
                    res["text_hits"].append({"title": it["title"], "snippet_matched": True})

        for e in wd:
            if haversine_m(lat, lon, e["lat"], e["lon"]) <= 150 and title_matches(name, e["label"]):
                res["wd_hits"].append(e)
        return res

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        results = list(ex.map(work, sample))
    print(f"[commons] {len(results)} 店 / {time.time()-t0:.0f}s", file=sys.stderr)

    # ヒットしたファイルのライセンス・説明を引く
    hit_titles = sorted({h["title"] for r in results for h in r["geo_name_hits"]} |
                        {h["title"] for r in results for h in r["text_hits"]})
    meta = fetch_licenses(hit_titles) if hit_titles else {}

    n = len(results)
    n_geo_any = sum(1 for r in results if r["geo_n"] > 0)
    n_geo_named = sum(1 for r in results if r["geo_name_hits"])
    n_text = sum(1 for r in results if r["text_hits"])
    n_wd = sum(1 for r in results if r["wd_hits"])
    n_matched = sum(1 for r in results if r["geo_name_hits"] or r["text_hits"] or r["wd_hits"])

    lic: dict[str, int] = {}
    for m in meta.values():
        lic[m.get("license") or "(unknown)"] = lic.get(m.get("license") or "(unknown)", 0) + 1

    matched = [r for r in results if r["geo_name_hits"] or r["text_hits"] or r["wd_hits"]]
    inspect = []
    for r in matched:
        for h in (r["geo_name_hits"] + r["text_hits"]):
            m = meta.get(h["title"], {})
            inspect.append({
                "store": r["name"], "locality": r["locality"], "store_lat": r["lat"], "store_lon": r["lon"],
                "file": h["title"], "dist_m": h.get("dist"),
                "file_lat": m.get("lat"), "file_lon": m.get("lon"),
                "license": m.get("license"), "artist": m.get("artist"),
                "description": m.get("description"), "categories": m.get("categories"),
                "url": m.get("url"), "thumb": m.get("thumb"),
                "auto_dish_guess": looks_like_dish(
                    h["title"] + " " + (m.get("description") or "") + " " + (m.get("categories") or "")),
            })

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "idea": "E: Wikimedia Commons / Wikidata",
        "sample_source": str(SAMPLE.name),
        "sample_size": n,
        "geo_radius_m": GEO_RADIUS_M,
        "wikidata_jp_food_entities_with_image": len(wd),
        "counts": {
            "any_photo_within_100m": n_geo_any,
            "geosearch_store_name_matched": n_geo_named,
            "textsearch_store_name_matched": n_text,
            "wikidata_entity_matched": n_wd,
            "store_matched_any_route": n_matched,
        },
        "pct": {
            "any_photo_within_100m": round(100 * n_geo_any / n, 2),
            "store_matched_any_route": round(100 * n_matched / n, 2),
        },
        "license_breakdown_of_matched_files": lic,
        "errors": {"geo": sum(1 for r in results if r["geo_error"]),
                   "text": sum(1 for r in results if r["text_error"])},
        "inspect_list": inspect,
        "results": results,
    }
    outp = OUT / "wikimedia-commons.json"
    outp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: payload[k] for k in
                      ("sample_size", "counts", "pct", "license_breakdown_of_matched_files",
                       "wikidata_jp_food_entities_with_image", "errors")},
                     ensure_ascii=False, indent=1))
    print(f"[out] {outp}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
