#!/usr/bin/env python3
"""#1345 Bluesky は「リンクに依存しない店名起点の経路」として足せるのか

## なぜ

天井を決めているのは到達可能性の恒等式である。

    0.6969 × r_L + 0.3031 × r_N = 0.70

r_L（リンク層）は自社サイト経路が頭打ちで 38.20% が上限と実測済み。
残るのは **r_N（リンク無し層）を上げる**しかない。現在 r_N に入っているのは
YouTube 26.0% と Misskey 12.67% だけである。

Bluesky は **`api.bsky.app` の `app.bsky.feed.searchPosts` が認証不要で 200 を返す**
（本測定の直前に実測）。日本語圏に規模があり、投稿に画像が付く。
**まだ一度も測っていない無料経路**なので、r_N に足せるかを確かめる。

【注意】`public.api.bsky.app` は 403 を返す。`api.bsky.app` を使うこと。
プロキシの `recentRelayFailures` は空だったので、403 は Bluesky 側の判断である。

## 測りかた（Misskey・YouTube と揃える）

違う標本や緩い基準で測ると「足せるか」が判断できないので、**完全に同じにする**。

- 標本: `out/seed_strata_sample.json`（リンク有無で2層化・各150店）
- 判定: `measure_misskey_ceiling.judge_note` と同じ思想。
  店名が本文に出現し、かつ**画像が添付されている**こと。
  短い店名は市区町村名の裏取りを必須にする（#1310 の規則）。
- 直列＋間隔をあけて叩く。**欠測ゼロを速度より優先する**
  （Misskey で並列3にしたら 300 件中 153 件が 429 で落ち、標本の半分が欠測した）

## この測定が言えないこと

  - **経路存在率であって実効ではない。** 写っているのが料理か、料理カテゴリが付くかは別
  - **権利処理は別。** Bluesky の投稿画像をそのまま使ってよいとは言っていない
  - 検索は Bluesky の索引に依存する。索引外の投稿は取りこぼす（**下限**）

実行:
    python3 measure_bluesky_ceiling.py --limit 20 --delay 1.2
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_supply_ceiling import (  # noqa: E402
    MIN_NAME_LEN_FOR_SUBSTRING,
    core_name,
    normalize,
)

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
SEED_CACHE = OUT_DIR / "seed_strata_sample.json"

# #1345 【仕様】public.api.bsky.app は 403。api.bsky.app が認証不要で応答する。
ENDPOINT = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts"
UA = "nanitabeyo-research/1.0 (dish-media feasibility PoC)"


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def search(q: str, limit: int, timeout: float) -> tuple[list[dict], str | None]:
    url = f"{ENDPOINT}?q={urllib.parse.quote(q)}&limit={limit}"
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA,
                                                       "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read()).get("posts") or [], None
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503):
                time.sleep(2 ** attempt * 2)      # 指数バックオフ
                continue
            return [], f"http_{e.code}"
        except Exception as e:                                   # noqa: BLE001
            if attempt == 3:
                return [], type(e).__name__
            time.sleep(2 ** attempt)
    return [], "retry_exhausted"


def judge(name: str, locality: str, posts: list[dict]) -> dict:
    """Misskey 版と同じ判定。画像が無い投稿はヒットにしない。"""
    nm = normalize(name)
    core = normalize(core_name(name))
    loc = normalize(locality)

    best = None
    n_with_image = 0
    for p in posts:
        emb = p.get("embed") or {}
        imgs = emb.get("images") or []
        # record 側の埋め込み（引用つき投稿）も見る
        if not imgs:
            media = (emb.get("media") or {})
            imgs = media.get("images") or []
        has_image = bool(imgs)
        if has_image:
            n_with_image += 1
        text = normalize((p.get("record") or {}).get("text") or "")
        for needle, kind in ((nm, "full_name"), (core, "core_name")):
            if not needle or needle not in text:
                continue
            if len(needle) < MIN_NAME_LEN_FOR_SUBSTRING and not (loc and loc in text):
                continue
            if not has_image:
                continue
            if best is None:
                best = {"uri": p.get("uri"), "evidence": kind,
                        "n_images": len(imgs),
                        "short_name_corroborated_by_locality":
                            len(needle) < MIN_NAME_LEN_FOR_SUBSTRING,
                        "text": ((p.get("record") or {}).get("text") or "")[:120]}
    return {"hit": best is not None, "best_match": best,
            "n_results": len(posts), "n_with_image": n_with_image}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--delay", type=float, default=1.2)
    ap.add_argument("--timeout", type=float, default=30.0)
    ap.add_argument("--n", type=int, default=0, help="各層の件数（0 で全部）")
    args = ap.parse_args()

    if not SEED_CACHE.exists():
        print("**seed_strata_sample.json が無い。数字を出さない。**", file=sys.stderr)
        raise SystemExit(2)
    d = json.loads(SEED_CACHE.read_text(encoding="utf-8"))
    strata = d["sample"]
    pop = d["strata_population"]

    result = {}
    for layer, label in (("with_overture", "リンクあり"),
                         ("without_overture", "リンク無し")):
        rows = strata[layer]
        if args.n:
            rows = rows[: args.n]
        hits = miss = 0
        detail = []
        for i, s in enumerate(rows, 1):
            q = f"{s['name']} {s['locality']}".strip()
            posts, err = search(q, args.limit, args.timeout)
            time.sleep(args.delay)
            if err:
                miss += 1
                detail.append({"name": s["name"], "error": err})
                continue
            j = judge(s["name"], s["locality"], posts)
            hits += j["hit"]
            detail.append({"name": s["name"], "locality": s["locality"], **j})
            if i % 25 == 0:
                print(f"  [{label}] {i}/{len(rows)}  ヒット {hits}  欠測 {miss}",
                      file=sys.stderr)
        n = len(rows) - miss
        if n <= 0:
            print(f"**{label} が全件欠測。数字を出さない。**", file=sys.stderr)
            raise SystemExit(2)
        lo, hi = wilson(hits, n)
        print(f"\n  **{label}** 判定できた {n}/{len(rows)}（欠測 {miss}）", file=sys.stderr)
        print(f"    経路存在率 **{hits}/{n} = {hits/n*100:.2f}%** "
              f"95%CI [{lo*100:.1f}, {hi*100:.1f}]", file=sys.stderr)
        result[layer] = {"label": label, "n_sample": len(rows), "n_judged": n,
                         "n_missing": miss, "hits": hits, "rate": hits / n,
                         "ci": [lo, hi], "detail": detail}

    # r_N への効き（YouTube 26.0% / Misskey 12.67% との独立仮定・上限）
    yt, mk = 0.2600, 0.1267
    bs = result["without_overture"]["rate"]
    union_before = 1 - (1 - yt) * (1 - mk)
    union_after = 1 - (1 - yt) * (1 - mk) * (1 - bs)
    w_l, w_n = pop["with_overture"], pop["without_overture"]
    tot = w_l + w_n
    print(f"\n=== リンク無し層への効き（独立仮定＝上限）===", file=sys.stderr)
    print(f"  YouTube 26.00% + Misskey 12.67%        = {union_before*100:.2f}%",
          file=sys.stderr)
    print(f"  **+ Bluesky {bs*100:.2f}%               = {union_after*100:.2f}%**"
          f"（+{(union_after-union_before)*100:.2f}pt）", file=sys.stderr)
    need_before = (0.70 - union_before * w_n / tot) / (w_l / tot)
    need_after = (0.70 - union_after * w_n / tot) / (w_l / tot)
    print(f"\n  70% に要るリンク層カバレッジ "
          f"{need_before*100:.2f}% → **{need_after*100:.2f}%**（実測上限 38.20%）",
          file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "bluesky_ceiling.json"
    p.write_text(json.dumps({
        "endpoint": ENDPOINT, "layers": result,
        "r_n_union_before": union_before, "r_n_union_after": union_after,
        "r_l_required_before": need_before, "r_l_required_after": need_after,
        "caveat": "経路存在率であって実効ではない（料理が写っているか・カテゴリが付くかは別）。"
                  "権利処理は別で、そのまま使ってよいとは言っていない。"
                  "Bluesky の検索索引に依存するので下限である。"
                  "独立仮定での合成なので、重なりがあれば上限より小さくなる。",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
