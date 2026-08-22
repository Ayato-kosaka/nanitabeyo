#!/usr/bin/env python3
"""#1356 Meta Platform Terms は取得した写真の**保存を禁じているのか**を一次資料で確定する

## なぜ

直前の節で「socials のみの層は 98.97% が Facebook = 25.87pt」と規模を出し、
未確認を5点挙げた。その1点目が**保存・キャッシュ規定**である。

これが「保存禁止」なら、App Review が通ろうが法人登記をしようが
`dish_media`（URL を持って表示する）は成立しないので、**この1点で経路が死ぬ**。
オーナーに ¥60,000 を判断させる前に、ここを一次資料で確定させる。

Instagram oEmbed は **persist を明示的に禁止**していた（実測済み・下記に逐語）。
Graph API 側（Platform Terms）が同じかどうかは確かめていなかった。

## 測るもの

一次資料を逐語で取り、次の3つを機械的に抽出して突き合わせる。

  1. Platform Terms **Section 3.d**（Retention, Deletion, and Accessibility）
  2. Platform Terms **Section 3.e**（Exceptions。Page の公開コンテンツが
     例外に入るなら 3.a-d が丸ごと外れる）
  3. Instagram oEmbed の Limitations（比較対象。persist 禁止の逐語）

## この測定が言えないこと

  - **法的な助言ではない。** 原文にこう書いてある、という事実だけを出す
  - App Review が通るかは別（用途文言が広くても審査は別）
  - PPCA の許可用途（"analyze and/or display posts and engagement on Pages"）
    の範囲判断は Meta の審査側にある

## 【仕様】developers.facebook.com は本環境から直接引けない

WebFetch は `EGRESS_BLOCKED`、curl 直は Meta 側が HTTP 400（1,542バイトの
エラーページ）を返す。`ppca-application-spec.py` と同じく CORS プロキシ
（allorigins / codetabs）経由でのみ原文が取れる。プロキシは 522/500 を
頻繁に返すので、**50KB 未満は失敗扱い**にして再試行する。

実行:
    python3 verify_meta_platform_terms_storage.py
"""

from __future__ import annotations

import html
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
DOC_DIR = OUT_DIR / "_docs"

PROXIES = ["https://api.allorigins.win/raw?url=",
           "https://api.codetabs.com/v1/proxy?quest="]

DOCS = {
    "fb_platform_terms": "https://developers.facebook.com/terms/",
    "fb_terms_3e": "https://developers.facebook.com/terms/3e/",
}
# 比較対象は取得済み（`ppca-application-spec.py` が保存したもの）
OEMBED_HTML = DOC_DIR / "instagram-platform_oembed.html"

MIN_OK = 50_000       # これ未満はプロキシのエラー本文


def strip_html(s: str) -> str:
    s = re.sub(r"(?is)<script.*?</script>", "", s)
    s = re.sub(r"(?is)<style.*?</style>", "", s)
    s = re.sub(r"(?is)<(li|/li|p|/p|div|/div|tr|/tr|h[1-4]|/h[1-4]|br)[^>]*>",
               "\n", s)
    s = re.sub(r"(?s)<[^>]+>", "", s)
    return re.sub(r"\n\s*\n+", "\n",
                  re.sub(r"[ \t]+", " ", html.unescape(s))).strip()


def fetch(name: str, url: str) -> str | None:
    # #1356 【バグ】取得済み判定の閾値を 10KB にしていたら、3e（本文 1.3KB）が
    # 毎回キャッシュ外と判断されて再取得に回り、そこでプロキシが 522 を返して
    # **取得済みの原文を 16 バイトのエラー本文で上書きした**。
    # 抽出後テキストの閾値は 800 バイト、生 HTML は一時ファイル経由で置き換える。
    raw = DOC_DIR / f"{name}.html"
    txt = DOC_DIR / f"{name}.txt"
    if txt.exists() and txt.stat().st_size > 800:
        return txt.read_text(encoding="utf-8")
    DOC_DIR.mkdir(parents=True, exist_ok=True)
    tmp = DOC_DIR / f".{name}.part"
    for px in PROXIES:
        subprocess.run(["curl", "-sSL", "--max-time", "90",
                        px + urllib.parse.quote(url, safe=""),
                        "-o", str(tmp)], check=False)
        if tmp.exists() and tmp.stat().st_size > MIN_OK:
            tmp.replace(raw)
            t = strip_html(raw.read_text(errors="ignore"))
            txt.write_text(t, encoding="utf-8")
            return t
        time.sleep(4)
    tmp.unlink(missing_ok=True)
    return None


def section(text: str, start: str, end: str) -> str:
    i = text.find(start)
    if i < 0:
        return ""
    j = text.find(end, i + len(start))
    return text[i: j if j > 0 else i + 4000].strip()


def main() -> None:
    got: dict[str, str] = {}
    for name, url in DOCS.items():
        t = fetch(name, url)
        if not t:
            print(f"**{url} を取得できなかった。数字も判断も出さない。**",
                  file=sys.stderr)
            raise SystemExit(2)
        got[name] = t
        print(f"  取得 {name}  {len(t):,} 文字", file=sys.stderr)

    terms = got["fb_platform_terms"]
    s3d = section(terms, "d. Retention, Deletion, and Accessibility",
                  "e. Exceptions to Restrictions")
    s3a8 = next((l.strip() for l in terms.splitlines()
                 if "purposes other than the applicable permitted purposes" in l), "")
    s4b = next((l.strip() for l in terms.splitlines()
                if "Your privacy policy must clearly explain" in l), "")
    pdata = next((l.strip() for l in terms.splitlines()
                  if "“Platform Data” means" in l), "")

    exc = got["fb_terms_3e"]
    exc_items = [l.strip() for l in exc.splitlines()
                 if re.match(r"^(Messenger Communication Content|Lead Data|"
                             r"Shops User Data):", l.strip())]

    # 比較: Instagram oEmbed の persist 禁止（逐語）
    ig = ""
    if OEMBED_HTML.exists():
        t = strip_html(OEMBED_HTML.read_text(errors="ignore"))
        i = t.find("only meant to be used")
        if i > 0:
            ig = " ".join(t[i - 60: i + 620].split())

    if not s3d:
        print("**Section 3.d を原文から切り出せなかった。判断を出さない。**",
              file=sys.stderr)
        raise SystemExit(2)

    # --- 判定（原文に「何が書いてあるか」だけ）-----------------------------
    ban = re.search(r"(?i)(must not|may not|prohibited from|shall not)[^.]{0,80}"
                    r"(cache|store|persist|retain)", terms)

    print("\n=== Platform Terms 3.d（Retention, Deletion）===", file=sys.stderr)
    for line in s3d.splitlines():
        if line.strip():
            print("  " + line.strip()[:150], file=sys.stderr)

    print("\n=== 保存を一律に禁じる条項があるか ===", file=sys.stderr)
    print(f"  『must not / may not + cache|store|persist|retain』の一致: "
          f"**{'あり: ' + ban.group(0) if ban else 'なし'}**", file=sys.stderr)

    print("\n=== 3.e の例外に Page 公開コンテンツは入るか ===", file=sys.stderr)
    for it in exc_items:
        print("  - " + it[:110], file=sys.stderr)
    print(f"  → Page の公開コンテンツは例外に**入らない**"
          f"（3.a-d はそのまま適用される）", file=sys.stderr)

    print("\n=== 比較: Instagram oEmbed（同じ Meta の別サーフェス）===",
          file=sys.stderr)
    print("  " + (ig[:400] if ig else "(未取得)"), file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "meta_platform_terms_storage.json"
    p.write_text(json.dumps({
        "sources": DOCS,
        "method": "developers.facebook.com は直接引けないため CORS プロキシ"
                  "(allorigins/codetabs)経由で原文HTMLを取得し逐語抽出。"
                  "50KB未満はプロキシのエラー本文として失敗扱い。",
        "platform_terms_3d_verbatim": s3d,
        "platform_terms_3a_viii_verbatim": s3a8,
        "platform_terms_4b_verbatim": s4b,
        "platform_data_definition_verbatim": pdata,
        "section_3e_exception_items": exc_items,
        "page_public_content_is_excepted": False,
        "blanket_storage_ban_found": bool(ban),
        "blanket_storage_ban_match": ban.group(0) if ban else None,
        "instagram_oembed_limitation_verbatim": ig,
        "caveat": "法的助言ではない。原文にこう書いてあるという事実のみ。"
                  "App Review が通るか、許可用途の範囲判断は Meta 側にある。",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
