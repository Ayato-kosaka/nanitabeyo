#!/usr/bin/env python3
"""#1269 Phase 0 — Business Discovery を実際に叩いて、#1640 の答えごと出す

## なぜ目視（#1640）ではなくこちらなのか

#1640 は「40件のプロフィールを開いて Professional か見る」だった。
**私は Instagram を取得できない。** robots.txt が

    # Collection of data on Instagram through automated means is prohibited
    User-agent: ClaudeBot
    Disallow: /

と、**全面禁止＋私を名指し**で宣言している。だから目視はオーナーの手作業になる。

**しかしトークンさえあれば、API のほうが目視より優れている。**

| | #1640 目視40件 | **本スクリプト** |
|---|---|---|
| Professional 判定 | 見た目で推測 | **API が確定的に返す** |
| 件数 | 40 | **96（抽出済み全件）** |
| ページネーション | 分からない | **同時に分かる** |
| プロフィールの website | 手で書き写す | **同時に取れる**（誤紐付けの逆照合に直結） |
| 手作業 | 20〜30分 | **0分**（セットアップ30分のみ） |

## トークンの扱い

**トークンはチャットにも git にも載せない。** 次のどちらかで渡す。

    export IG_TOKEN='...'  IG_USER_ID='...'
    もしくは out/.ig_token（.gitignore 済み）に1行ずつ

使うのは本スクリプトの読み取り専用の呼び出しだけで、終わったら
Meta の管理画面からトークンを失効させてよい。

## セットアップ（無料・30分・法人登記不要）

  1. Instagram のプロアカウント（設定 →「プロアカウントに切り替え」）
  2. Facebook ページを作り、上の IG アカウントと連携
  3. developers.facebook.com でアプリ作成 → Graph API Explorer でトークン発行
     必要な権限: instagram_basic, pages_show_list, pages_read_engagement
  4. 自分の IG ユーザー ID を控える（Explorer で /me/accounts から辿れる）

## この測定が言えないこと

  - **経路存在率の側**である。取れた投稿に料理写真があるかは別
  - Standard Access で動くかどうかは**叩いてみて分かる**（オーナー調査では動くはず）
  - レート上限に当たったら、そこで打ち切って部分集計する

実行:
    python3 measure_ig_business_discovery.py --limit 96
"""

from __future__ import annotations

import argparse
import collections
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
API = "https://graph.facebook.com/v21.0"


def creds() -> tuple[str, str]:
    tok, uid = os.environ.get("IG_TOKEN"), os.environ.get("IG_USER_ID")
    f = OUT_DIR / ".ig_token"
    if (not tok or not uid) and f.exists():
        lines = [x.strip() for x in f.read_text(encoding="utf-8").splitlines() if x.strip()]
        if len(lines) >= 2:
            tok, uid = tok or lines[0], uid or lines[1]
    if not tok or not uid:
        print("トークンがありません。次のどちらかで渡してください。\n"
              "  export IG_TOKEN='...' IG_USER_ID='...'\n"
              f"  {f} に1行目トークン・2行目 IG ユーザーID", file=sys.stderr)
        raise SystemExit(2)
    return tok, uid


def handles() -> list[str]:
    d = json.loads((OUT_DIR / "site-to-sns-bridge.json").read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for r in d["results"]:
        hs = [re.sub(r"^instagram\.com/", "", a).strip("/").split("?")[0].lower()
              for a in (r.get("accounts", {}).get("instagram") or [])]
        w = r.get("website") or ""
        if "instagram.com" in w:
            hs.append(re.sub(r".*instagram\.com/", "", w).strip("/").split("?")[0].lower())
        for h in hs:
            if h and h not in out:
                out[h] = r["name"]
    return [f"{h}\t{n}" for h, n in out.items()]


def call(uid: str, tok: str, handle: str) -> dict:
    fields = (f"business_discovery.username({handle})"
              "{id,username,name,website,followers_count,media_count,"
              "media.limit(25){id,caption,media_type,permalink,timestamp}}")
    url = f"{API}/{uid}?" + urllib.parse.urlencode({"fields": fields, "access_token": tok})
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return {"ok": True, "data": json.loads(r.read())}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read())
        except Exception:                                        # noqa: BLE001
            body = {}
        err = (body.get("error") or {})
        return {"ok": False, "code": err.get("code"), "subcode": err.get("error_subcode"),
                "message": (err.get("message") or "")[:200], "http": e.code}
    except Exception as e:                                       # noqa: BLE001
        return {"ok": False, "code": None, "message": type(e).__name__}


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=96)
    ap.add_argument("--sleep", type=float, default=1.0)
    args = ap.parse_args()
    tok, uid = creds()
    rows = handles()[: args.limit]
    print(f"ハンドル {len(rows)} 件を叩く", file=sys.stderr)

    res = []
    for i, line in enumerate(rows, 1):
        h, store = line.split("\t", 1)
        r = call(uid, tok, h)
        rec = {"handle": h, "store": store}
        if r["ok"]:
            bd = (r["data"].get("business_discovery") or {})
            media = (bd.get("media") or {})
            rec |= {"professional": True, "name": bd.get("name"),
                    "website": bd.get("website"), "followers": bd.get("followers_count"),
                    "media_count": bd.get("media_count"),
                    "n_media_returned": len(media.get("data") or []),
                    "has_next_page": bool((media.get("paging") or {}).get("next")),
                    "sample_captions": [(m.get("caption") or "")[:80]
                                        for m in (media.get("data") or [])[:3]]}
        else:
            rec |= {"professional": False, "code": r.get("code"),
                    "subcode": r.get("subcode"), "message": r.get("message")}
        res.append(rec)
        mark = "P" if rec["professional"] else "-"
        print(f"  [{i:>3}/{len(rows)}] {mark} {h[:28]:30} "
              f"{rec.get('media_count','') if rec['professional'] else rec.get('message','')[:40]}",
              file=sys.stderr, flush=True)
        # レート上限に当たったら打ち切って部分集計する
        if not r["ok"] and r.get("code") in (4, 17, 32, 613):
            print(f"  レート上限（code {r.get('code')}）で打ち切り", file=sys.stderr)
            break
        time.sleep(args.sleep)

    n = len(res)
    pro = [r for r in res if r["professional"]]
    lo, hi = wilson(len(pro), n)
    print(f"\n=== Professional アカウント率 ===", file=sys.stderr)
    print(f"  **{len(pro)}/{n} = {len(pro)/n*100:.2f}%**  95%CI "
          f"{lo*100:.1f}〜{hi*100:.1f}%", file=sys.stderr)
    print(f"  失敗の内訳: "
          f"{dict(collections.Counter(r.get('code') for r in res if not r['professional']))}",
          file=sys.stderr)
    if pro:
        nxt = sum(1 for r in pro if r["has_next_page"])
        web = sum(1 for r in pro if r.get("website"))
        mc = sorted(r["media_count"] or 0 for r in pro)
        print(f"\n  ページネーションが回る {nxt}/{len(pro)}", file=sys.stderr)
        print(f"  プロフィールに website あり **{web}/{len(pro)}**"
              f"（誤紐付けの逆照合に使える）", file=sys.stderr)
        print(f"  投稿数の中央値 {mc[len(mc)//2]}", file=sys.stderr)

    HANDLE_RATE = 0.1617      # out/handle_recovery_labels.json（目視補正後）
    if n:
        print(f"\n=== #1269 の到達率（帰属の質を掛ける前）===", file=sys.stderr)
        for lab, r in (("CI下端", lo), ("点推定", len(pro)/n), ("CI上端", hi)):
            print(f"  {lab:6} {HANDLE_RATE*100:.2f}% × {r*100:5.2f}% = "
                  f"**{HANDLE_RATE*r*100:5.2f}%**", file=sys.stderr)
        print("  ここに帰属の質（店固有 33.3% / チェーン込み 72.2%）を掛ける", file=sys.stderr)

    p = OUT_DIR / "ig_business_discovery.json"
    p.write_text(json.dumps({"n": n, "n_professional": len(pro),
                             "professional_rate": len(pro)/n if n else None,
                             "ci": [lo, hi], "rows": res,
                             "caveat": "経路存在率。取れた投稿に料理写真があるかは別。"},
                            ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
