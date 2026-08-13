#!/usr/bin/env python3
# #1273 【設計】アイデアDの目視検証用ヘルパー。out/own-website-images.json から
#             「料理画像」と判定した画像を決定的に無作為抽出し、実際にダウンロードして
#             人が（=Claudeが Read で）目視できる形にする。精度を数字で数えるため。
# #1273 【仕様】画像はスクラッチパッドに一時保存するだけでリポジトリには永続保存しない。

import json
import os
import sys
import hashlib
import urllib.parse
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "out", "own-website-images.json")
DST = sys.argv[1] if len(sys.argv) > 1 else "/tmp/dishverify"
N = int(sys.argv[2]) if len(sys.argv) > 2 else 15
UA = "nanitabeyo-research/0.1 (restaurant dish-image feasibility PoC; contact: sharess117@gmail.com)"

os.makedirs(DST, exist_ok=True)
d = json.load(open(SRC))

# #1273 【仕様】判定基準を本体と一致させる: 実取得OK / 短辺300px以上 / 料理語ヒット
picks = []
for r in d["results"]:
    for v in r.get("verified", []):
        if v.get("ok") and min(v.get("w", 0), v.get("h", 0)) >= 300 and v.get("food_word"):
            picks.append((r["name"], r["locality"], r["domain"], v))
            break  # 1店1枚（店をまたいで偏らせない）

# #1273 【設計】SHA-256(店名+URL) 昇順で決定的に上位N件（再現可能な無作為抽出）
picks.sort(key=lambda p: hashlib.sha256((p[0] + p[3]["url"]).encode()).hexdigest())
picks = picks[:N]

manifest = []
for i, (name, loc, dom, v) in enumerate(picks):
    url = v["url"]
    if url.startswith("http://"):
        url = "https://" + url[len("http://"):]
    ext = os.path.splitext(urllib.parse.urlsplit(url).path)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        ext = ".jpg"
    path = os.path.join(DST, "%02d%s" % (i, ext))
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=20) as r:
            open(path, "wb").write(r.read(3_000_000))
        ok = True
    except Exception as e:
        ok = False
        path = None
    manifest.append({
        "i": i, "store": name, "locality": loc, "domain": dom,
        "url": v["url"], "alt": v["alt"], "context": v["context"][:120],
        "w": v["w"], "h": v["h"], "bytes": v["bytes"], "file": path, "downloaded": ok,
    })

json.dump(manifest, open(os.path.join(DST, "manifest.json"), "w"), ensure_ascii=False, indent=1)
for m in manifest:
    print(m["i"], m["store"], "|", m["domain"], "|", m["w"], "x", m["h"], "| alt=", m["alt"][:60], "|", m["file"])
