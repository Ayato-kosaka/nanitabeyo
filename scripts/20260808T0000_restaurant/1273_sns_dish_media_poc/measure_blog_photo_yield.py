#!/usr/bin/env python3
"""#1344 ブログ記事に**料理写真が実際にあるのか**、1記事あたり何枚か

## なぜ（ブログの funnel で唯一残っていた段）

Shorts は実効まで測った（16.29店/ch × カテゴリ 89.13% × 料理が写っている 87.5%
= 12.7店/ch）。**ブログは同じ段を測っていない。**

いま frontier ではブログの実効係数を **0.00**（許諾が 0/97）としているが、
これは規約の話であって、**そもそも使える写真があるのか**は別に測るべきである。

  - 1記事に料理写真が何枚あるか → **1許諾あたりの価値**が決まる
  - 写真が無い（文字だけ）なら、許諾を取りに行く意味自体が無い

オーナーの「問い合わせて無料でできるならいい」という判断材料になる。

## 測るもの

既に巡回したブログの記事URLから決定的標本を取り、HTMLを取り直して

  1. 記事本文の中の `<img>` の数（ナビ・サイドバー・広告・アイコンを除く）
  2. **実際に画像を落として目視**し、料理が写っているかを数える

### 本文の中の画像だけを数える決め方（明記する）

  - `header` / `footer` / `nav` / `aside` を落とす
  - パスに `icon` / `logo` / `avatar` / `banner` / `ad` / `button` / `emoji` /
    `blogmura` / `blogranking` を含むものを落とす（ランキングバナー対策）
  - 拡張子が画像で、`width`/`height` 属性が明示 100px 未満のものを落とす

**これは下限側の刈り込みである**（本文画像も一部落ちうる）。

## この測定が言えないこと

  - 写真があることと**使ってよいこと**は別（許諾は 0/97）
  - サムネ的な小さい画像を落としているので**下限**
  - 目視は決定的標本の 24枚だけ

実行:
    python3 measure_blog_photo_yield.py --articles 60
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import urljoin, urlparse

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
TEXT_DIR = OUT_DIR / "_blog_text"
IMG_DIR = OUT_DIR / "_blog_imgs"
UA = "Mozilla/5.0 (compatible; nanitabeyo-research/1.0)"

_CHROME = re.compile(r"(?is)<(header|footer|nav|aside)[^>]*>.*?</\1>")
_SCRIPT = re.compile(r"(?is)<(script|style)[^>]*>.*?</\1>")
_IMG = re.compile(r"<img[^>]+>", re.I)
_SRC = re.compile(r'(?:src|data-src|data-original)=["\']([^"\']+)["\']', re.I)
_WH = re.compile(r'(?:width|height)=["\']?(\d+)', re.I)
_JUNK = re.compile(
    r"(icon|logo|avatar|banner|/ad[s_/]|button|emoji|blogmura|blogranking|"
    r"with2|profile|spacer|blank|1x1|pixel|badge|rss|twitter|facebook|line)", re.I)
_IMGEXT = re.compile(r"\.(jpe?g|png|webp|gif)(\?|$)", re.I)


def get(u: str, timeout: int = 18) -> bytes | None:
    try:
        req = urllib.request.Request(u, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(600_000)
    except Exception:                                        # noqa: BLE001
        return None


def body_images(html: str, base: str) -> list[str]:
    h = _CHROME.sub(" ", _SCRIPT.sub(" ", html))
    out = []
    for tag in _IMG.findall(h):
        m = _SRC.search(tag)
        if not m:
            continue
        u = urljoin(base, m.group(1))
        if _JUNK.search(u) or not _IMGEXT.search(u):
            continue
        wh = [int(x) for x in _WH.findall(tag)]
        if wh and max(wh) < 100:
            continue
        out.append(u)
    # 同じ画像の重複を除く
    seen, uniq = set(), []
    for u in out:
        if u not in seen:
            seen.add(u)
            uniq.append(u)
    return uniq


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--articles", type=int, default=60)
    ap.add_argument("--sample-imgs", type=int, default=24)
    ap.add_argument("--delay", type=float, default=0.7)
    args = ap.parse_args()

    files = sorted(TEXT_DIR.glob("*.txt"),
                   key=lambda f: hashlib.sha256(f.name.encode()).hexdigest())
    urls = []
    for f in files:
        try:
            u = f.read_text(encoding="utf-8").split("\n", 1)[0]
        except Exception:                                    # noqa: BLE001
            continue
        if u.startswith("http"):
            urls.append(u)
    urls = urls[: args.articles]
    print(f"保存済み記事 {len(files):,} → 決定的標本 {len(urls)} 本", file=sys.stderr)

    per_host: dict[str, list] = collections.defaultdict(list)
    all_imgs = []
    n_ok = 0
    for i, u in enumerate(urls, 1):
        b = get(u)
        time.sleep(args.delay)
        if not b:
            continue
        n_ok += 1
        html = b.decode("utf-8", "replace")
        imgs = body_images(html, u)
        per_host[urlparse(u).netloc].append(len(imgs))
        for x in imgs:
            all_imgs.append({"article": u, "img": x})
        if i % 20 == 0:
            print(f"  {i}/{len(urls)} …", file=sys.stderr)

    if n_ok == 0:
        print("**1記事も取れなかった。数字を出さない。**", file=sys.stderr)
        raise SystemExit(2)

    counts = [c for v in per_host.values() for c in v]
    counts.sort()
    zero = sum(1 for c in counts if c == 0)
    med = counts[len(counts) // 2] if counts else 0
    print(f"\n=== 記事本文の画像（{n_ok} 記事）===", file=sys.stderr)
    print(f"  画像が0枚の記事 {zero}/{n_ok} = {zero/n_ok*100:.2f}%", file=sys.stderr)
    print(f"  **1記事あたり 平均 {sum(counts)/n_ok:.2f}枚 / 中央値 {med}枚**",
          file=sys.stderr)
    print(f"  合計 {sum(counts):,} 枚", file=sys.stderr)
    print(f"\n  ブログ別:", file=sys.stderr)
    for h, v in sorted(per_host.items(), key=lambda kv: -sum(kv[1]))[:8]:
        print(f"    {h[:32]:34} 記事 {len(v):>3}  画像 {sum(v):>4}  "
              f"平均 {sum(v)/len(v):5.2f}", file=sys.stderr)

    # --- 目視用に画像を落とす -----------------------------------------------
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    all_imgs.sort(key=lambda x: hashlib.sha256(x["img"].encode()).hexdigest())
    saved = []
    for it in all_imgs:
        if len(saved) >= args.sample_imgs:
            break
        b = get(it["img"], timeout=20)
        time.sleep(0.3)
        if not b or len(b) < 8000:          # 8KB 未満はアイコンとみなす
            continue
        p = IMG_DIR / f"{hashlib.sha256(it['img'].encode()).hexdigest()[:16]}.jpg"
        p.write_bytes(b)
        saved.append({**it, "path": str(p), "bytes": len(b)})
    print(f"\n=== 目視用に {len(saved)} 枚保存 ===", file=sys.stderr)
    for s in saved[:24]:
        print(f"  {Path(s['path']).name}  {s['bytes']//1024:>4}KB  "
              f"{s['img'][:70]}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "blog_photo_yield.json"
    p.write_text(json.dumps(
        {"n_articles": n_ok, "n_images": sum(counts),
         "images_per_article": sum(counts) / n_ok, "median": med,
         "zero_rate": zero / n_ok,
         "per_host": {h: {"articles": len(v), "images": sum(v)}
                      for h, v in per_host.items()},
         "sample": saved,
         "caveat": "写真があることと使ってよいことは別（許諾は 0/97）。"
                   "小さい画像とナビ・広告・ランキングバナーを落としているので下限。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}（画像は {IMG_DIR.name}/）", file=sys.stderr)


if __name__ == "__main__":
    main()
