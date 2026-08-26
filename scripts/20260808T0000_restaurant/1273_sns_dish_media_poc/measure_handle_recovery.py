#!/usr/bin/env python3
"""#1269 ハンドル取得率を上げる — 取得に失敗したサイトを回収する

## なぜ

Instagram ハンドルの取得率 **15.17%（91/600）** は「母集団の性質」ではなく
**クローラの性能**だった。内訳を見ると:

    website を持つ店          305 / 600 = 50.8%
    **そのうち HTML を取れた   158 / 305 = 51.8%**   ← ここが半分
    取れたサイトに IG リンク    84 / 158 = 53.2%

**取得成功率が半分しかない。** IG リンク率 53.2% を据え置いて成功率だけ上げると:

    取得成功 51.8%（現状） → ハンドル 15.17%
    取得成功 70%           → ハンドル 20.08%
    取得成功 90%           → ハンドル 25.49%

## 何を試すか（失敗理由ごとに手を変える）

| 失敗理由 | 件数 | 対処 | 根拠 |
|---|---:|---|---|
| `urlerror` | 42 | https↔http・www 有無・ドメインルート | 別測定でルート回収 28.5% |
| `http_404` | 36 | **ドメインルート** | 別測定で **86.2% 回収** |
| `ssl` | 22 | http:// へ降格して再試行（**別枠で数える**） | 前回 0/19 だったので期待は低い |
| `http_403` | 18 | **何もしない** | UA を偽らない方針。相手の拒否である |
| `robots_disallow` | 9 | **何もしない** | 明示的な拒否。回収対象にしない |
| `http_429` / `503` / `timeout` | 7 | 間隔を空けて再試行 | 一時的な失敗 |
| `not_html` / その他 | 12 | 対象外 | |

**`http_403` と `robots_disallow` は回収しない。** 相手が拒否しているものを、
UA を変えたり robots を無視したりして取りにいくことはしない。

## この測定が言えないこと

  - 回収できたサイトの IG リンク率が、既に取れていた 53.2% と同じとは限らない
    （取りにくいサイトは作りも古い可能性がある）。**回収分は別に数える**
  - 600店の標本での話である

実行:
    python3 measure_handle_recovery.py
"""

from __future__ import annotations

import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
UA = "nanitabeyo-research/1.0 (dish-media feasibility PoC)"
TIMEOUT = 20

RETRY = {"urlerror", "http_404", "http_429", "http_503", "timeout", "http_302"}
SSL_ONLY = {"ssl"}
NEVER = {"robots_disallow", "http_403"}      # 相手の拒否。回収しない

IG = re.compile(r"https?://(?:www\.)?instagram\.com/([A-Za-z0-9_.]{2,30})", re.I)
IG_SKIP = {"p", "reel", "tv", "explore", "accounts", "about", "developer",
           "legal", "directory", "instagram"}


def candidates(website: str, reason: str) -> list[str]:
    w = website if "//" in website else "http://" + website
    p = urllib.parse.urlsplit(w)
    host = p.netloc
    if not host:
        return []
    alt = host[4:] if host.startswith("www.") else "www." + host
    if reason in SSL_ONLY:
        # 証明書で落ちた相手にだけ http へ降格する。**別枠で数える**
        return [f"http://{host}/", f"http://{alt}/"]
    out = [f"https://{host}/", f"https://{alt}/"]
    if p.path and p.path not in ("", "/"):
        out.insert(0, f"https://{host}{p.path}")
    out.append(f"http://{host}/")
    return out


def fetch(url: str) -> str | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            ct = (r.headers.get("Content-Type") or "").lower()
            if "html" not in ct:
                return None
            raw = r.read(1_500_000)
        for enc in ("utf-8", "cp932", "euc-jp"):
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", "replace")
    except Exception:                                            # noqa: BLE001
        return None


def handles(html: str) -> set[str]:
    out = set()
    for m in IG.finditer(html):
        h = m.group(1).lower().strip("/")
        if h and h not in IG_SKIP and not h.startswith("explore"):
            out.add(h)
    return out


def main() -> None:
    d = json.loads((OUT_DIR / "site-to-sns-bridge.json").read_text(encoding="utf-8"))
    rows = d["results"]
    targets = [r for r in rows
               if r.get("fail_reason") in (RETRY | SSL_ONLY) and r.get("website")]
    skipped = [r for r in rows if r.get("fail_reason") in NEVER]
    print(f"回収対象 {len(targets)} 件 / 回収しない（相手の拒否）{len(skipped)} 件",
          file=sys.stderr)

    rec, rec_ssl, got_ig, got_ig_ssl = 0, 0, 0, 0
    detail = []
    for i, r in enumerate(targets, 1):
        reason = r["fail_reason"]
        html = None
        used = None
        for u in candidates(r["website"], reason):
            html = fetch(u)
            if html:
                used = u
                break
            time.sleep(0.3)
        hs = handles(html) if html else set()
        if html:
            if reason in SSL_ONLY:
                rec_ssl += 1
                got_ig_ssl += bool(hs)
            else:
                rec += 1
                got_ig += bool(hs)
        detail.append({"name": r.get("name"), "website": r.get("website"),
                       "reason": reason, "recovered": bool(html), "url": used,
                       "handles": sorted(hs)[:3]})
        if i % 20 == 0 or i == len(targets):
            print(f"  [{i}/{len(targets)}] 回収 {rec}(+ssl {rec_ssl}) / "
                  f"IG 取得 {got_ig}(+ssl {got_ig_ssl})", file=sys.stderr, flush=True)
        time.sleep(0.2)

    N = d["sample_size"]
    site = d["n_with_website"]
    ok0 = d["n_html_ok"]
    ig0 = d["site_extracted"]["per_platform"]["instagram"] + 7   # +7 は website 自体が IG
    n_retry = sum(1 for r in targets if r["fail_reason"] in RETRY)
    n_ssl = sum(1 for r in targets if r["fail_reason"] in SSL_ONLY)

    print("\n=== 回収の結果 ===", file=sys.stderr)
    print(f"  通常の回収  {rec}/{n_retry} = "
          f"{rec/max(n_retry,1)*100:.1f}%  → うち IG リンクあり **{got_ig}**",
          file=sys.stderr)
    print(f"  SSL 降格    {rec_ssl}/{n_ssl} = "
          f"{rec_ssl/max(n_ssl,1)*100:.1f}%  → うち IG リンクあり **{got_ig_ssl}**",
          file=sys.stderr)

    ok1 = ok0 + rec + rec_ssl
    ig1 = ig0 + got_ig + got_ig_ssl
    print(f"\n=== ハンドル取得率 ===", file=sys.stderr)
    print(f"  取得成功  {ok0}/{site} = {ok0/site*100:.1f}%"
          f"  →  **{ok1}/{site} = {ok1/site*100:.1f}%**", file=sys.stderr)
    print(f"  ハンドル  {ig0}/{N} = {ig0/N*100:.2f}%"
          f"  →  **{ig1}/{N} = {ig1/N*100:.2f}%**", file=sys.stderr)
    print(f"  回収分の IG リンク率 {got_ig+got_ig_ssl}/{max(rec+rec_ssl,1)} = "
          f"{(got_ig+got_ig_ssl)/max(rec+rec_ssl,1)*100:.1f}%"
          f"（既取得分は 53.2%）", file=sys.stderr)

    p = OUT_DIR / "handle_recovery.json"
    p.write_text(json.dumps(
        {"n_targets": len(targets), "n_skipped_refused": len(skipped),
         "recovered": rec, "recovered_ssl": rec_ssl,
         "ig_found": got_ig, "ig_found_ssl": got_ig_ssl,
         "html_ok_before": ok0, "html_ok_after": ok1, "n_with_website": site,
         "handles_before": ig0, "handles_after": ig1, "sample_size": N,
         "handle_rate_before": ig0 / N, "handle_rate_after": ig1 / N,
         "detail": detail,
         "caveat": "http_403 と robots_disallow は相手の拒否なので回収していない。"
                   "回収分の IG リンク率は既取得分と別に数えている。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
