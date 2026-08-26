#!/usr/bin/env python3
"""#1269 回収の誤りを止める門を作る — 「そのページに店名が出ているか」

## なぜ

回収で取れた13件を目視したら**別主体が 7件（53.8%）**あり、
**7件すべてが「ドメインルートへ落とした」着地**だった（出雲空港・ハワイアンズ・
スキー場・商業施設・ポータル）。404 の店舗ページをルートへ落とすと、
**その店が入っている施設のトップページ**に着地するためである。

**「ルート着地なら捨てる」では厳しすぎる**（正しい 6件のうち 5件もルート着地だった）。
必要なのは着地の形ではなく、**着地したページがその店のページか**という判定である。

## 試す門

回収先の HTML に**店名が出てくるか**を見る。出てこなければ回収失敗として扱う。

    出雲空港のトップに「神在」は出ない        → 捨てる（正しい）
    c-cafe.net のトップに「ささ乃や」は出る    → 残す（正しい）

店名は表記ゆれがあるので、**空白・記号を除いた全文一致**と、
**店名の先頭 2〜4 文字**の2段で見る（「そば処与市」→「与市」のような接頭辞落ちに備える）。

## この測定が言えないこと

  - **n=13 の後付けの門である。** ここで効いても、別の標本で効くとは限らない
  - 施設のページに店名が載っていることもある（テナント一覧など）。その場合は通ってしまう

実行:
    python3 measure_recovery_name_gate.py
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
UA = "nanitabeyo-research/1.0 (dish-media feasibility PoC)"
SYM = re.compile(r"[\s　・\-—–_,，.。'\"“”‘’!！?？&＆/／|｜()（）\[\]【】『』「」]+")
DROP = ("そば処", "お食事処", "ステーキハウス", "レストラン", "カフェ", "喫茶",
        "居酒屋", "食堂", "ラーメン", "手打ち", "本店", "店")


def fetch(url: str) -> str | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read(1_500_000)
        for enc in ("utf-8", "cp932", "euc-jp"):
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", "replace")
    except Exception:                                            # noqa: BLE001
        return None


def keys(name: str) -> list[str]:
    n = SYM.sub("", name)
    out = [n]
    for d in DROP:
        if n.startswith(d) and len(n) > len(d) + 1:
            out.append(n[len(d):])
        if n.endswith(d) and len(n) > len(d) + 1:
            out.append(n[: -len(d)])
    core = out[-1]
    # #1269 【バグ】最初は 2 文字の接頭辞まで鍵にしていた。ラテン名では
    #   'La' や 'Ca' が鍵になり、**どのページにも出るので門にならなかった**
    #   （La Coccinelle → 商業施設のページが 'La' で通ってしまう）。
    #   日本語は 3 文字以上、ラテン文字は**切らない**。
    if len(core) >= 4 and not re.fullmatch(r"[A-Za-z0-9]+", core):
        out.append(core[:3])
    return [k for k in dict.fromkeys(out) if len(k) >= 3]


def main() -> None:
    d = json.loads((OUT_DIR / "handle_recovery.json").read_text(encoding="utf-8"))
    lab = json.loads((OUT_DIR / "handle_recovery_labels.json").read_text(encoding="utf-8"))
    truth = {}
    for k, key in (("store_own", "店固有"), ("chain_or_brand", "チェーン"),
                   ("other_entity", "別主体")):
        for e in lab[k]:
            truth[e["store"]] = key

    rows = [x for x in d["detail"] if x["recovered"] and x["handles"]]
    print(f"回収して IG が取れた {len(rows)} 件に門をかける\n", file=sys.stderr)
    res = []
    for x in rows:
        html = fetch(x["url"])
        body = SYM.sub("", re.sub(r"<[^>]+>", " ", html)) if html else ""
        ks = keys(x["name"])
        hit = next((k for k in ks if k in body), None)
        t = truth.get(x["name"], "?")
        res.append({"store": x["name"], "url": x["url"], "truth": t,
                    "passed": bool(hit), "matched_key": hit})
        print(f"  {'通過' if hit else '却下':4} 正解={t:6} {x['name'][:20]:22} "
              f"key={hit!r}", file=sys.stderr)
        time.sleep(0.3)

    ok = [r for r in res if r["passed"]]
    good = [r for r in ok if r["truth"] in ("店固有", "チェーン")]
    bad = [r for r in ok if r["truth"] == "別主体"]
    lost = [r for r in res if not r["passed"] and r["truth"] in ("店固有", "チェーン")]
    print(f"\n=== 門の成績（n={len(res)}）===", file=sys.stderr)
    print(f"  通過 {len(ok)} 件  うち正しい {len(good)} / **別主体 {len(bad)}**",
          file=sys.stderr)
    print(f"  却下した中の取りこぼし（正しかったのに落とした）**{len(lost)}**",
          file=sys.stderr)
    if ok:
        print(f"  **門の precision {len(good)}/{len(ok)} = "
              f"{len(good)/len(ok)*100:.1f}%**（門なしは 6/13 = 46.2%）", file=sys.stderr)

    p = OUT_DIR / "recovery_name_gate.json"
    p.write_text(json.dumps({"n": len(res), "passed": len(ok), "good": len(good),
                             "bad": len(bad), "lost": len(lost), "rows": res,
                             "caveat": "n=13 の後付けの門。別の標本で効くとは限らない。"},
                            ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
