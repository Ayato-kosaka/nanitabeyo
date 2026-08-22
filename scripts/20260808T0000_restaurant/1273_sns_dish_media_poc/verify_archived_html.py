#!/usr/bin/env python3
# #1273 【仕様】目視精度検証用。archived-html.json の verified 画像から無作為15件を
#             SHA-256(url) 昇順で選び、コンタクトシート1枚に並べて人間（Claude）が目視する。
import hashlib
import io
import json
import os
import urllib.request

from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.abspath(__file__))
SCRATCH = "/tmp/claude-0/-home-user-nanitabeyo/03f6e582-9699-5f1c-87bd-53c206dc6519/scratchpad"
UA = "nanitabeyo-research/0.1 (dish-image PoC; contact: sharess117@gmail.com)"

d = json.load(open(os.path.join(BASE, "out", "archived-html.json"), encoding="utf-8"))
items = []
for r in d["results"]:
    for v in r["verified"]:
        items.append({"store": r["name"], "url": v["url"], "alt": v.get("alt", ""),
                      "sid": r["id"]})
# #1273 【仕様】1店1枚まで（同一店の連番写真で精度が水増しされるのを防ぐ）
seen = set()
uniq = []
for it in sorted(items, key=lambda x: hashlib.sha256(x["url"].encode()).hexdigest()):
    if it["sid"] in seen:
        continue
    seen.add(it["sid"])
    uniq.append(it)
pick = uniq[:15]

TH = 260
cols, rows = 5, 3
sheet = Image.new("RGB", (cols * TH, rows * (TH + 18)), "white")
dr = ImageDraw.Draw(sheet)
meta = []
for i, it in enumerate(pick):
    u = it["url"]
    if u.startswith("http://"):
        u = "https://" + u[7:]
    try:
        req = urllib.request.Request(u, headers={"User-Agent": UA})
        b = urllib.request.urlopen(req, timeout=20).read(3_000_000)
        im = Image.open(io.BytesIO(b)).convert("RGB")
        im.thumbnail((TH, TH))
        x, y = (i % cols) * TH, (i // cols) * (TH + 18)
        sheet.paste(im, (x + (TH - im.width) // 2, y + (TH - im.height) // 2))
        dr.text((x + 3, y + TH + 3), "#%d %s" % (i + 1, it["store"][:22]), fill="black")
        meta.append({"n": i + 1, "store": it["store"], "url": it["url"], "alt": it["alt"][:80]})
    except Exception as e:
        dr.text(((i % cols) * TH + 5, (i // cols) * (TH + 18) + 5),
                "#%d FAIL %s" % (i + 1, type(e).__name__), fill="red")
        meta.append({"n": i + 1, "store": it["store"], "url": it["url"], "error": str(e)[:80]})

os.makedirs(SCRATCH, exist_ok=True)
p = os.path.join(SCRATCH, "archived_html_sheet.png")
sheet.save(p)
print(p)
print(json.dumps(meta, ensure_ascii=False, indent=1))
print("pool_verified_images=%d pool_stores=%d picked=%d" % (len(items), len(uniq), len(pick)))
