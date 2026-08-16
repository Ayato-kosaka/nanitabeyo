#!/usr/bin/env python3
"""#1344 画像の利用可否を「規約ページまで辿って」分類し直す

## なぜ（前回の測定は下限すぎた）

前回は**トップページと問い合わせページ1枚**しか見ていない。

    転載禁止 1.0% / 要問い合わせ 0.0% / 明示的に利用可 0.0%（n=97）

オーナーの指示は「各ブログの**画像利用可否の表記を実際に取得して分類する**」である。
日本のブログは規約を **`/about`・`/profile`・`/利用規約`・`/免責事項`・
サイドバーのコピーライト表記**に置くことが多く、トップページ本文には書かない。
**見る場所が違えば 0% は当たり前**なので、辿ってから数え直す。

## 辿り方（決め方を明記する）

1. ブロガーのトップページを取る
2. リンクのうち、URL か表示文字が次に当たるものを**最大5枚**辿る
   `about` / `profile` / `policy` / `terms` / `kiyaku` / `disclaimer` /
   `copyright` / `privacy` / `利用規約` / `免責` / `プロフィール` / `このブログ` /
   `著作権` / `転載`
3. トップ＋辿った本文をまとめて、下の POLICY で分類する

分類は**優先順位つき**にする（同じページに複数出たら上を採る）。

    明示的に利用可 > 条件付き可（出典明記・リンク必須） > 要問い合わせ > 転載禁止 > 記載なし

「転載禁止」と「要問い合わせ」が両方出る場合、**交渉の余地がある方（要問い合わせ）**を
上に置くのは、オーナーの「問い合わせて無料でできるならいい」という前提に合わせるため。
この順序は私が決めたものである。

## この測定が言えないこと

**規約の有無であって、許諾が取れるかではない。**「記載なし」は
「使ってよい」ではなく「聞かないと分からない」である。
また最大5枚しか辿らないので、依然として**下限**である。

実行:
    python3 measure_blog_license_deep.py --n 150
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
PAGE_DIR = OUT_DIR / "_blog_policy_text"   # 取得した規約ページ本文（再分類用）
UA = "Mozilla/5.0 (compatible; nanitabeyo-research/1.0)"
_TAG = re.compile(r"<[^>]+>")
_SCRIPT = re.compile(r"(?is)<(script|style)[^>]*>.*?</\1>")

# 規約が置かれていそうなリンク
POLICY_LINK = re.compile(
    r"(about|profile|policy|policies|terms|kiyaku|rule|disclaimer|copyright|"
    r"privacy|contact|利用規約|規約|免責|プロフィール|このブログ|当ブログ|"
    r"著作権|転載|お問い?合わせ)", re.I)

# 優先順位つき。上から順に当たったものを採る。
POLICY_ORDER = [
    ("明示的に利用可", re.compile(
        r"(CC ?BY|クリエイティブ・?コモンズ|creative ?commons|"
        r"(写真|画像|素材)[^。\n]{0,20}(自由に|ご自由に)[^。\n]{0,10}(使|利用|お使い)|"
        r"転載(は)?[^。\n]{0,6}(自由|OK|可能|可です|してもらって))", re.I)),
    ("条件付きで可", re.compile(
        r"((出典|引用元|リンク|クレジット)[^。\n]{0,14}(明記|記載|表示|付けて)[^。\n]{0,20}"
        r"(転載|引用|利用|使用)[^。\n]{0,10}(可|OK|構いません|大丈夫)|"
        r"(転載|引用|利用|使用)[^。\n]{0,24}(の場合|する際|される際|の際)[^。\n]{0,30}"
        r"(出典|引用元|リンク|明記|クレジット)[^。\n]{0,20}"
        r"(お願い|ください|掲載|明記))", re.I)),
    ("要問い合わせ", re.compile(
        r"((写真|画像|記事|コンテンツ)[^。\n]{0,20}"
        r"(利用|使用|転載|掲載)[^。\n]{0,20}(ご連絡|お問い?合わせ|ご一報|許可|承諾)|"
        r"(ご連絡|お問い?合わせ|ご一報)[^。\n]{0,16}(の上|いただ|ください)[^。\n]{0,16}"
        r"(転載|利用|使用))", re.I)),
    # 【自戒】最初の版はここに `all rights reserved` を入れていた。
    # これはブログテンプレのフッターに常時入る定型句で、**画像の利用方針ではない**。
    # 実際に転載禁止と判定した21件を取得し直したところ、
    # **明示は5件、残り16件は `all rights reserved` だけ**だった。外す。
    ("転載禁止", re.compile(
        r"(無断(転載|複製|使用|引用|転用|掲載)[^。\n]{0,12}(禁|お断り|不可|厳禁)|"
        r"(転載|複製|転用|盗用|二次利用)[^。\n]{0,12}(を)?(固く)?(禁じ|禁止|お断り))",
        re.I)),
]


def get(u: str, timeout: int = 15) -> str | None:
    try:
        req = urllib.request.Request(u, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read(400_000)
    except Exception:                                        # noqa: BLE001
        return None
    for enc in ("utf-8", "cp932", "euc_jp"):
        try:
            s = b.decode(enc)
            if s.count("�") < 5:
                return s
        except UnicodeDecodeError:
            continue
    return b.decode("utf-8", "replace")


def text_of(html: str) -> str:
    return _TAG.sub(" ", _SCRIPT.sub(" ", html))


def classify(text: str) -> str:
    for label, rx in POLICY_ORDER:
        if rx.search(text):
            return label
    return "記載なし"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=150)
    ap.add_argument("--max-pages", type=int, default=5)
    ap.add_argument("--delay", type=float, default=0.8)
    # #1344 【設計】オーナーが聞いているのは**料理カテゴリ特化**（ラーメン専門・
    #   焼肉専門）の許諾状況である。`top_focused` にはブログ村の**地域タグ**
    #   （tokyogourmet / kantogourmet / zenkokugourmet）も混ざっているので、
    #   料理カテゴリだけに絞れる口を用意する。指定しなければ従来どおり全部。
    ap.add_argument("--cats", default="",
                    help="料理カテゴリのタグをカンマ区切り（例: ramen,bkyu）")
    ap.add_argument("--out-suffix", default="")
    args = ap.parse_args()

    sup = json.loads((OUT_DIR / "blogger_supply.json").read_text(encoding="utf-8"))
    pool = sup["top_focused"]
    if args.cats:
        want = {c.strip() for c in args.cats.split(",") if c.strip()}
        pool = [t for t in pool if t.get("cat") in want]
        if not pool:
            print(f"**{sorted(want)} に該当するブロガーが 0 人。数字を出さない。**",
                  file=sys.stderr)
            raise SystemExit(2)
    cand = pool[: args.n]
    print(f"対象 {len(cand)} 人（カテゴリ集中ブロガー・記事数の多い順"
          f"{'・' + args.cats if args.cats else ''}）", file=sys.stderr)

    cnt: collections.Counter = collections.Counter()
    by_cat: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    rows = []
    for i, t in enumerate(cand, 1):
        pr = urlparse(t["sample"])
        home = f"{pr.scheme}://{pr.netloc}/"
        if "/" in t["blogger"] and pr.path.strip("/"):
            home = f"{pr.scheme}://{pr.netloc}/{pr.path.strip('/').split('/')[0]}/"
        html = get(home)
        time.sleep(args.delay)
        if not html:
            cnt["取得失敗"] += 1
            rows.append({"blogger": t["blogger"], "cat": t["cat"], "ok": False})
            continue

        pages = [("(トップ)", text_of(html))]
        seen = {home}
        # 規約らしきリンクを辿る
        for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.{0,60}?)</a>',
                             html, re.I | re.S):
            if len(pages) > args.max_pages:
                break
            href, label = m.group(1), _TAG.sub("", m.group(2))
            if not (POLICY_LINK.search(href) or POLICY_LINK.search(label)):
                continue
            u = urljoin(home, href)
            if urlparse(u).netloc != pr.netloc or u in seen:
                continue
            seen.add(u)
            h2 = get(u)
            time.sleep(args.delay)
            if h2:
                pages.append((u, text_of(h2)))

        joined = "\n".join(p[1] for p in pages)
        # 【今回の改善】本文を保存する。分類規則を直すたびに再クロールしないで済む。
        PAGE_DIR.mkdir(parents=True, exist_ok=True)
        (PAGE_DIR / f"{hashlib.sha256(home.encode()).hexdigest()[:20]}.txt").write_text(
            home + "\n" + joined[:120_000], encoding="utf-8")
        label = classify(joined)
        # どのページで当たったか（規約はトップに無い、という仮説の検証）
        where = ""
        if label != "記載なし":
            for name, body in pages:
                if classify(body) == label:
                    where = name
                    break
        cnt[label] += 1
        cnt[f"辿った枚数{min(len(pages),6)}"] += 1
        if where and where != "(トップ)":
            cnt["**トップ以外で見つかった**"] += 1
        by_cat[t["cat"]][label] += 1
        rows.append({"blogger": t["blogger"], "cat": t["cat"], "ok": True,
                     "label": label, "n_pages": len(pages), "where": where,
                     "home": home})
        if i % 25 == 0:
            print(f"  {i}/{len(cand)} … " +
                  " ".join(f"{k}={v}" for k, v in cnt.most_common(4)), file=sys.stderr)

    ok = sum(1 for r in rows if r.get("ok"))
    print(f"\n=== 画像の利用可否（規約ページまで辿った / n={ok}）===", file=sys.stderr)
    for label, _ in POLICY_ORDER:
        v = cnt[label]
        print(f"  {label:14} {v:>4} = {v/max(ok,1)*100:5.2f}%", file=sys.stderr)
    print(f"  {'記載なし':14} {cnt['記載なし']:>4} = "
          f"{cnt['記載なし']/max(ok,1)*100:5.2f}%", file=sys.stderr)
    print(f"  {'取得失敗':14} {cnt['取得失敗']:>4}", file=sys.stderr)
    print(f"\n  **トップページ以外で見つかった {cnt['**トップ以外で見つかった**']} 件**"
          f"（前回トップだけを見て 0% を出した理由）", file=sys.stderr)

    usable = cnt["明示的に利用可"] + cnt["条件付きで可"]
    negoti = usable + cnt["要問い合わせ"] + cnt["記載なし"]
    print(f"\n  そのまま使える（明示的に可＋条件付き）**{usable} = "
          f"{usable/max(ok,1)*100:.2f}%**", file=sys.stderr)
    print(f"  交渉の余地がある（上記＋要問い合わせ＋記載なし） {negoti} = "
          f"{negoti/max(ok,1)*100:.2f}%", file=sys.stderr)

    print(f"\n=== カテゴリ別（上位8）===", file=sys.stderr)
    for c, cc in sorted(by_cat.items(), key=lambda kv: -sum(kv[1].values()))[:8]:
        print(f"  {c:16} n={sum(cc.values()):>3}  " +
              " ".join(f"{k}={v}" for k, v in cc.most_common(3)), file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / f"blog_license_deep{args.out_suffix}.json"
    p.write_text(json.dumps(
        {"n_target": len(cand), "n_ok": ok, "counts": dict(cnt),
         "usable": usable, "negotiable": negoti,
         "by_category": {k: dict(v) for k, v in by_cat.items()}, "rows": rows,
         "caveat": "規約の有無であって許諾が取れるかではない。"
                   "「記載なし」は「使ってよい」ではなく「聞かないと分からない」。"
                   "最大5枚しか辿らないので依然として下限。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
