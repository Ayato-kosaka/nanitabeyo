#!/usr/bin/env python3
# #1273 【仕様】openverse-flickr.py の hit を人が読める形で出し、真陽性数を目視で数えるための補助。
# 無作為15件を固定seedで抽出する（再現性のため random.Random(1273)）。
import json
import pathlib
import random
import sys

OUT = pathlib.Path(__file__).resolve().parent / "out"
d = json.loads((OUT / "openverse-flickr.json").read_text(encoding="utf-8"))
hits = d["results_with_hits"]
print(f"hit stores = {len(hits)} / evaluated {d['n_evaluated']}  ({d['coverage_pct_any']}%)")
print(f"strong(locality裏取りあり) = {d['n_hit_strong']}  commercial可ライセンス = {d['n_hit_commercial_license']}")
print("=" * 78)
rng = random.Random(1273)
n = int(sys.argv[1]) if len(sys.argv) > 1 else 15
for r in rng.sample(hits, min(n, len(hits))):
    st = r["restaurant"]
    print(f"\n■ 店: {st['name']} / {st.get('locality')} / tier={st.get('tier')}")
    for h in r["hits"][:3]:
        print(f"   - title : {h['title']}")
        print(f"     tags  : {h['tags']}")
        print(f"     lic   : {h['license']} {h['license_version']}  provider={h['provider']} "
              f"strong={h['strong']} commercial_ok={h['commercial_ok']}")
        print(f"     url   : {h['foreign_landing_url']}  indexed={h['indexed_on'][:10]}")
