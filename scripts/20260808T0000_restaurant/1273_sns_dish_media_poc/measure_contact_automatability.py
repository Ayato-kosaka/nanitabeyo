#!/usr/bin/env python3
"""#1344 「機械的にばんばん進められる方法」があるか、問い合わせ面を実測する

## なぜ

オーナーの指示は「一括でメールしてみるとか、**機械的に回せそうな方法**も検討しながら」。
既に分かっていること:

  - メールアドレスを公開しているブロガーは **4.1%**（宛先が集まらない）
  - 総務省の一次情報より、広告・宣伝メールは**特定電子メール法（オプトイン）の対象**
  - 主たる連絡口は**問い合わせフォーム 49.5%** と **X 61.9%**

残る問いは「**フォームなら機械で送れるのか**」である。
ここは推測ではなく、フォームの実物を見れば分かる。

## 測るもの（**送信は一切しない。フォームのHTMLを読むだけ**）

問い合わせページを取得し、次を数える。

  - reCAPTCHA / hCaptcha / Turnstile … **人間確認。機械送信を明示的に拒んでいる**
  - nonce / CSRF トークン … セッションが要る（機械化は可能だが手間）
  - 外部フォームサービス（Google Forms / formrun / Contact Form 7 など）
  - `<form>` がそもそも無い（画像でアドレスを書いている等）

**送信は行わない。** 相手のフォームに実際にメッセージを送るのは、
オーナーが「問い合わせに行く」と判断してからである。

## この測定が言えないこと

CAPTCHA が無いことは「送ってよい」という意味ではない。
多くのサイトの利用規約は自動化されたアクセスを禁じている。
ここで測るのは**技術的な障壁の有無**だけである。

実行:
    python3 measure_contact_automatability.py --n 120
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
_TAG = re.compile(r"<[^>]+>")

CONTACT_HREF = re.compile(
    r'href=["\']([^"\']*(?:contact|inquiry|toiawase|otoiawase|form|mail)[^"\']*)["\']', re.I)
CONTACT_WORD = re.compile(r"(お問い?合わせ|問合せ|コンタクト|メッセージを送る)")

SIGNALS = {
    "reCAPTCHA": re.compile(r"(recaptcha|g-recaptcha|google\.com/recaptcha)", re.I),
    "hCaptcha": re.compile(r"hcaptcha", re.I),
    "Turnstile": re.compile(r"(cf-turnstile|challenges\.cloudflare\.com)", re.I),
    "画像認証（その他）": re.compile(r"(captcha|認証コード|画像の文字)", re.I),
    "nonce/CSRF": re.compile(r'name=["\'](_wpnonce|csrf[_-]?token|authenticity_token)', re.I),
    "Contact Form 7": re.compile(r"wpcf7", re.I),
    "Google Forms": re.compile(r"docs\.google\.com/forms", re.I),
    "formrun/formzu等": re.compile(r"(formrun\.io|formzu\.net|ssl\.form-mailer|tayori\.com)", re.I),
}


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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=120)
    ap.add_argument("--delay", type=float, default=0.8)
    args = ap.parse_args()

    sup = json.loads((OUT_DIR / "blogger_supply.json").read_text(encoding="utf-8"))
    cand = sup["top_focused"][: args.n]
    print(f"対象 {len(cand)} 人（送信は一切しない。フォームのHTMLを読むだけ）",
          file=sys.stderr)

    cnt: collections.Counter = collections.Counter()
    rows = []
    for i, t in enumerate(cand, 1):
        pr = urlparse(t["sample"])
        home = f"{pr.scheme}://{pr.netloc}/"
        if "/" in t["blogger"] and pr.path.strip("/"):
            home = f"{pr.scheme}://{pr.netloc}/{pr.path.strip('/').split('/')[0]}/"
        html = get(home)
        time.sleep(args.delay)
        if not html:
            cnt["トップ取得失敗"] += 1
            continue

        # 問い合わせページを1枚だけ辿る
        cu = None
        for href in CONTACT_HREF.findall(html)[:6]:
            u = urljoin(home, href)
            if urlparse(u).netloc == pr.netloc:
                cu = u
                break
        page = None
        if cu:
            page = get(cu)
            time.sleep(args.delay)
        if not page:
            if CONTACT_WORD.search(_TAG.sub(" ", html)):
                cnt["文言はあるがページを辿れない"] += 1
            else:
                cnt["問い合わせ面が見つからない"] += 1
            rows.append({"blogger": t["blogger"], "url": cu, "ok": False})
            continue

        cnt["問い合わせページを取得できた"] += 1
        found = [k for k, rx in SIGNALS.items() if rx.search(page)]
        for k in found:
            cnt[k] += 1
        has_form = "<form" in page.lower()
        if not has_form:
            cnt["フォームタグが無い"] += 1
        blocked = any(k in found for k in
                      ("reCAPTCHA", "hCaptcha", "Turnstile", "画像認証（その他）"))
        if blocked:
            cnt["**人間確認で機械送信を拒んでいる**"] += 1
        rows.append({"blogger": t["blogger"], "url": cu, "ok": True,
                     "signals": found, "has_form": has_form, "blocked": blocked})
        if i % 25 == 0:
            print(f"  {i}/{len(cand)} …", file=sys.stderr)

    got = cnt["問い合わせページを取得できた"]
    print(f"\n=== 問い合わせ面（n={len(cand)} 人）===", file=sys.stderr)
    for k in ("問い合わせページを取得できた", "文言はあるがページを辿れない",
              "問い合わせ面が見つからない", "トップ取得失敗"):
        print(f"  {k:26} {cnt[k]:>4}", file=sys.stderr)

    if got:
        print(f"\n=== 取得できた {got} 件の中身 ===", file=sys.stderr)
        for k in SIGNALS:
            print(f"  {k:20} {cnt[k]:>4} = {cnt[k]/got*100:5.1f}%", file=sys.stderr)
        print(f"  {'フォームタグが無い':20} {cnt['フォームタグが無い']:>4} = "
              f"{cnt['フォームタグが無い']/got*100:5.1f}%", file=sys.stderr)
        b = cnt["**人間確認で機械送信を拒んでいる**"]
        print(f"\n  **人間確認あり {b}/{got} = {b/got*100:.1f}%**", file=sys.stderr)
        print(f"  人間確認なし {got-b}/{got} = {(got-b)/got*100:.1f}%"
              f"（※これは『送ってよい』という意味ではない）", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "contact_automatability.json"
    p.write_text(json.dumps(
        {"n_target": len(cand), "counts": dict(cnt), "rows": rows,
         "caveat": "送信は一切していない。フォームのHTMLを読んだだけ。"
                   "CAPTCHA が無いことは『送ってよい』という意味ではなく、"
                   "多くのサイトの利用規約は自動化されたアクセスを禁じている。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
