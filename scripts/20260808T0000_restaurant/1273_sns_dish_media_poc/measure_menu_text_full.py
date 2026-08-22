#!/usr/bin/env python3
"""#1273 メニューページの本文を実際に読んで、テキスト経路の本当の値を測る

## なぜ

`measure_menu_text_route.py` は**キャッシュにある画像の周辺テキストだけ**を使ったので、
店数 20.17% / 店あたりカテゴリ 2.80 という値は**下限**だった。
本スクリプトは実際にページを取得して**本文全体**からカテゴリを取る。

判定器は①と同じ `dish_category_matcher.CategoryMatcher` を使う。
取得は `own-website-images.py` と同じ作法（robots.txt 尊重、1ホスト同時1接続・1秒間隔、
UA を正直に名乗る、平文HTTPは https を先に試す）。

## 何が分かるか

#1273 §32 の KPI は「1セルに distinct 5店」であって「写真5枚」ではない。
`dishes` は `@@unique([restaurant_id, category_id])` で写真が無くても行が作れる。
**「この店はラーメンを出す」を集めるほうが「その店のラーメンの写真」より易しい**なら、
セル充足の律速（店あたりカテゴリ数 k）はテキスト経由で外せる。

urban が N≥5 を満たすのに必要な k は 3.4（カバレッジ100%前提）。
写真経由は k=1.89、画像周辺テキストで k=2.80。**本文を読んだらどこまで行くか。**

実行:
    python3 measure_menu_text_full.py --limit 120
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from bs4 import BeautifulSoup

from dish_category_matcher import CategoryMatcher

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

_spec = importlib.util.spec_from_file_location("owi", HERE / "own-website-images.py")
_owi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_owi)

# 本文からカテゴリを取るときも、ヘッダ/フッタ/ナビの共通文言は落とす。
# これを残すと全店に同じカテゴリが付いて水増しになる。
_DROP_TAGS = ("script", "style", "nav", "header", "footer", "noscript")

# 1ページから取り出すテキストの上限。長すぎるページで判定器が重くなるのを避ける。
MAX_TEXT_CHARS = 40_000


def page_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all(_DROP_TAGS):
        tag.decompose()
    text = soup.get_text(" ", strip=True)
    return re.sub(r"\s+", " ", text)[:MAX_TEXT_CHARS]


def menu_links(html: str, base: str, limit: int) -> list[str]:
    """own-website-images.py と同じ MENULINK_RE で、メニュー系リンクを拾う。"""
    import urllib.parse

    soup = BeautifulSoup(html, "html.parser")
    seen: list[str] = []
    for a in soup.find_all("a", href=True):
        label = (a.get_text(" ", strip=True) or "") + " " + a["href"]
        if not _owi.MENULINK_RE.search(label):
            continue
        url = urllib.parse.urljoin(base, a["href"])
        if not url.startswith("http") or url in seen:
            continue
        seen.append(url)
        if len(seen) >= limit:
            break
    return seen


def probe(rec: dict, hops: int) -> dict:
    website = _owi.normalize(rec["website"])
    tries = [website]
    if website.startswith("http://"):
        tries = ["https://" + website[len("http://"):], website]
    html = final = None
    err = None
    for target in tries:
        html, err, final = _owi.get_page(target)
        if html is not None:
            break
    if html is None:
        return {"name": rec["name"], "domain": rec["domain"], "error": err, "categories": []}

    texts = [page_text(html)]
    # #1273 メニューページは1ホップ先にあることが多い。own-website-images.py と同じ発想。
    for url in menu_links(html, final or website, hops):
        sub, sub_err, _ = _owi.get_page(url)
        if sub:
            texts.append(page_text(sub))

    matcher = CategoryMatcher()
    cats: set[str] = set()
    for text in texts:
        for cat in matcher.match(text):
            cats.add(cat["dish_category_id"])
    return {"name": rec["name"], "domain": rec["domain"], "error": None,
            "n_pages": len(texts), "categories": sorted(cats)}


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 メニュー本文からのカテゴリ抽出")
    ap.add_argument("--limit", type=int, default=120)
    ap.add_argument("--hops", type=int, default=2, help="メニュー系リンクを何本たどるか")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    src = OUT_DIR / "own-website-images.json"
    if not src.exists():
        raise SystemExit(f"#1304 の測定結果が無い: {src}")
    data = json.loads(src.read_text(encoding="utf-8"))
    n_sample = data["sample_size"]

    # website を持つ店（ポータル除外は own-website-images.py の判定をそのまま使う）
    targets = [r for r in data["results"] if r.get("website") and not r["is_portal"]][: args.limit]
    print(f"対象: website を持つ {len(targets)} 店（600店標本から）", file=sys.stderr)

    started = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        rows = list(pool.map(lambda r: probe(r, args.hops), targets))
    elapsed = time.time() - started

    ok = [r for r in rows if r["error"] is None]
    with_cat = [r for r in ok if r["categories"]]
    k = sum(len(r["categories"]) for r in with_cat) / max(len(with_cat), 1)

    print(f"\n=== メニュー本文からのカテゴリ抽出（{elapsed:.0f}s）===", file=sys.stderr)
    print(f"  取得できた       : {len(ok)}/{len(targets)}", file=sys.stderr)
    print(f"  カテゴリが付いた : {len(with_cat)}", file=sys.stderr)
    print(f"  **店あたりカテゴリ数 k = {k:.2f}**", file=sys.stderr)

    errs: dict[str, int] = {}
    for r in rows:
        if r["error"]:
            errs[str(r["error"]).split("(")[0]] = errs.get(str(r["error"]).split("(")[0], 0) + 1
    if errs:
        print(f"  取得失敗の内訳: {errs}", file=sys.stderr)

    print(f"\n=== 比較（同じ600店標本の分母で）===", file=sys.stderr)
    print(f"  写真経由              : 13.17%  k=1.89", file=sys.stderr)
    print(f"  画像周辺テキスト（下限）: 20.17%  k=2.80", file=sys.stderr)
    cov = len(with_cat) / n_sample * 100
    print(f"  **メニュー本文（本測定）: {cov:.2f}%  k={k:.2f}**", file=sys.stderr)
    print(f"\n  urban が N>=5 を満たすのに必要な k は 3.4（カバレッジ100%前提）", file=sys.stderr)
    print(f"  → {'**達成**' if k >= 3.4 else '未達'}", file=sys.stderr)

    top = sorted(with_cat, key=lambda r: -len(r["categories"]))[:8]
    print(f"\n  カテゴリ数が多かった店:", file=sys.stderr)
    for r in top:
        print(f"    {r['name'][:22]:24} {len(r['categories']):>3} カテゴリ "
              f"({r.get('n_pages', 1)}ページ)", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "menu_text_full.json"
    out_path.write_text(
        json.dumps({"n_sample": n_sample, "n_targets": len(targets), "n_ok": len(ok),
                    "n_with_category": len(with_cat), "coverage_pct": cov, "k": k,
                    "errors": errs, "rows": rows}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
