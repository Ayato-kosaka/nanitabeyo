#!/usr/bin/env python3
"""#1273 Round7 の目視精度検証。

# #1273 【設計】本タスクで新しく入った処理は「店名キー -> 座標」の join である。
# 店舗同定とカテゴリ付与の精度は既検証（NameMatcher precision約100%、category 15/15）なので、
# ここでは **座標が本当にその店のものか** を、動画タイトル中の地名と join 先の
# locality/region が一致するかで検証する（座標が違う店のものなら地名がずれる）。
"""
from __future__ import annotations

import csv
import json
import random
from pathlib import Path

from dish_category_matcher import CategoryMatcher
from measure_channel_traversal import NameMatcher, has_cjk, normalize_ja, normalize_latin

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"

csv.field_size_limit(10 ** 7)
info: dict[str, dict] = {}
for fn in NameMatcher.DEFAULT_SOURCES:
    p = FIXTURES / fn
    if not p.exists():
        continue
    with p.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            name = (r.get("name") or "").strip()
            if not name:
                continue
            try:
                lat, lon = float(r["latitude"]), float(r["longitude"])
            except (TypeError, ValueError, KeyError):
                continue
            key = normalize_ja(name) if has_cjk(name) else normalize_latin(name).strip()
            info.setdefault(key, {"name": name, "lat": lat, "lon": lon,
                                  "locality": r.get("locality") or "", "region": r.get("region") or "",
                                  "src": fn})

st = json.loads((HERE / "out" / "snowball_crawl_state.json").read_text(encoding="utf-8"))
videos = []
for c in st["channels"].values():
    for v in c.get("videos", []):
        if v.get("id") and v.get("title"):
            videos.append(v)

m = NameMatcher()
cm = CategoryMatcher()
hits = []
for v in videos:
    rests = m.match_corroborated(v["title"])
    if not rests:
        continue
    cs = cm.match(v["title"])
    if not cs:
        continue
    for rk in rests:
        if rk in info:
            hits.append((v["title"], rk, cs[0]["label_ja"]))

rng = random.Random(1273)
sample = rng.sample(hits, 15)
ok = 0
for i, (title, rk, cat) in enumerate(sample, 1):
    d = info[rk]
    loc = normalize_ja(d["locality"])
    reg = normalize_ja(d["region"])
    t = normalize_ja(title)
    geo_ok = bool((loc and loc in t) or (reg and reg in t))
    ok += geo_ok
    print(f"{i:2d}. [{'OK ' if geo_ok else 'NG '}] {title}")
    print(f"      -> {d['name']} / {d['locality']} {d['region']} ({d['lat']:.4f},{d['lon']:.4f}) "
          f"src={d['src']} cat={cat}")
print(f"\n地名一致（座標join が正しい証拠）: {ok}/{len(sample)} = {ok/len(sample):.1%}")
