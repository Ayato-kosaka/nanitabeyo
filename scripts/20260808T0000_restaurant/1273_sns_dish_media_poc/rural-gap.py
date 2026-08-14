#!/usr/bin/env python3
"""#1273 rural-gap: 地方(rural)セル充足率 0% の逆説を実データで切り分ける。

逆説: 供給上限 S は rural の方が高い（urban 14.5% / suburban 27.0% / rural 36.0%、Round3）
のに、需要加重セル充足率は rural 0.0000%。仮説3つを同一データで切り分ける。

  (a) 鳩の巣上限   … 半径1km内にそもそも N 店ない（#1279）。→ 構造的に埋まらない
  (b) 発見不足     … rural 店舗の dish_media 発見率が urban より低い
  (c) カテゴリ不足 … rural 店舗は同定できてもカテゴリが付かない

さらに (3) 現実的な閾値、(2) 既存400chの地域分布を出す。
"""
from __future__ import annotations

import collections
import csv
import json
import math
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from measure_channel_traversal import NameMatcher, normalize_ja, normalize_latin, has_cjk  # noqa: E402
from dish_category_matcher import CategoryMatcher, load_categories  # noqa: E402

FIXTURES = HERE / "fixtures"
OVERTURE = FIXTURES / "overture_jp_food.csv"
OUT = HERE / "out" / "rural-gap.json"

M_PER_DEG_LAT = 111_320.0
M_PER_DEG_LON = 91_000.0     # 北緯35度付近（demand-weighted-coverage.py と同一）
GRID_M = 1000
DENSITY_TIERS = [("urban", 50), ("suburban", 10), ("rural", 0)]
RADIUS_M = 1000
THRESHOLDS = (1, 2, 3, 5)
CACHES = ["out/channel_titles_cache.json", "out/channel_crawl_cache.json"]


def haversine_m(lat1, lon1, lat2, lon2):
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return 2 * 6_371_000 * math.asin(min(1.0, math.sqrt(a)))


# ---------------------------------------------------------------------------
# 母集団（Overture）と tier
# ---------------------------------------------------------------------------

def load_population():
    csv.field_size_limit(10 ** 7)
    rows = []
    with OVERTURE.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            try:
                lat, lon = float(r["latitude"]), float(r["longitude"])
            except (TypeError, ValueError):
                continue
            if not (24 <= lat <= 46 and 122 <= lon <= 154):
                continue
            name = (r.get("name") or "").strip()
            if not name:
                continue
            rows.append({"lat": lat, "lon": lon, "name": name,
                         "loc": (r.get("locality") or "").strip(),
                         "reg": (r.get("region") or "").strip()})
    return rows


def tier_of_factory(pop):
    d2lat = 2000 / M_PER_DEG_LAT
    d2lon = 2000 / M_PER_DEG_LON
    dens = collections.Counter()
    for r in pop:
        dens[(int(r["lat"] / d2lat), int(r["lon"] / d2lon))] += 1

    def tier_of(lat, lon):
        n2 = dens[(int(lat / d2lat), int(lon / d2lon))]
        return next(name for name, lo in DENSITY_TIERS if n2 >= lo)
    return tier_of


def build_anchors(pop, tier_of):
    dlat = GRID_M / M_PER_DEG_LAT
    dlon = GRID_M / M_PER_DEG_LON
    cells = {}
    for r in pop:
        k = (int(r["lat"] / dlat), int(r["lon"] / dlon))
        c = cells.get(k)
        if c is None:
            c = cells[k] = {"n": 0, "slat": 0.0, "slon": 0.0}
        c["n"] += 1
        c["slat"] += r["lat"]
        c["slon"] += r["lon"]
    anchors = []
    for c in cells.values():
        lat, lon = c["slat"] / c["n"], c["slon"] / c["n"]
        anchors.append({"lat": lat, "lon": lon, "n": c["n"], "tier": tier_of(lat, lon)})
    return anchors


class PointIndex:
    """1kmグリッドに点を載せ、半径Rの近傍を返す（Rは1kmまでを想定＝3x3走査）。"""

    def __init__(self, pts, cell_m=1000):
        self.dlat = cell_m / M_PER_DEG_LAT
        self.dlon = cell_m / M_PER_DEG_LON
        self.grid = {}
        for p in pts:
            self.grid.setdefault((int(p[0] / self.dlat), int(p[1] / self.dlon)), []).append(p)

    def nearby(self, lat, lon):
        gi, gj = int(lat / self.dlat), int(lon / self.dlon)
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for p in self.grid.get((gi + di, gj + dj), ()):
                    yield p


# ---------------------------------------------------------------------------
# (a) 鳩の巣上限: 半径1km以内の「母集団店舗数」分布
# ---------------------------------------------------------------------------

def pigeonhole(anchors, pop):
    # #1273 【設計】カテゴリ別セルを N 店で埋めるには、まず半径内に N 店なければ不可能。
    # これは dish_media の有無に一切依存しない構造上限。tier 別に測る。
    idx = PointIndex([(r["lat"], r["lon"]) for r in pop])
    acc = {t: {"cells": 0, "stores": 0.0,
               "cnt_cell": collections.Counter(), "cnt_store": collections.Counter(),
               "nsum": 0} for t, _ in DENSITY_TIERS}
    for a in anchors:
        n_in = 0
        for lat, lon in idx.nearby(a["lat"], a["lon"]):
            if haversine_m(a["lat"], a["lon"], lat, lon) <= RADIUS_M:
                n_in += 1
        t = acc[a["tier"]]
        t["cells"] += 1
        t["stores"] += a["n"]
        t["nsum"] += n_in
        for thr in THRESHOLDS:
            if n_in >= thr:
                t["cnt_cell"][thr] += 1
                t["cnt_store"][thr] += a["n"]
    out = {}
    for tier, t in acc.items():
        out[tier] = {
            "anchor_cells": t["cells"],
            "stores": t["stores"],
            "mean_stores_within_1km": t["nsum"] / max(1, t["cells"]),
            "ceiling_cell_uniform": {str(k): t["cnt_cell"][k] / max(1, t["cells"]) for k in THRESHOLDS},
            "ceiling_store_weighted": {str(k): t["cnt_store"][k] / max(1.0, t["stores"]) for k in THRESHOLDS},
        }
    return out


# ---------------------------------------------------------------------------
# (b)(c) dish_media の再構成と tier 別内訳
# ---------------------------------------------------------------------------

def build_name_coords():
    csv.field_size_limit(10 ** 7)
    coords = {}
    for filename in NameMatcher.DEFAULT_SOURCES:
        path = FIXTURES / filename
        if not path.exists():
            continue
        with path.open(encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                name = (r.get("name") or "").strip()
                if not name:
                    continue
                try:
                    lat, lon = float(r["latitude"]), float(r["longitude"])
                except (TypeError, ValueError, KeyError):
                    continue
                if not (24 <= lat <= 46 and 122 <= lon <= 154):
                    continue
                key = normalize_ja(name) if has_cjk(name) else normalize_latin(name).strip()
                coords.setdefault(key, (lat, lon))
    return coords


def load_cached_videos():
    videos = {}
    st_path = HERE / "out" / "snowball_crawl_state.json"
    chan_of = {}
    if st_path.exists():
        st = json.loads(st_path.read_text(encoding="utf-8"))
        for cid, c in st.get("channels", {}).items():
            for v in c.get("videos", []):
                if v.get("id") and v.get("title"):
                    videos.setdefault(v["id"], {"id": v["id"], "title": v["title"], "ch": cid})
                    chan_of.setdefault(v["id"], cid)
    for rel in CACHES:
        p = HERE / rel
        if not p.exists():
            continue
        cache = json.loads(p.read_text(encoding="utf-8"))
        for c in cache.get("channels", []):
            cid = c.get("channel_id") or c.get("id") or c.get("url") or "?"
            for v in c.get("videos", []):
                if v.get("id") and v.get("title"):
                    videos.setdefault(v["id"], {"id": v["id"], "title": v["title"], "ch": cid})
    return list(videos.values())


def reconstruct(tier_of):
    matcher = NameMatcher()
    load_categories()
    cmatcher = CategoryMatcher()
    coords = build_name_coords()
    videos = load_cached_videos()
    print(f"[input] videos={len(videos):,}", file=sys.stderr)

    matched_any: set[str] = set()          # カテゴリ有無を問わず同定できた店
    matched_with_cat: set[str] = set()     # カテゴリまで付いた店
    pairs: set[tuple[str, str]] = set()
    ch_rest: dict[str, set[str]] = collections.defaultdict(set)
    for v in videos:
        rests = matcher.match_corroborated(v["title"])
        if not rests:
            continue
        cs = cmatcher.match(v["title"])
        for rkey in rests:
            matched_any.add(rkey)
            ch_rest[v.get("ch", "?")].add(rkey)
            if cs:
                matched_with_cat.add(rkey)
                for c in cs:
                    pairs.add((rkey, c["dish_category_id"]))

    def tier_count(keys):
        cnt = collections.Counter()
        for k in keys:
            pos = coords.get(k)
            if pos is None:
                cnt["_nocoord"] += 1
                continue
            cnt[tier_of(pos[0], pos[1])] += 1
        return cnt

    rows = []
    for rkey, cid in pairs:
        pos = coords.get(rkey)
        if pos:
            rows.append((pos[0], pos[1], cid))
    return {
        "rows": rows,
        "matched_any_tier": dict(tier_count(matched_any)),
        "matched_with_cat_tier": dict(tier_count(matched_with_cat)),
        "n_matched_any": len(matched_any),
        "n_matched_with_cat": len(matched_with_cat),
        "pairs": len(pairs),
        "ch_rest": ch_rest,
        "coords": coords,
    }


# ---------------------------------------------------------------------------
# (3) 現実的な閾値: rural の充足率を N=1..5 で
# ---------------------------------------------------------------------------

def fill_rates(anchors, rows):
    idx = PointIndex(rows)
    acc = {}
    for tier, _ in DENSITY_TIERS:
        for thr in THRESHOLDS:
            acc[(tier, thr, "cell_uniform")] = [0.0, 0.0]
            acc[(tier, thr, "store_weighted")] = [0.0, 0.0]
            acc[(tier, thr, "any_cell_uniform")] = [0.0, 0.0]
            acc[(tier, thr, "any_store_weighted")] = [0.0, 0.0]
    n_cat = len(load_categories())
    for a in anchors:
        by_cat = collections.defaultdict(set)
        for lat, lon, cid in idx.nearby(a["lat"], a["lon"]):
            if haversine_m(a["lat"], a["lon"], lat, lon) <= RADIUS_M:
                by_cat[cid].add((lat, lon))
        for thr in THRESHOLDS:
            filled = sum(1 for s in by_cat.values() if len(s) >= thr)
            frac = filled / n_cat
            t = a["tier"]
            acc[(t, thr, "cell_uniform")][0] += frac
            acc[(t, thr, "cell_uniform")][1] += 1
            acc[(t, thr, "store_weighted")][0] += frac * a["n"]
            acc[(t, thr, "store_weighted")][1] += a["n"]
            hit = 1.0 if filled else 0.0
            acc[(t, thr, "any_cell_uniform")][0] += hit
            acc[(t, thr, "any_cell_uniform")][1] += 1
            acc[(t, thr, "any_store_weighted")][0] += hit * a["n"]
            acc[(t, thr, "any_store_weighted")][1] += a["n"]
    out = {}
    for (tier, thr, w), v in acc.items():
        out.setdefault(tier, {}).setdefault(str(thr), {})[w] = v[0] / v[1] if v[1] else 0.0
    return out, n_cat


def main():
    pop = load_population()
    print(f"[pop] {len(pop):,}", file=sys.stderr)
    tier_of = tier_of_factory(pop)
    anchors = build_anchors(pop, tier_of)
    print(f"[anchors] {len(anchors):,}", file=sys.stderr)

    ph = pigeonhole(anchors, pop)
    print("[pigeonhole] done", file=sys.stderr)

    rec = reconstruct(tier_of)
    print(f"[dish_media] rows={len(rec['rows']):,}", file=sys.stderr)

    fills, n_cat = fill_rates(anchors, rec["rows"])

    # 母集団の tier 分布
    pop_tier = collections.Counter(tier_of(r["lat"], r["lon"]) for r in pop)

    # 発見率 = 同定済み店 / 母集団店（tier別）
    disc = {}
    for t, _ in DENSITY_TIERS:
        p = pop_tier[t]
        disc[t] = {
            "population": p,
            "matched_any": rec["matched_any_tier"].get(t, 0),
            "matched_with_cat": rec["matched_with_cat_tier"].get(t, 0),
            "discovery_rate_any": rec["matched_any_tier"].get(t, 0) / p if p else 0.0,
            "discovery_rate_with_cat": rec["matched_with_cat_tier"].get(t, 0) / p if p else 0.0,
            "category_attach_rate": (rec["matched_with_cat_tier"].get(t, 0)
                                     / rec["matched_any_tier"][t]) if rec["matched_any_tier"].get(t) else 0.0,
        }

    # (2) 既存400ch の地域分布: チャンネルごとに同定店の tier 構成を出す
    coords = rec["coords"]
    ch_stats = []
    for cid, keys in rec["ch_rest"].items():
        cnt = collections.Counter()
        for k in keys:
            pos = coords.get(k)
            if pos:
                cnt[tier_of(pos[0], pos[1])] += 1
        tot = sum(cnt.values())
        if tot >= 5:
            ch_stats.append({"channel": cid, "n_rest": tot,
                             "rural": cnt["rural"], "suburban": cnt["suburban"], "urban": cnt["urban"],
                             "rural_share": cnt["rural"] / tot,
                             "nonurban_share": (cnt["rural"] + cnt["suburban"]) / tot})
    ch_stats.sort(key=lambda x: -x["nonurban_share"])
    ch_summary = {
        "channels_with_5plus_identified_stores": len(ch_stats),
        "median_rural_share": sorted(c["rural_share"] for c in ch_stats)[len(ch_stats) // 2] if ch_stats else 0.0,
        "channels_rural_share_ge_20pct": sum(1 for c in ch_stats if c["rural_share"] >= 0.20),
        "channels_rural_share_ge_50pct": sum(1 for c in ch_stats if c["rural_share"] >= 0.50),
        "top20_by_nonurban_share": ch_stats[:20],
    }

    result = {
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "method": {
            "tier": "2kmセル店舗数 >=50 urban / >=10 suburban / それ未満 rural（既存定義と同一）",
            "anchor": "Overture 1kmグリッド占有セル重心",
            "radius_m": RADIUS_M,
            "n_categories": n_cat,
            "pigeonhole": "半径1km以内の母集団店舗数がN未満なら、そのセルはどのカテゴリも構造的に埋まらない",
        },
        "population_by_tier": dict(pop_tier),
        "pigeonhole_ceiling": ph,
        "discovery_by_tier": disc,
        "fill_by_tier_r1000m": fills,
        "channel_geography": ch_summary,
        "dish_media_stats": {"matched_any": rec["n_matched_any"],
                             "matched_with_cat": rec["n_matched_with_cat"],
                             "pairs": rec["pairs"], "rows_with_coords": len(rec["rows"])},
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "channel_geography"},
                     ensure_ascii=False, indent=1)[:6000])


if __name__ == "__main__":
    main()
