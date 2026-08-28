#!/usr/bin/env python3
"""#1273 — IG 投稿のキャプションから料理カテゴリが何%付くかを測る

## なぜこれが KPI の要なのか

オーナーの新しい KPI は「全国どこでも 132 の料理が 5km 以内に 5 投稿」である。
投稿の総量（推定 6,400 万本）は足りている。足りるかどうかを決めるのは

  (a) その料理を出す店が 5km 以内に IG 付きで居るか  ← measure_geo_dish_coverage.py
  (b) **その店の投稿に、料理カテゴリが付くか**       ← 本スクリプト

`dish_media.dish_id` は必須なので、**カテゴリが付かない投稿は 1 件も入らない。**
ここが 10% なら、6,400 万本は 640 万本になる。**測らずに前へ進めない数字である。**

## 方法

  1. 門を通った店のハンドルを取る（out/fsq_jp_ig_gated.csv.gz と site-to-sns-bridge）
  2. `business_discovery` で 1 ハンドルあたり最大 25 件の media を取る
  3. キャプションに `CategoryMatcher` を当てて dish_category を引く
  4. 投稿単位の付与率と、店単位の「何カテゴリ出せるか」を出す

## レート制限の扱い

`(#4) Application request limit reached` は **is_transient** で、時間を置けば戻る。
前の測定ではここで失敗を重ねたので、**指数バックオフで待ち、途中経過を毎回保存**して
途中から再開できるようにする。急がない。**止まらないことのほうが大事である。**

## この測定が言えないこと

  - **キャプションに料理名が書いてあるか**を見ているだけで、
    **写真に何が写っているか**は見ていない。画像判定は別問題
  - `media` は最新順の 25 件である。店の全投稿の代表とは限らない

実行:
    python3 measure_ig_caption_dish_category.py --handles 120
"""

from __future__ import annotations

import argparse
import collections
import csv
import gzip
import json
import math
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from dish_category_matcher import CategoryMatcher

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
API = "https://graph.facebook.com/v21.0"
STATE = OUT / "ig_caption_category_state.json"


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def creds() -> tuple[str, str]:
    ls = [x.strip() for x in (OUT / ".ig_token").read_text().splitlines() if x.strip()]
    if len(ls) < 2:
        raise SystemExit("out/.ig_token は 1行目トークン / 2行目 IG ユーザーID")
    return ls[0], ls[1]


def call(uid: str, tok: str, handle: str) -> dict:
    fields = (f"business_discovery.username({handle})"
              "{id,username,name,biography,followers_count,media_count,"
              "media.limit(25){id,caption,media_type,permalink,timestamp}}")
    url = f"{API}/{uid}?" + urllib.parse.urlencode({"fields": fields, "access_token": tok})
    try:
        with urllib.request.urlopen(url, timeout=45) as r:
            return {"ok": True, "data": json.loads(r.read())}
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read()).get("error", {})
        except Exception:                                        # noqa: BLE001
            err = {}
        return {"ok": False, "code": err.get("code"),
                "transient": bool(err.get("is_transient")),
                "message": (err.get("message") or "")[:160]}
    except Exception as e:                                       # noqa: BLE001
        return {"ok": False, "code": None, "transient": True, "message": type(e).__name__}


def handles(n: int) -> list[tuple[str, str]]:
    got: list[tuple[str, str]] = []
    p = OUT / "fsq_jp_ig_gated.csv.gz"
    if p.exists():
        with gzip.open(p, "rt", encoding="utf-8") as fh:
            rows = [r for r in csv.reader(fh) if len(r) >= 3 and r[0] != "fsq_place_id"
                    and not r[0].startswith("#")]
        random.Random(20260828).shuffle(rows)
        got = [(r[2], r[1]) for r in rows]
    seen: set = set()
    out = []
    for h, nm in got:
        if h in seen:
            continue
        seen.add(h)
        out.append((h, nm))
        if len(out) >= n:
            break
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--handles", type=int, default=120)
    ap.add_argument("--sleep", type=float, default=6.0)
    a = ap.parse_args()

    tok, uid = creds()
    m = CategoryMatcher()
    st = json.loads(STATE.read_text()) if STATE.exists() else {"rows": [], "errors": {}}
    done = {r["handle"] for r in st["rows"]}

    targets = [x for x in handles(a.handles) if x[0] not in done]
    print(f"対象 {len(targets)} ハンドル（済 {len(done)}）", file=sys.stderr, flush=True)

    back = a.sleep
    for i, (h, store) in enumerate(targets, 1):
        while True:
            res = call(uid, tok, h)
            if res["ok"] or not res.get("transient"):
                break
            back = min(back * 2, 900)
            print(f"    待機 {back:.0f}s ({res.get('message','')[:60]})",
                  file=sys.stderr, flush=True)
            time.sleep(back)
        back = a.sleep
        if not res["ok"]:
            st["errors"][h] = res.get("message")
            print(f"  {i:>4}/{len(targets)} {h:26s} × {res.get('message','')[:50]}",
                  file=sys.stderr, flush=True)
            STATE.write_text(json.dumps(st, ensure_ascii=False))
            time.sleep(a.sleep)
            continue
        bd = (res["data"].get("business_discovery") or {})
        media = ((bd.get("media") or {}).get("data") or [])
        posts = []
        for md in media:
            cap = md.get("caption") or ""
            cats = sorted({c["dish_category_id"] for c in m.match(cap)})
            posts.append({"id": md.get("id"), "has_caption": bool(cap),
                          "caption_len": len(cap), "type": md.get("media_type"),
                          "cats": cats})
        st["rows"].append({"handle": h, "store": store, "name": bd.get("name"),
                           "biography": (bd.get("biography") or "")[:300],
                           "media_count": bd.get("media_count"),
                           "followers": bd.get("followers_count"), "posts": posts})
        STATE.write_text(json.dumps(st, ensure_ascii=False))
        hit = sum(1 for p in posts if p["cats"])
        print(f"  {i:>4}/{len(targets)} {h:26s} 投稿 {len(posts):>2} / カテゴリ付き {hit:>2}"
              f"  [{store[:18]}]", file=sys.stderr, flush=True)
        time.sleep(a.sleep)

    rows = st["rows"]
    allp = [p for r in rows for p in r["posts"]]
    withcap = [p for p in allp if p["has_caption"]]
    hit = [p for p in allp if p["cats"]]
    per_store = [len({c for p in r["posts"] for c in p["cats"]}) for r in rows]
    freq: collections.Counter[str] = collections.Counter(
        c for p in allp for c in p["cats"])
    res = {
        "purpose": "#1273 IG 投稿のキャプションから料理カテゴリが何%付くか",
        "n_handles": len(rows), "n_posts": len(allp),
        "posts_with_caption": len(withcap),
        "caption_rate_pct": round(len(withcap) / len(allp) * 100, 1) if allp else None,
        "posts_with_category": len(hit),
        "category_rate_pct": round(len(hit) / len(allp) * 100, 1) if allp else None,
        "category_rate_ci_pct": [round(x * 100, 1) for x in wilson(len(hit), len(allp))],
        "category_rate_among_captioned_pct":
            round(len(hit) / len(withcap) * 100, 1) if withcap else None,
        "distinct_categories_per_store": {
            "mean": round(sum(per_store) / len(per_store), 2) if per_store else None,
            "median": sorted(per_store)[len(per_store) // 2] if per_store else None},
        "top_categories": freq.most_common(25),
        "errors": st["errors"],
        "caveat": "キャプションの文字列だけを見ている。写真に何が写っているかは未測定。"
                  "media は最新 25 件で、店の全投稿の代表とは限らない",
    }
    (OUT / "ig_caption_dish_category.json").write_text(
        json.dumps(res, ensure_ascii=False, indent=2))
    print(f"\n=== ハンドル {len(rows)} / 投稿 {len(allp)} ===")
    print(f"  キャプションあり  {res['caption_rate_pct']}%")
    print(f"  カテゴリが付いた  {res['category_rate_pct']}% "
          f"CI{res['category_rate_ci_pct']}")
    print(f"  店あたりカテゴリ数 中央値 {res['distinct_categories_per_store']['median']}")
    print("→ out/ig_caption_dish_category.json")


if __name__ == "__main__":
    main()
