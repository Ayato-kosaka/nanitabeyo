#!/usr/bin/env python3
"""#1344 ブログ本文から拾った「店名」を、**前後の文ごと出して目視で確かめる**

## なぜ

カテゴリ特化ブロガーの測り直しで、`favoriteslibrary-ramen.com` が
**150 記事 → 121 店**（1記事 0.8 店）と、他より一桁近く高い値を出した。
前の群では機械判定が『くすりの福太郎』『デザート』『タルタル』『home town』を
店として数えていた実績がある。**この数字をそのまま報告しない。**

## 測るもの

保存済みの記事本文（`out/_blog_text/`。再クロール不要）から、
`NameMatcher.match_corroborated` が当てた店名を**出現箇所の前後 60 字つき**で並べる。
決定的標本なので、同じコマンドで同じ並びが出る。

出すのは2つ:

  1. 目視用の一覧（店名・前後の文・記事URL）
  2. 目視ラベルを与えたときの**補正後の店数**（`--labels` で JSON を渡す）

## この測定が言えないこと

  - 目視は店名が**その記事で紹介されている店**かどうかを見るだけである。
    その記事に**写真があるか**・**使ってよいか**は別（許諾は 0/97）

実行:
    python3 verify_blog_store_matches.py --domain favoriteslibrary-ramen.com --sample 40
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import NameMatcher  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
TEXT_DIR = OUT_DIR / "_blog_text"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--domain", required=True)
    ap.add_argument("--sample", type=int, default=40)
    ap.add_argument("--window", type=int, default=60)
    args = ap.parse_args()

    files = []
    for p in sorted(TEXT_DIR.glob("*.txt")):
        try:
            first = p.open(encoding="utf-8").readline().strip()
        except OSError:
            continue
        if args.domain in first:
            files.append((p, first))
    if not files:
        print(f"**{args.domain} の本文が 1 件も無い。数字を出さない。**", file=sys.stderr)
        raise SystemExit(2)
    print(f"{args.domain}: 記事 {len(files)} 件", file=sys.stderr)

    m = NameMatcher()
    hits: dict[str, list] = {}
    for p, url in files:
        body = p.read_text(encoding="utf-8", errors="replace")
        for name in m.match_corroborated(body):
            i = body.find(name)
            if i < 0:
                # 正規化後にしか現れない場合は文脈を取れない
                hits.setdefault(name, []).append({"url": url, "ctx": "(正規化後のみ一致)"})
                continue
            lo = max(0, i - args.window)
            ctx = body[lo: i + len(name) + args.window].replace("\n", " ")
            hits.setdefault(name, []).append({"url": url, "ctx": ctx})

    names = sorted(hits, key=lambda n: hashlib.sha256(n.encode()).hexdigest())
    smp = names[: args.sample]
    print(f"当てた店名 {len(names)} / 目視標本 {len(smp)}\n", file=sys.stderr)
    for i, n in enumerate(smp, 1):
        h = hits[n][0]
        print(f"{i:>3}. 『{n}』  （{len(hits[n])} 記事）", file=sys.stderr)
        print(f"     {h['ctx'][:150]}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / f"blog_match_review_{args.domain.replace('.', '_')}.json"
    p.write_text(json.dumps(
        {"domain": args.domain, "n_articles": len(files), "n_names": len(names),
         "sample": [{"name": n, "n_articles": len(hits[n]),
                     "ctx": hits[n][0]["ctx"][:300], "url": hits[n][0]["url"]}
                    for n in smp],
         "caveat": "目視は『その記事で紹介されている店か』だけを見る。"
                   "写真があるか・使ってよいか（許諾 0/97）は別。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
