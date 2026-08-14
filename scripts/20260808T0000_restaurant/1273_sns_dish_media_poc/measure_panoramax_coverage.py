#!/usr/bin/env python3
"""#1273 街路画像（Panoramax）が母集団の店の前にどれだけ在るか

## なぜ

これまでの供給者は**店本人**と**チェーン本部**と**施設運営者**の3つで、いずれも
「店が外部にリンクを持っているか」または「施設に入っているか」に縛られる。
リンク無し 343,247店（30.31%）に独立に効く経路が要る。

**街路画像**は第三者が公道から撮ったもので、店のリンクの有無と無関係に存在しうる。
日本の飲食店は写真付きメニュー看板・食品サンプルの掲出率が高いので、
店頭が写っていれば料理写真が写り込んでいる可能性がある。

## なぜ Panoramax か（実測して選んだ）

2026-08-14 に3つとも実際に叩いた:

  - **Panoramax** … `https://api.panoramax.xyz/api/search?bbox=` が**トークン無しで200**。
    返る各 feature に `rel="license"` で **CC-BY-SA-4.0** が明示されている。
  - Mapillary  … `graph.mapillary.com` は `Invalid OAuth 2.0 Access Token` で 500。
    **無料だがアカウント作成が要る**ので、オーナーの判断を待つ。ここでは使わない。
  - KartaView  … `api.openstreetcam.org` は 25秒でタイムアウト。使えない。

→ **アカウントを作らずに今すぐ測れるのは Panoramax だけ**なので、これで測る。

## 測るもの（経路存在率だけ）

母集団から SHA-256 順に決定的に標本を抜き、各店の座標の周り **50m 四方**に
Panoramax の画像が1枚以上あるかを数える。リンク有無で層別する。

## この数字が言えないこと

ここで出すのは **「店の前に街路画像が在るか」だけ**である。
**その画像に料理写真が写っているかは一切測っていない。**
実効カバレッジをここから推定してはいけない。写り込みの率は別途、目視で測る。

実行:
    python3 measure_panoramax_coverage.py --sample 400
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_locality_backfill import load_rows  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

API = "https://api.panoramax.xyz/api/search"
UA = "nanitabeyo-research/1.0"
DELAY = 0.6
TIMEOUT = 25
HALF_M = 25.0            # 50m 四方 → 中心から 25m


def bbox_of(lat: float, lon: float) -> str:
    import math
    dlat = HALF_M / 111_320.0
    dlon = HALF_M / (111_320.0 * max(math.cos(math.radians(lat)), 1e-6))
    return f"{lon - dlon:.6f},{lat - dlat:.6f},{lon + dlon:.6f},{lat + dlat:.6f}"


def query(lat: float, lon: float) -> tuple[int, str | None]:
    """(画像枚数, ライセンス) を返す。失敗は (-1, None)。"""
    url = f"{API}?{urllib.parse.urlencode({'bbox': bbox_of(lat, lon), 'limit': 5})}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            d = json.loads(r.read().decode("utf-8", "replace"))
    except Exception:                                        # noqa: BLE001
        return (-1, None)
    feats = d.get("features") or []
    lic = None
    if feats:
        for l in feats[0].get("links") or []:
            if l.get("rel") == "license":
                lic = l.get("href")
                break
    return (len(feats), lic)


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    import math
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 街路画像の被覆率")
    ap.add_argument("--sample", type=int, default=400)
    args = ap.parse_args()

    rows = list(load_rows())
    print(f"母集団 {len(rows):,} 行", file=sys.stderr)
    rows.sort(key=lambda r: hashlib.sha256(
        f"{r['source']}/{r['id']}".encode("utf-8")).hexdigest())
    sample = rows[: args.sample]
    print(f"標本 {len(sample):,}（SHA-256 順）  50m四方を問い合わせる\n", file=sys.stderr)

    hit = {True: 0, False: 0}
    tot = {True: 0, False: 0}
    err = 0
    lics: dict[str, int] = {}
    examples = []
    for i, r in enumerate(sample, 1):
        n, lic = query(r["lat"], r["lon"])
        time.sleep(DELAY)
        if n < 0:
            err += 1
            continue
        k = r["has_link"]
        tot[k] += 1
        if n > 0:
            hit[k] += 1
            if lic:
                lics[lic] = lics.get(lic, 0) + 1
            if len(examples) < 20:
                examples.append({"name": r["name"], "lat": r["lat"], "lon": r["lon"],
                                 "n": n, "license": lic, "has_link": k})
        if i % 50 == 0:
            done = tot[True] + tot[False]
            h = hit[True] + hit[False]
            print(f"  ... {i:,}/{len(sample):,}  在り {h}/{done} = "
                  f"{h / max(done,1)*100:.1f}%  失敗 {err}", file=sys.stderr)

    n_all = tot[True] + tot[False]
    k_all = hit[True] + hit[False]
    lo, hi = wilson(k_all, n_all)
    print(f"\n=== 店の前に街路画像が在る率（50m四方）===", file=sys.stderr)
    print(f"  全体      {k_all:>5}/{n_all:<5} = {k_all/max(n_all,1)*100:>6.2f}%"
          f"  95%CI {lo*100:.2f}-{hi*100:.2f}%", file=sys.stderr)
    for k, lbl in ((True, "リンク有り"), (False, "リンク無し")):
        l2, h2 = wilson(hit[k], tot[k])
        print(f"  {lbl:10}{hit[k]:>5}/{tot[k]:<5} = {hit[k]/max(tot[k],1)*100:>6.2f}%"
              f"  95%CI {l2*100:.2f}-{h2*100:.2f}%", file=sys.stderr)
    print(f"  問い合わせ失敗 {err}", file=sys.stderr)
    print(f"\n  ライセンス: {lics}", file=sys.stderr)
    print(f"\n  ※ これは**街路画像が在るか**だけ。料理写真が写っているかは測っていない。",
          file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "panoramax_coverage.json"
    p.write_text(json.dumps(
        {"provider": "panoramax", "api": API, "box_m": HALF_M * 2,
         "n_sample": len(sample), "n_ok": n_all, "n_error": err,
         "hit": k_all, "rate": k_all / max(n_all, 1), "wilson95": [lo, hi],
         "by_link": {("link" if k else "nolink"): {"n": tot[k], "hit": hit[k],
                                                   "rate": hit[k] / max(tot[k], 1)}
                     for k in (True, False)},
         "licenses": lics, "examples": examples,
         "why_this_provider": "Mapillary はトークン必須(アカウント作成が要る)、"
                              "KartaView はタイムアウト。トークン無しで叩けたのは Panoramax だけ。",
         "caveat": "経路存在率のみ。料理写真の写り込みは一切測っていない。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
