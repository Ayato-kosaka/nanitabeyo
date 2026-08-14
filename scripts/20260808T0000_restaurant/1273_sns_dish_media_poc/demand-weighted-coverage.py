#!/usr/bin/env python3
"""#1273 Round7: 「全店の何%」ではなく「ユーザーの検索1回あたり何%の枠が埋まるか」を測る

# #1273 【設計】これまでのカバレッジ 48.0% は **全店を等しく数えた** 供給側の指標である。
# nanitabeyo の検索体験は「現在地 → 半径R内 → dish_category ごとに5店舗以上」なので、
# 同じ供給量でも「ユーザーが実際に立つ場所」で加重すると充足率は変わりうる。
# 本スクリプトは分母を絞らない（水増ししない）。全店カバレッジとは **別の指標** として
# area × category セルの充足率を出し、両方を併記する。
#
# # #1273 【仕様】セルの定義
#   area     : Overture 母集団 789,612 店を 1km グリッドに落とした「占有セル」。
#              アンカー座標はセル内店舗の重心。ユーザーは店のある場所に立つ、という前提。
#   category : 134 gate カテゴリ全部（public_dish_categories_134_gate.csv）
#   充足     : アンカーから半径R以内に、そのカテゴリの dish_media を持つ **異なる店舗** が N 件以上
#   R        : 500m / 1km / 2km、N : 1 / 3 / 5
#
# # #1273 【仕様】2通りの加重
#   セル一様 : 占有セルを等しく数える（面積ベース＝地理的な公平さ）
#   店舗加重 : 占有セルを「そのセルの店舗数」で重み付け（ランダムな1店舗の隣に立つユーザー
#              の遭遇確率に比例＝体感値）。分母は全店のままで、絞り込みは一切していない。
#
# # #1273 【設計】現状値と将来値を混同しない
#   現状 : out/*_cache.json の 110,696 本から NameMatcher + CategoryMatcher で再構成した
#          実測の dish_media（7,575店 / 8,619 pair）。これは 400ch 分でしかない。
#   将来 : 全国スイープ完了時。供給上限 S=20.6%（層別 S に category 付与率を掛けて
#          母集団加重が 20.6% になるよう正規化）で頭打ちする決定的シミュレーション。
#          こちらは **推計** であり実測ではない。JSON でも measured / projected を分けている。
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
import math
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

from dish_category_matcher import CategoryMatcher, load_categories
from measure_channel_traversal import NameMatcher, has_cjk, normalize_ja, normalize_latin

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
OVERTURE = FIXTURES / "overture_jp_food.csv"
CATS_CSV = FIXTURES / "public_dish_categories_134_gate.csv"
CACHES = ("out/channel_crawl_cache.json", "out/channel_titles_cache.json")

DENSITY_TIERS = [("urban", 50), ("suburban", 10), ("rural", 0)]  # 2kmセル店舗数の下限
RADII_M = (500, 1000, 2000)
THRESHOLDS = (1, 3, 5)
GRID_M = 1000.0        # アンカーグリッド（1km）
INDEX_M = 2000.0       # dish_media 空間インデックスのセル幅
LAT0 = 35.7
M_PER_DEG_LAT = 111_320.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(LAT0))

S_CEILING = 0.206      # 全国スイープ完了時の供給上限（既知の実測値、#1273）


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """平面近似ではなく素直な球面距離。日本の緯度では誤差は無視できる。"""
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return 2 * 6_371_000 * math.asin(min(1.0, math.sqrt(a)))


# ---------------------------------------------------------------------------
# 1. dish_media の再構成（実測）
# ---------------------------------------------------------------------------

def build_name_coords() -> dict[str, tuple[float, float]]:
    """NameMatcher と同じキーで店名 -> 座標を引けるようにする。

    # #1273 【設計】NameMatcher は辞書に「異なる場所が1つしかない名前」しか残さない
    # （チェーン除外）ので、キー1つに対して座標は1点に定まる。3ソースに重複して載って
    # いる場合は最初に読んだ行の座標を使う（同一店舗なので差は数十m）。
    """
    csv.field_size_limit(10 ** 7)
    coords: dict[str, tuple[float, float]] = {}
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


def load_cached_videos() -> list[dict]:
    """# #1273 【バグ】旧キャッシュ2本だけだと 24,776本（1,449店）しか読めない。
    dish_media の本体は snowball_crawl_state.json の 400ch / 110,696本にある。"""
    videos: dict[str, dict] = {}
    state = HERE / "out" / "snowball_crawl_state.json"
    if state.exists():
        st = json.loads(state.read_text(encoding="utf-8"))
        for c in st.get("channels", {}).values():
            for v in c.get("videos", []):
                if v.get("id") and v.get("title"):
                    videos.setdefault(v["id"], {"id": v["id"], "title": v["title"]})
    for rel in CACHES:
        p = HERE / rel
        if not p.exists():
            continue
        cache = json.loads(p.read_text(encoding="utf-8"))
        for c in cache.get("channels", []):
            for v in c.get("videos", []):
                if v.get("id") and v.get("title"):
                    videos.setdefault(v["id"], {"id": v["id"], "title": v["title"]})
    return list(videos.values())


def reconstruct_dish_media() -> tuple[list[tuple[float, float, str]], dict]:
    """(lat, lon, category_id) の実測 dish_media 行を返す。店舗は distinct key 単位。"""
    matcher = NameMatcher()
    load_categories()
    cmatcher = CategoryMatcher()
    coords = build_name_coords()
    videos = load_cached_videos()
    print(f"[input] videos={len(videos):,} / name-coords={len(coords):,}", file=sys.stderr)

    pairs: set[tuple[str, str]] = set()
    for v in videos:
        rests = matcher.match_corroborated(v["title"])
        if not rests:
            continue
        cs = cmatcher.match(v["title"])
        if not cs:
            continue
        for rkey in rests:
            for c in cs:
                pairs.add((rkey, c["dish_category_id"]))

    rows: list[tuple[float, float, str]] = []
    missing = 0
    for rkey, cid in pairs:
        pos = coords.get(rkey)
        if pos is None:
            missing += 1
            continue
        rows.append((pos[0], pos[1], cid))
    stats = {
        "distinct_pairs": len(pairs),
        "distinct_restaurants": len({k for k, _ in pairs}),
        "pairs_with_coords": len(rows),
        "pairs_missing_coords": missing,
        "restaurants_with_coords": len({(r[0], r[1]) for r in rows}),
    }
    print(f"[dish_media] {stats}", file=sys.stderr)
    return rows, stats


# ---------------------------------------------------------------------------
# 2. アンカー（＝ユーザーが立つ場所）の構築
# ---------------------------------------------------------------------------

def load_population() -> list[dict]:
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
            if not (r.get("name") or "").strip():
                continue
            rows.append({"id": r["id"], "lat": lat, "lon": lon})
    return rows


def build_anchors(pop: list[dict]) -> list[dict]:
    """1kmグリッドの占有セル = アンカー。tier は 2kmセル店舗数で決める（#1273 既存定義と同じ）。"""
    d2lat = 2000 / M_PER_DEG_LAT
    d2lon = 2000 / M_PER_DEG_LON
    dens: collections.Counter = collections.Counter()
    for r in pop:
        dens[(int(r["lat"] / d2lat), int(r["lon"] / d2lon))] += 1

    dlat = GRID_M / M_PER_DEG_LAT
    dlon = GRID_M / M_PER_DEG_LON
    cells: dict[tuple[int, int], dict] = {}
    for r in pop:
        k = (int(r["lat"] / dlat), int(r["lon"] / dlon))
        c = cells.get(k)
        if c is None:
            c = cells[k] = {"n": 0, "slat": 0.0, "slon": 0.0}
        c["n"] += 1
        c["slat"] += r["lat"]
        c["slon"] += r["lon"]

    anchors = []
    for k, c in cells.items():
        lat = c["slat"] / c["n"]
        lon = c["slon"] / c["n"]
        n2 = dens[(int(lat / d2lat), int(lon / d2lon))]
        tier = next(name for name, lo in DENSITY_TIERS if n2 >= lo)
        anchors.append({"lat": lat, "lon": lon, "n": c["n"], "tier": tier})
    return anchors


# ---------------------------------------------------------------------------
# 3. セル充足率の計算
# ---------------------------------------------------------------------------

class MediaIndex:
    """dish_media を 2km グリッドに載せて近傍検索する。"""

    def __init__(self, rows: list[tuple[float, float, str]]) -> None:
        self.dlat = INDEX_M / M_PER_DEG_LAT
        self.dlon = INDEX_M / M_PER_DEG_LON
        self.grid: dict[tuple[int, int], list[tuple[float, float, str]]] = {}
        for lat, lon, cid in rows:
            self.grid.setdefault((int(lat / self.dlat), int(lon / self.dlon)), []).append((lat, lon, cid))

    def nearby(self, lat: float, lon: float, radius_m: float):
        rings = int(radius_m / INDEX_M) + 1
        gy, gx = int(lat / self.dlat), int(lon / self.dlon)
        for dy in range(-rings, rings + 1):
            for dx in range(-rings, rings + 1):
                bucket = self.grid.get((gy + dy, gx + dx))
                if not bucket:
                    continue
                for plat, plon, cid in bucket:
                    if haversine_m(lat, lon, plat, plon) <= radius_m:
                        yield plat, plon, cid


def evaluate(anchors: list[dict], rows: list[tuple[float, float, str]],
             cat_ids: list[str], salience: dict[str, float]) -> dict:
    """半径 × 閾値 × 加重方式 の充足率を一気に出す。"""
    idx = MediaIndex(rows)
    n_cat = len(cat_ids)
    sal_total = sum(salience.get(c, 0.0) for c in cat_ids) or 1.0

    # acc[(radius, thr)][weighting] = [分子, 分母]
    acc: dict = {}
    per_cat: dict = {}          # (radius, thr) -> cat -> 店舗加重で充足したセルの重み
    tier_acc: dict = {}         # (radius, thr, tier, weighting) -> [分子, 分母]
    for radius in RADII_M:
        for thr in THRESHOLDS:
            acc[(radius, thr)] = {"cell_uniform": [0.0, 0.0], "store_weighted": [0.0, 0.0],
                                  "cell_uniform_salience": [0.0, 0.0],
                                  "store_weighted_salience": [0.0, 0.0],
                                  "any_cell_uniform": [0.0, 0.0],
                                  "any_store_weighted": [0.0, 0.0],
                                  "filled_cats_store_weighted": [0.0, 0.0]}
            per_cat[(radius, thr)] = collections.Counter()
            for tier, _ in DENSITY_TIERS:
                for w in ("cell_uniform", "store_weighted"):
                    tier_acc[(radius, thr, tier, w)] = [0.0, 0.0]

    total_w = sum(a["n"] for a in anchors)
    for i, a in enumerate(anchors):
        if i % 20000 == 0:
            print(f"  anchors {i:,}/{len(anchors):,}", file=sys.stderr)
        lat, lon, w, tier = a["lat"], a["lon"], a["n"], a["tier"]
        # 半径最大で一度だけ引き、距離ごとに振り分ける
        found = list(idx.nearby(lat, lon, max(RADII_M)))
        by_radius: dict[int, dict[str, set]] = {r: collections.defaultdict(set) for r in RADII_M}
        if found:
            for plat, plon, cid in found:
                d = haversine_m(lat, lon, plat, plon)
                for radius in RADII_M:
                    if d <= radius:
                        by_radius[radius][cid].add((plat, plon))
        for radius in RADII_M:
            counts = by_radius[radius]
            for thr in THRESHOLDS:
                filled = [c for c, s in counts.items() if len(s) >= thr]
                frac = len(filled) / n_cat
                frac_sal = sum(salience.get(c, 0.0) for c in filled) / sal_total
                A = acc[(radius, thr)]
                A["cell_uniform"][0] += frac
                A["cell_uniform"][1] += 1
                A["store_weighted"][0] += frac * w
                A["store_weighted"][1] += w
                A["cell_uniform_salience"][0] += frac_sal
                A["cell_uniform_salience"][1] += 1
                A["store_weighted_salience"][0] += frac_sal * w
                A["store_weighted_salience"][1] += w
                # # #1273 【設計】「%枠が埋まる」だけでは体感が掴めないので、
                # 「そこに立ったユーザーが少なくとも1カテゴリ使える確率」も出す。
                any_hit = 1.0 if filled else 0.0
                A["any_cell_uniform"][0] += any_hit
                A["any_cell_uniform"][1] += 1
                A["any_store_weighted"][0] += any_hit * w
                A["any_store_weighted"][1] += w
                A["filled_cats_store_weighted"][0] += len(filled) * w
                A["filled_cats_store_weighted"][1] += w
                tier_acc[(radius, thr, tier, "cell_uniform")][0] += frac
                tier_acc[(radius, thr, tier, "cell_uniform")][1] += 1
                tier_acc[(radius, thr, tier, "store_weighted")][0] += frac * w
                tier_acc[(radius, thr, tier, "store_weighted")][1] += w
                for c in filled:
                    per_cat[(radius, thr)][c] += w

    out = {"overall": {}, "by_tier": {}, "by_category": {}, "anchors": len(anchors),
           "store_weight_total": total_w}
    for (radius, thr), A in acc.items():
        key = f"r{radius}m_n{thr}"
        out["overall"][key] = {k: (v[0] / v[1] if v[1] else 0.0) for k, v in A.items()}
    for (radius, thr, tier, w), v in tier_acc.items():
        out["by_tier"].setdefault(f"r{radius}m_n{thr}", {}).setdefault(tier, {})[w] = (
            v[0] / v[1] if v[1] else 0.0)
    for (radius, thr), counter in per_cat.items():
        if (radius, thr) in ((1000, 5), (1000, 1)):
            out["by_category"][f"r{radius}m_n{thr}"] = [
                [c, cnt / total_w] for c, cnt in counter.most_common(20)]
    return out


# ---------------------------------------------------------------------------
# 4. 全国スイープ完了時の推計（**実測ではない**）
# ---------------------------------------------------------------------------

def project_full_sweep(pop: list[dict], anchors: list[dict], measured_rows,
                       cat_ids: list[str], salience: dict[str, float], seed: int = 1273):
    """供給上限 S=20.6% まで伸びた場合の dish_media 分布を決定的に生成する。

    # #1273 【設計】層別の供給率（600店サンプルの実測: urban 23.5% / suburban 34.0% /
    # rural 43.0%）の比率を保ったまま、母集団加重の平均が S=20.6% になるよう正規化する。
    # カテゴリは実測の出現分布からサンプリングし、1店舗あたり平均 m=1.14 カテゴリを与える。
    # 地理とカテゴリの相関（ご当地もの）は再現していないため、ロングテールの地域偏在は
    # この推計では均される（＝ロングテール側にやや楽観的）。
    """
    tier_s = {"urban": 0.235, "suburban": 0.340, "rural": 0.430}
    pop_by_tier = {"urban": 614947, "suburban": 118211, "rural": 56454}
    total_pop = sum(pop_by_tier.values())
    base = sum(tier_s[t] * n for t, n in pop_by_tier.items()) / total_pop
    scale = S_CEILING / base

    d2lat, d2lon = 2000 / M_PER_DEG_LAT, 2000 / M_PER_DEG_LON
    dens: collections.Counter = collections.Counter()
    for r in pop:
        dens[(int(r["lat"] / d2lat), int(r["lon"] / d2lon))] += 1

    cat_freq = collections.Counter(cid for _, _, cid in measured_rows)
    cats = list(cat_freq)
    weights = [cat_freq[c] for c in cats]
    m_extra = 8619 / 7575 - 1.0  # 1店舗あたり追加カテゴリ確率

    rng = random.Random(seed)
    rows: list[tuple[float, float, str]] = []
    n_cov = 0
    for r in pop:
        n2 = dens[(int(r["lat"] / d2lat), int(r["lon"] / d2lon))]
        tier = next(name for name, lo in DENSITY_TIERS if n2 >= lo)
        p = min(1.0, tier_s[tier] * scale)
        h = int(hashlib.sha256(r["id"].encode()).hexdigest()[:12], 16) / 16 ** 12
        if h >= p:
            continue
        n_cov += 1
        chosen = set(rng.choices(cats, weights=weights, k=1))
        if rng.random() < m_extra:
            chosen |= set(rng.choices(cats, weights=weights, k=1))
        for c in chosen:
            rows.append((r["lat"], r["lon"], c))
    print(f"[projection] covered restaurants={n_cov:,} ({n_cov/len(pop):.2%}) "
          f"pairs={len(rows):,}", file=sys.stderr)
    res = evaluate(anchors, rows, cat_ids, salience)
    res["covered_restaurants"] = n_cov
    res["covered_share"] = n_cov / len(pop)
    res["pairs"] = len(rows)
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=HERE / "out" / "demand-weighted-coverage.json")
    ap.add_argument("--skip-projection", action="store_true")
    args = ap.parse_args()

    cats = list(csv.DictReader(CATS_CSV.open(encoding="utf-8")))
    cat_ids = [c["dish_category_id"] for c in cats]
    cat_label = {c["dish_category_id"]: c["label_ja"] for c in cats}
    salience = {c["dish_category_id"]: float(c["market_salience_jp"] or 0) for c in cats}

    rows, dm_stats = reconstruct_dish_media()
    pop = load_population()
    anchors = build_anchors(pop)
    print(f"[anchors] population={len(pop):,} occupied 1km cells={len(anchors):,}", file=sys.stderr)

    measured = evaluate(anchors, rows, cat_ids, salience)
    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "anchor": "Overture 789,612店を1kmグリッド化した占有セルの重心（ユーザーは店のある所に立つ）",
            "cell": "area(半径R円) × dish_category(134固定) の直積。分母を絞る操作は一切していない",
            "fill": "半径R以内にそのカテゴリの dish_media を持つ異なる店舗が N 件以上",
            "weighting": "cell_uniform=占有セル一様 / store_weighted=セル内店舗数で加重（遭遇確率比例）",
            "salience_variant": "134カテゴリを market_salience_jp で加重した版も併記",
            "measured_input": "400ch / 110,696本のキャッシュ済み動画から再構成した実測 dish_media",
        },
        "dish_media_stats": dm_stats,
        "measured": measured,
        "category_labels": cat_label,
    }
    if not args.skip_projection:
        result["projected_full_sweep"] = project_full_sweep(pop, anchors, rows, cat_ids, salience)
        result["projected_full_sweep"]["disclaimer"] = (
            "推計。実測ではない。S=20.6%の供給上限まで層別比率を保って外挿した決定的シミュレーション")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    m = measured["overall"]
    print("\n=== 実測（400ch時点）===", file=sys.stderr)
    for k in sorted(m):
        v = m[k]
        print(f"  {k:14s} cell_uniform={v['cell_uniform']:.3%}  store_weighted={v['store_weighted']:.3%}"
              f"  (salience加重: {v['store_weighted_salience']:.3%})", file=sys.stderr)
    print(f"Saved: {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
