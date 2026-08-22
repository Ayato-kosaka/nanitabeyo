#!/usr/bin/env python3
"""#1344 特化ブロガーに**機械的に連絡できる経路**があるか数える

## なぜ

画像利用の表記を 21 ブログ深掘りした結果は **「明示的に可」が 0 件**、
記載なし 16 / 要問い合わせ 1 / 取得失敗 4 だった。オーナーの指示は

    「利用可能」が相当数あれば有力。無ければ**一括メール等の機械的に
    回せる方法**も検討する

なので、次に決めるべきは「**そもそも機械的に連絡先を集められるのか**」である。
ここが 0 に近ければ、一括メールという案自体が成立しない。

## 測るもの（連絡経路の**存在率**であって、返信率でも許諾率でもない）

各ブログのトップを取り、次を順に探す。

    1. `mailto:` のリンク（**メールアドレスが機械的に取れる**）
    2. 問い合わせページ（アンカーの文字列か href が 問い合わせ/お問合せ/contact/mail）
       → そのページを取りに行き、`mailto:` かフォーム（input[type=email] / textarea）を探す
    3. コメント欄（`<form>` に comment/textarea があるトップページ）

判定は上から順の**最初に当たったもの**を採る。3つとも無ければ「連絡経路なし」。

## この測定が言えないこと

  - **返信率も許諾率も測っていない。** 経路の存在だけである
  - フォームは**送信していない**（送ると相手に迷惑をかけるので測定では踏まない）
  - 一括メールを実際に送る場合の是非（特定電子メール法など）は**この測定の外**
  - トップと問い合わせページの**2枚しか見ない**ので下限

実行:
    python3 measure_blog_contact_route.py
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
UA = "nanitabeyo-research/1.0 (dish-media feasibility PoC; contact-route census)"

CONTACT_WORD = re.compile(r"問い?合わ?せ|問合|contact|inquiry|メールフォーム|mail", re.I)
MAILTO = re.compile(r'href=["\']mailto:([^"\'?]+)', re.I)
ANCHOR = re.compile(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.I | re.S)
FORM = re.compile(r"<form\b.*?</form>", re.I | re.S)
EMAIL_INPUT = re.compile(r'type=["\']email["\']|name=["\'][^"\']*mail', re.I)
TEXTAREA = re.compile(r"<textarea\b", re.I)
COMMENT_HINT = re.compile(r"comment|コメント", re.I)


def fetch(url: str, timeout: int = 20) -> str | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read(1_500_000)
        for enc in ("utf-8", "cp932", "euc-jp"):
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", "replace")
    except Exception:                                            # noqa: BLE001
        return None


def find_contact_links(html: str, base: str) -> list[str]:
    out = []
    for href, text in ANCHOR.findall(html):
        label = re.sub(r"<[^>]+>", "", text)
        if CONTACT_WORD.search(label) or CONTACT_WORD.search(href):
            u = urllib.parse.urljoin(base, href)
            if u.startswith("http") and u not in out:
                out.append(u)
    return out[:3]


def judge_form(html: str) -> str | None:
    for f in FORM.findall(html):
        if EMAIL_INPUT.search(f) or (TEXTAREA.search(f) and not COMMENT_HINT.search(f)):
            return "フォーム"
    return None


def main() -> None:
    src = json.loads((OUT_DIR / "blog_license_deep_dishcat.json").read_text(encoding="utf-8"))
    rows_in = src["rows"]
    results = []
    for i, r in enumerate(rows_in, 1):
        blogger = r["blogger"]
        home = r.get("home") or f"https://{blogger}/"
        html = fetch(home)
        rec = {"blogger": blogger, "cat": r.get("cat"), "home": home}
        if html is None:
            rec |= {"route": "取得失敗", "detail": ""}
            results.append(rec)
            print(f"{i:>2}. {blogger[:34]:36} **取得失敗**", file=sys.stderr)
            continue

        m = MAILTO.search(html)
        if m:
            rec |= {"route": "mailto(トップ)", "detail": m.group(1)[:60]}
        else:
            links = find_contact_links(html, home)
            rec["contact_links"] = links
            hit = None
            for u in links:
                sub = fetch(u)
                if sub is None:
                    continue
                m2 = MAILTO.search(sub)
                if m2:
                    hit = ("mailto(問い合わせページ)", m2.group(1)[:60], u)
                    break
                f = judge_form(sub)
                if f:
                    hit = ("問い合わせフォーム", "", u)
                    break
                time.sleep(0.5)
            if hit:
                rec |= {"route": hit[0], "detail": hit[1], "page": hit[2]}
            elif judge_form(html):
                rec |= {"route": "問い合わせフォーム(トップ)", "detail": ""}
            elif re.search(r"<form\b", html, re.I) and COMMENT_HINT.search(html):
                rec |= {"route": "コメント欄のみ", "detail": ""}
            else:
                rec |= {"route": "連絡経路なし", "detail": ""}
        results.append(rec)
        print(f"{i:>2}. {blogger[:34]:36} **{rec['route']}** {rec.get('detail','')}",
              file=sys.stderr)
        time.sleep(0.5)

    counts: dict[str, int] = {}
    for r in results:
        counts[r["route"]] = counts.get(r["route"], 0) + 1
    n_ok = sum(1 for r in results if r["route"] != "取得失敗")
    mech = sum(1 for r in results if r["route"].startswith("mailto"))
    form = sum(1 for r in results if "フォーム" in r["route"])

    print("\n=== 連絡経路の存在率（返信率でも許諾率でもない）===", file=sys.stderr)
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {k:26} {v:>2} 件", file=sys.stderr)
    print(f"\n  取得できた {n_ok} 件中", file=sys.stderr)
    print(f"  **メールアドレスが機械的に取れる {mech} 件 = "
          f"{mech/n_ok*100:.1f}%**", file=sys.stderr)
    print(f"  フォーム（1件ずつ手で送る必要がある） {form} 件 = "
          f"{form/n_ok*100:.1f}%", file=sys.stderr)
    print(f"  **一括メールが機械的に回せるのは {mech}/{n_ok} にとどまる**", file=sys.stderr)

    p = OUT_DIR / "blog_contact_route.json"
    p.write_text(json.dumps(
        {"n": len(results), "n_ok": n_ok, "counts": counts,
         "n_mailto": mech, "n_form": form,
         "mailto_rate": mech / n_ok if n_ok else None,
         "rows": results,
         "caveat": "経路の存在だけを測った。返信率も許諾率も測っていない。"
                   "フォームは送信していない。トップと問い合わせページの2枚しか"
                   "見ないので下限である。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
