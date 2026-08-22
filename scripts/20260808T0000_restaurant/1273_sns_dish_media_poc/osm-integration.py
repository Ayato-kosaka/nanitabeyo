#!/usr/bin/env python3
"""#1273 アイデアI: OpenStreetMap を母集団3つ目として統合し、image タグを画像ソースとして評価する。

やること:
  1. geofabrik の japan-latest.osm.pbf から amenity 8業態を抽出し
     fixtures/osm_jp_food.csv を他ソースと同じ列構成で出力する
  2. name / cuisine / website / image / wikimedia_commons の充足率を実測する
  3. OSM の店名のうち Overture にも IFAS にも無いものの件数（母集団増分）
  4. image / wikimedia_commons が dish_media 画像ソースになりうるか
  5. cuisine タグ → 134 dish_category の写像率
  6. out/supply_ceiling_2026-08-13.json の同一600店に対するカバレッジ

実行: python3 osm-integration.py [--pbf /tmp/japan-latest.osm.pbf]
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import pathlib
import random
import re
import sys
import time
import unicodedata

import osmium

HERE = pathlib.Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
OUT = HERE / "out"
SLUG = "osm-integration"

# #1273 【仕様】#843 のコア8業態。これ以外（vending_machine 等）は母集団に入れない。
AMENITIES = {
    "restaurant", "cafe", "fast_food", "bar", "pub",
    "food_court", "ice_cream", "biergarten",
}

# #1273 【設計】画像になりうるタグを全部拾う。image が本命、それ以外は補助。
IMAGE_TAGS = ("image", "wikimedia_commons", "image:0", "panoramax", "mapillary", "wikidata")
SOCIAL_TAGS = (
    "contact:instagram", "contact:facebook", "contact:twitter", "contact:x",
    "contact:line", "contact:youtube", "contact:tiktok",
    "instagram", "facebook", "twitter", "line", "youtube",
)
WEBSITE_TAGS = ("website", "contact:website", "url", "website:menu", "contact:url")

CJK_RE = re.compile(r"[぀-ヿ㐀-䶿一-鿿豈-﫿]")


def has_cjk(text: str) -> bool:
    return bool(CJK_RE.search(text))


def normalize_ja(text: str) -> str:
    """#1273 【仕様】measure_channel_traversal.NameMatcher と同じ正規化。数字を揃えるため複製する。"""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).lower()
    return re.sub(r"[\s　\-‐－—–_,.、。・/／\\|｜!！?？\"'“”'']+", "", text)


def normalize_latin(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).lower()
    return " " + re.sub(r"[^0-9a-z]+", " ", text).strip() + " "


def norm_key(name: str) -> str:
    return normalize_ja(name) if has_cjk(name) else normalize_latin(name).strip()


# ---------------------------------------------------------------- PBF 抽出

def extract_pbf(pbf: pathlib.Path) -> list[dict]:
    """#1273 【パフォーマンス】node location index を使わない2パス方式。

    japan-latest は約2GB / 数億ノードあり、pyosmium の flex_mem インデックスを
    有効にすると数GB〜のRAMと長い時間を食う。飲食POIの way は全体のごく一部なので、
    パス1で「必要なノードID集合」だけを作り、パス2でその座標だけ拾うほうが速い。
    """
    t0 = time.time()
    pois: list[dict] = []
    way_pending: list[tuple[dict, list[int]]] = []
    need_nodes: set[int] = set()

    for obj in osmium.FileProcessor(str(pbf), osmium.osm.NODE | osmium.osm.WAY).with_filter(
        osmium.filter.KeyFilter("amenity")
    ):
        tags = dict(obj.tags)
        if tags.get("amenity") not in AMENITIES:
            continue
        rec = {"osm_type": "node" if obj.is_node() else "way", "osm_id": obj.id, "tags": tags}
        if obj.is_node():
            rec["lat"] = obj.location.lat
            rec["lon"] = obj.location.lon
            pois.append(rec)
        else:
            refs = [n.ref for n in obj.nodes]
            if not refs:
                continue
            way_pending.append((rec, refs))
            need_nodes.update(refs)

    print(f"[pass1] {time.time()-t0:.0f}s nodes={len(pois)} ways={len(way_pending)} "
          f"need_nodes={len(need_nodes)}", file=sys.stderr)

    # パス2: way の構成ノードの座標だけを拾う
    coords: dict[int, tuple[float, float]] = {}
    if need_nodes:
        for obj in osmium.FileProcessor(str(pbf), osmium.osm.NODE):
            if obj.id in need_nodes:
                coords[obj.id] = (obj.location.lat, obj.location.lon)
    print(f"[pass2] {time.time()-t0:.0f}s resolved={len(coords)}/{len(need_nodes)}", file=sys.stderr)

    for rec, refs in way_pending:
        pts = [coords[r] for r in refs if r in coords]
        if not pts:
            continue
        rec["lat"] = sum(p[0] for p in pts) / len(pts)
        rec["lon"] = sum(p[1] for p in pts) / len(pts)
        pois.append(rec)
    return pois


# ---------------------------------------------------------------- 集計

def summarize(pois: list[dict]) -> dict:
    n = len(pois)
    by_amenity = collections.Counter(p["tags"].get("amenity") for p in pois)
    fill = collections.Counter()
    img_examples: list[dict] = []
    cuisine_vals: collections.Counter = collections.Counter()
    for p in pois:
        t = p["tags"]
        if (t.get("name") or t.get("name:ja") or "").strip():
            fill["name"] += 1
        if t.get("cuisine"):
            fill["cuisine"] += 1
            for v in re.split(r"[;,]", t["cuisine"]):
                v = v.strip().lower()
                if v:
                    cuisine_vals[v] += 1
        if any(t.get(k) for k in WEBSITE_TAGS):
            fill["website"] += 1
        if any(t.get(k) for k in SOCIAL_TAGS):
            fill["socials"] += 1
        for k in IMAGE_TAGS:
            if t.get(k):
                fill[k] += 1
        if t.get("image") or t.get("wikimedia_commons"):
            fill["image_or_commons"] += 1
            if len(img_examples) < 40:
                img_examples.append({
                    "osm": f"{p['osm_type']}/{p['osm_id']}",
                    "name": t.get("name") or t.get("name:ja"),
                    "image": t.get("image"),
                    "wikimedia_commons": t.get("wikimedia_commons"),
                })
    return {
        "n_pois": n,
        "by_amenity": dict(by_amenity.most_common()),
        "fill_counts": dict(fill),
        "fill_pct": {k: round(100.0 * v / n, 3) for k, v in fill.items()},
        "top_cuisine": cuisine_vals.most_common(60),
        "n_distinct_cuisine": len(cuisine_vals),
        "image_examples": img_examples,
    }


def write_fixture(pois: list[dict]) -> int:
    """#1273 【仕様】他ソースと同じ列構成で出す。confidence は OSM に相当概念が無いので空。"""
    path = FIXTURES / "osm_jp_food.csv"
    cols = ["id", "name", "latitude", "longitude", "confidence", "basic_category",
            "locality", "region", "n_socials", "n_websites"]
    written = 0
    with path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for p in pois:
            t = p["tags"]
            name = (t.get("name") or t.get("name:ja") or "").strip()
            if "lat" not in p:
                continue
            locality = (t.get("addr:city") or t.get("addr:suburb")
                        or t.get("addr:ward") or t.get("addr:town") or "")
            ns = sum(1 for k in SOCIAL_TAGS if t.get(k))
            nw = sum(1 for k in WEBSITE_TAGS if t.get(k))
            w.writerow([
                f"osm:{p['osm_type']}/{p['osm_id']}", name,
                f"{p['lat']:.7f}", f"{p['lon']:.7f}", "",
                t.get("amenity", ""), locality, t.get("addr:province", "") or t.get("addr:state", ""),
                ns or "", nw or "",
            ])
            written += 1
    return written


def name_novelty(pois: list[dict]) -> dict:
    """#1273 【仕様】IFAS の +27.7% と同じ計算。正規化キー集合の差分で測る。"""
    existing: set[str] = set()
    per_source: dict[str, int] = {}
    csv.field_size_limit(10 ** 7)
    for fn in ("overture_jp_food.csv", "ifas_jp_food.csv"):
        keys = set()
        with (FIXTURES / fn).open(encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                nm = (r.get("name") or "").strip()
                if nm:
                    keys.add(norm_key(nm))
        per_source[fn] = len(keys)
        existing |= keys
    osm_keys = {norm_key(t) for t in
                ((p["tags"].get("name") or p["tags"].get("name:ja") or "").strip() for p in pois) if t}
    osm_keys.discard("")
    new = osm_keys - existing
    return {
        "overture_distinct_names": per_source["overture_jp_food.csv"],
        "ifas_distinct_names": per_source["ifas_jp_food.csv"],
        "baseline_union_distinct_names": len(existing),
        "osm_distinct_names": len(osm_keys),
        "osm_new_names": len(new),
        "osm_new_pct_of_baseline": round(100.0 * len(new) / len(existing), 2),
        "new_name_examples": sorted(random.Random(1273).sample(sorted(new), min(20, len(new)))),
    }


def cuisine_mapping(summary: dict) -> dict:
    """#1273 【仕様】cuisine タグが 134 dish_category にどれだけ写像するか。

    完全一致（label_en の正規化）だけで測る。部分一致は偽陽性を作るので使わない。
    """
    cats = []
    with (FIXTURES / "public_dish_categories_134_gate.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            cats.append((r["dish_category_id"], r["label_en"].strip().lower(), r["label_ja"]))
    by_en = {c[1]: c for c in cats}
    # OSM の cuisine は "_" 区切り。134側は空白区切りなので揃える。
    alias = {c[1].replace(" ", "_"): c for c in cats}
    mapped, unmapped = [], []
    total_pois, mapped_pois = 0, 0
    for val, cnt in summary["top_cuisine"]:
        total_pois += cnt
        hit = by_en.get(val.replace("_", " ")) or alias.get(val) or by_en.get(val)
        if hit:
            mapped.append({"cuisine": val, "n": cnt, "dish_category_id": hit[0], "label_ja": hit[2]})
            mapped_pois += cnt
        else:
            unmapped.append({"cuisine": val, "n": cnt})
    return {
        "note": "top60 cuisine 値のみで評価（残りはロングテール）",
        "n_top_values": len(summary["top_cuisine"]),
        "n_mapped_values": len(mapped),
        "pois_in_top60": total_pois,
        "pois_mapped": mapped_pois,
        "mapped_pct_of_top60_pois": round(100.0 * mapped_pois / total_pois, 2) if total_pois else 0.0,
        "mapped": mapped[:40],
        "unmapped_top": unmapped[:25],
    }


def sample_coverage(pois: list[dict]) -> dict:
    """#1273 【最重要】カバレッジは out/supply_ceiling_2026-08-13.json の同じ600店で測る。

    OSM 側の店名を正規化キーで索引し、同名が複数ある名前はチェーンなので支店を確定できず除外する
    （NameMatcher と同じ規則）。一致後に locality の裏取りを必ず行う。
    """
    sample = json.load(open(OUT / "supply_ceiling_2026-08-13.json"))["results"]
    freq: collections.Counter = collections.Counter()
    for p in pois:
        nm = (p["tags"].get("name") or p["tags"].get("name:ja") or "").strip()
        if nm:
            freq[nork := norm_key(nm)] += 1
    index: dict[str, dict] = {}
    for p in pois:
        nm = (p["tags"].get("name") or p["tags"].get("name:ja") or "").strip()
        if not nm:
            continue
        k = norm_key(nm)
        if freq[k] != 1:
            continue  # チェーン名は支店を確定できない
        index[k] = p

    per: list[dict] = []
    n_name_hit = n_geo_ok = n_with_image = 0
    for row in sample:
        r = row["restaurant"]
        k = norm_key(r["name"])
        p = index.get(k)
        rec = {"id": r["id"], "name": r["name"], "locality": r.get("locality"),
               "tier": r.get("tier"), "osm": None, "geo_km": None,
               "has_image": False, "image_url": None}
        if p:
            n_name_hit += 1
            # 座標での裏取り（同名別店を弾く）。緯度1度=111km の粗い近似で十分。
            dlat = (p["lat"] - r["latitude"]) * 111.0
            dlon = (p["lon"] - r["longitude"]) * 91.0  # 日本の緯度帯での cos 補正
            km = (dlat * dlat + dlon * dlon) ** 0.5
            rec["osm"] = f"{p['osm_type']}/{p['osm_id']}"
            rec["osm_name"] = p["tags"].get("name") or p["tags"].get("name:ja")
            rec["geo_km"] = round(km, 3)
            rec["osm_locality"] = p["tags"].get("addr:city", "")
            if km <= 1.0:
                n_geo_ok += 1
                img = p["tags"].get("image") or p["tags"].get("wikimedia_commons")
                if img:
                    n_with_image = n_with_image + 1
                    rec["has_image"] = True
                    rec["image_url"] = img
            else:
                rec["osm"] = None  # 座標裏取りに落ちたので不一致扱い
        per.append(rec)
    n = len(sample)
    return {
        "sample_n": n,
        "n_name_hit_before_geo": n_name_hit,
        "n_matched_in_osm": n_geo_ok,
        "match_pct": round(100.0 * n_geo_ok / n, 2),
        "n_with_dish_image": n_with_image,
        "coverage_pct": round(100.0 * n_with_image / n, 3),
        "per_restaurant": per,
    }


def probe_images() -> dict:
    """#1273 【仕様】image タグのURLが実際に生きた画像を返すか確かめる。

    タグに文字列が入っていることと、画像が取得できることは別。OSM の image は
    第三者サイトへの素のURLで、リンク切れとライセンス不明が混ざる。
    out/osm-integration.json を読み直して全 image URL を HEAD/GET する。
    """
    import concurrent.futures
    import urllib.request

    data = json.loads((OUT / f"{SLUG}.json").read_text())
    urls = sorted({e["image"] for e in data["summary"]["image_examples"] if e.get("image")})
    # image_examples は先頭40件しか持っていないので fixture ではなく再抽出が要る場合がある。
    def fetch(u: str) -> dict:
        req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 nanitabeyo-poc"})
        try:
            with urllib.request.urlopen(req, timeout=12) as r:
                ct = r.headers.get("Content-Type", "")
                body = r.read(4096)
                return {"url": u, "status": r.status, "content_type": ct,
                        "is_image": ct.startswith("image/"), "bytes_head": len(body)}
        except Exception as exc:  # noqa: BLE001
            return {"url": u, "status": None, "error": f"{type(exc).__name__}: {exc}"[:160],
                    "is_image": False}

    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        res = list(ex.map(fetch, urls))
    ok = sum(1 for r in res if r.get("is_image"))
    return {"n_probed": len(res), "n_live_image": ok,
            "live_pct": round(100.0 * ok / len(res), 1) if res else 0.0, "detail": res}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbf", default="/tmp/japan-latest.osm.pbf")
    ap.add_argument("--probe-images", action="store_true",
                    help="既存の out/<slug>.json を読み、image URL の生死だけ測って追記する")
    args = ap.parse_args()

    if args.probe_images:
        data = json.loads((OUT / f"{SLUG}.json").read_text())
        data["image_url_probe"] = probe_images()
        (OUT / f"{SLUG}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
        print(json.dumps({k: v for k, v in data["image_url_probe"].items() if k != "detail"}))
        return

    pois = extract_pbf(pathlib.Path(args.pbf))
    print(f"[extract] pois={len(pois)}", file=sys.stderr)
    summary = summarize(pois)
    n_written = write_fixture(pois)
    print(f"[fixture] wrote {n_written}", file=sys.stderr)
    result = {
        "slug": SLUG,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pbf": args.pbf,
        "fixture_rows": n_written,
        "summary": summary,
        "name_novelty": name_novelty(pois),
        "cuisine_mapping": cuisine_mapping(summary),
        "sample_coverage": sample_coverage(pois),
    }
    (OUT / f"{SLUG}.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))
    sc = result["sample_coverage"]
    print(json.dumps({k: v for k, v in result.items() if k != "sample_coverage"},
                     ensure_ascii=False)[:2500])
    print(json.dumps({k: v for k, v in sc.items() if k != "per_restaurant"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
