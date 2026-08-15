#!/usr/bin/env python3
"""#1344 「一括で連絡できるのか」— ブロガーの連絡口を実測する

## なぜ

オーナーの案:「一括でメールしてみるとか、機械的にばんばん進められそうな方法」
「問い合わせたところで有料と言われる可能性も高いが、無料でできるならいい」。

これを実行可能性で判断するには**連絡口が実在するか**を数える必要がある。
`--stage license` は 60件で「要問い合わせ 12 / 記載なし 33」だったが、
**問い合わせ先そのものは数えていない**。

## 測るもの（トップページ＋見つかった問い合わせページのみ）

  1. `mailto:` のメールアドレスが公開されているか
  2. 問い合わせフォームへの導線があるか（お問い合わせ/contact/inquiry/form）
  3. ブログサービス側のメッセージ機能しか無いか（=一括送信できない）
  4. X / Instagram など DM 可能な口があるか
  5. 画像の利用に関する記載（転載禁止/要問い合わせ/明示的に利用可）

## 一括メールの法的な位置づけ（**測定ではなく前提の明示**）

総務省「迷惑メール対策」ページの記載（一次情報）:

    「広告・宣伝メールを送信する場合、当該メールは原則、
      特定電子メール法の規制対象となります」

特定電子メール法はオプトイン方式である。公表アドレス宛の例外は
**「営業を営む者」**が公表している場合に限られ、**趣味で書いている個人**は
その例外に当たらない可能性が高い。したがって
**「アドレスを機械収集して一斉送信」は、そのままでは採れない**。
ここで数えるのは「連絡口があるか」までであって、送信可否とは別である。

## この測定が言えないこと

トップページと1階層しか見ない。規約が別ページにある場合は取りこぼす（**下限**）。
連絡口があっても、返事が来るか・無料で許諾が出るかは**別問題**で、ここでは測れない。

実行:
    python3 measure_blogger_contact.py --n 150
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import urljoin, urlparse

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
UA = "Mozilla/5.0 (compatible; nanitabeyo-research/1.0)"

MAILTO = re.compile(r"mailto:([^\"'>\s?]+@[^\"'>\s?]+)", re.I)
CONTACT_HREF = re.compile(
    r"href=[\"']([^\"']*(?:contact|inquiry|toiawase|otoiawase|form|mail)[^\"']*)[\"']", re.I)
CONTACT_WORD = re.compile(r"(お問い?合わせ|問合せ|ご連絡|メッセージを送る|コンタクト)")
SNS = {
    "X/Twitter": re.compile(r"https?://(?:www\.)?(?:twitter\.com|x\.com)/[A-Za-z0-9_]{2,}", re.I),
    "Instagram": re.compile(r"https?://(?:www\.)?instagram\.com/[A-Za-z0-9_.]{2,}", re.I),
    "YouTube": re.compile(r"https?://(?:www\.)?youtube\.com/(?:@|channel/|c/)[^\"'\s<]+", re.I),
}
POLICY = {
    "転載禁止": re.compile(r"(無断転載|転載を?禁止|複製を?禁止|無断使用|無断引用)"),
    "要問い合わせ": re.compile(r"(使用.{0,6}(希望|の際).{0,12}(連絡|問い?合わせ)|"
                          r"画像.{0,10}(利用|使用).{0,10}(連絡|問い?合わせ|許可))"),
    "明示的に利用可": re.compile(r"(CC ?BY|クリエイティブ・?コモンズ|"
                           r"自由に(お使い|ご利用)|転載(は)?(自由|OK|可))", re.I),
}
PLATFORM_MSG = re.compile(
    r"(ameblo\.jp/.*/message|blog\.fc2\.com/.*mail|form\.mag2|"
    r"seesaa\.net/contact|hatena\.ne\.jp/message)", re.I)


def get(u: str, timeout: int = 15) -> str | None:
    try:
        req = urllib.request.Request(u, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read(300_000)
    except Exception:                                        # noqa: BLE001
        return None
    for enc in ("utf-8", "cp932", "euc_jp"):
        try:
            s = b.decode(enc)
            if "�" not in s[:2000]:
                return s
        except UnicodeDecodeError:
            continue
    return b.decode("utf-8", "replace")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=150)
    ap.add_argument("--delay", type=float, default=1.0)
    ap.add_argument("--skip", default="umai-net.com,ikezenkoku.exblog.jp,shibaji.seesaa.net",
                    help="いま別の測定が巡回中のホストは避ける（相手に負荷をかけない）")
    args = ap.parse_args()
    skip = {s for s in args.skip.split(",") if s}

    sup = json.loads((OUT_DIR / "blogger_supply.json").read_text(encoding="utf-8"))
    # カテゴリを1つに絞っているブロガーを優先（オーナー指示: ラーメン専門・焼肉専門）
    cand = [t for t in sup["top_focused"] if urlparse(t["sample"]).netloc not in skip]
    cand = cand[: args.n]
    print(f"対象 {len(cand)} 人（カテゴリ集中ブロガーを記事数の多い順）", file=sys.stderr)

    cnt: collections.Counter = collections.Counter()
    by_cat: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    rows = []
    for i, t in enumerate(cand, 1):
        u = t["sample"]
        pr = urlparse(u)
        home = f"{pr.scheme}://{pr.netloc}/"
        # ブログサービス上の個人はパスまでがトップ
        if "/" in t["blogger"] and pr.path.strip("/"):
            home = f"{pr.scheme}://{pr.netloc}/{pr.path.strip('/').split('/')[0]}/"
        html = get(home)
        time.sleep(args.delay)
        if not html:
            cnt["取得失敗"] += 1
            rows.append({"blogger": t["blogger"], "cat": t["cat"], "ok": False})
            continue
        mails = sorted({m for m in MAILTO.findall(html)
                        if not m.lower().startswith(("noreply", "no-reply"))})
        chrefs = [h for h in CONTACT_HREF.findall(html)][:5]
        # 問い合わせページを1枚だけ追って規約も見る
        pol = {k for k, rx in POLICY.items() if rx.search(html)}
        cpage = None
        if chrefs:
            cu = urljoin(home, chrefs[0])
            if urlparse(cu).netloc == pr.netloc:
                cpage = get(cu)
                time.sleep(args.delay)
                if cpage:
                    mails = sorted(set(mails) | {m for m in MAILTO.findall(cpage)
                                                 if not m.lower().startswith(("noreply", "no-reply"))})
                    pol |= {k for k, rx in POLICY.items() if rx.search(cpage)}
        sns = {k for k, rx in SNS.items() if rx.search(html)}
        plat_only = bool(PLATFORM_MSG.search(html)) and not mails

        ch = ("メール公開" if mails else
              "フォーム有り" if (chrefs or CONTACT_WORD.search(html)) else
              "サービスのメッセージのみ" if plat_only else
              "SNSのみ" if sns else "連絡口が見つからない")
        cnt[ch] += 1
        by_cat[t["cat"]][ch] += 1
        for p in pol:
            cnt[f"規約:{p}"] += 1
        for s in sns:
            cnt[f"SNS:{s}"] += 1
        rows.append({"blogger": t["blogger"], "cat": t["cat"], "ok": True,
                     "channel": ch, "n_mail": len(mails), "policy": sorted(pol),
                     "sns": sorted(sns), "home": home})
        if i % 25 == 0:
            print(f"  {i}/{len(cand)} …", file=sys.stderr)

    ok = sum(1 for r in rows if r.get("ok"))
    print(f"\n=== 連絡口（{ok} 人ぶん取得できた / 対象 {len(cand)}）===", file=sys.stderr)
    order = ["メール公開", "フォーム有り", "サービスのメッセージのみ", "SNSのみ",
             "連絡口が見つからない"]
    for k in order:
        v = cnt[k]
        print(f"  {k:22} {v:>4} = {v/max(ok,1)*100:5.1f}%", file=sys.stderr)
    print(f"  {'取得失敗':22} {cnt['取得失敗']:>4}", file=sys.stderr)

    print(f"\n=== 画像の利用に関する記載（**下限**。別ページの規約は見ていない）===",
          file=sys.stderr)
    for k in POLICY:
        v = cnt[f"規約:{k}"]
        print(f"  {k:22} {v:>4} = {v/max(ok,1)*100:5.1f}%", file=sys.stderr)

    print(f"\n=== SNS の口 ===", file=sys.stderr)
    for k in SNS:
        v = cnt[f"SNS:{k}"]
        print(f"  {k:22} {v:>4} = {v/max(ok,1)*100:5.1f}%", file=sys.stderr)

    print(f"\n=== カテゴリ別（上位8）===", file=sys.stderr)
    for c, cc in sorted(by_cat.items(), key=lambda kv: -sum(kv[1].values()))[:8]:
        tot = sum(cc.values())
        print(f"  {c:16} n={tot:>3}  " +
              " ".join(f"{k}={v}" for k, v in cc.most_common(3)), file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "blogger_contact.json"
    p.write_text(json.dumps(
        {"n_target": len(cand), "n_ok": ok, "counts": dict(cnt),
         "by_category": {k: dict(v) for k, v in by_cat.items()}, "rows": rows,
         "caveat": "トップページ＋問い合わせページ1枚のみ。規約は下限。"
                   "連絡口の有無であって、返事が来るか・無料で許諾が出るかは別。"
                   "一斉送信は特定電子メール法（オプトイン）の対象になりうる。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
