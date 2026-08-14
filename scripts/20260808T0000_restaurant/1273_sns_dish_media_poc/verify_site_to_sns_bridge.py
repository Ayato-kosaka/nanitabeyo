#!/usr/bin/env python3
# #1273 【設計】site-to-sns-bridge の目視精度検証用。到達できた SNS 由来画像から
#             無作為15枚を選び、ローカルに落として目視で「料理写真か」を数える。
# #1273 【仕様】画像は検証専用の一時ファイル。判定後に削除する（永続保存はしない）。

import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
mod = importlib.import_module("site-to-sns-bridge".replace("-", "_")) if False else None

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "out", "site-to-sns-bridge.json")
IMGDIR = os.path.join(BASE, "out", "_bridge_imgs")


def main():
    d = json.load(open(OUT))
    pool = []
    for r in d["results"]:
        for c in r.get("image_checks", []):
            if c.get("ok") and min(c.get("w", 0), c.get("h", 0)) >= 200:
                pool.append((r["id"], r["name"], c["url"], c["w"], c["h"]))
    print("reachable_images=%d stores=%d" % (
        len(pool), len({p[0] for p in pool})))
    if not pool:
        print("NO REACHABLE IMAGES - visual verification not applicable")
        return
    random.seed(1273)
    # #1273 【仕様】1店1枚に間引いてから無作為15件（同一店の連投で精度が歪むのを防ぐ）。
    byst = {}
    for p in pool:
        byst.setdefault(p[0], p)
    uniq = list(byst.values())
    random.shuffle(uniq)
    pick = uniq[:15]
    os.makedirs(IMGDIR, exist_ok=True)
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "bridge", os.path.join(BASE, "site-to-sns-bridge.py"))
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    man = []
    for i, (rid, name, url, w, h) in enumerate(pick):
        path = os.path.join(IMGDIR, "v%02d.jpg" % i)
        res = bridge.verify_image(url, save_as=path)
        man.append({"i": i, "id": rid, "name": name, "url": url,
                    "w": w, "h": h, "saved": res.get("ok"), "path": path})
        print(i, name, url[:110], res.get("ok"))
    json.dump(man, open(os.path.join(IMGDIR, "manifest.json"), "w"),
              ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
