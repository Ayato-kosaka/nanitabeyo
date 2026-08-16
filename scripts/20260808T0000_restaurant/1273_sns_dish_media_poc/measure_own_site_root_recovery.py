#!/usr/bin/env python3
"""#1273 自社サイト経路の「取れなかった 152 店」を、**ドメイン根から取り直す**

## なぜ

天井を決めているのは r_L（リンク層の実効）で、その最大項は自社サイト経路である。
そして自社サイト経路の測定は **305 店中 153 店しか取得できていない**。
残り 152 店を「画像が無い」と数えるか除外するかで、天井が
**19.26% 〜 25.63%** と 6.4pt も動く。**この幅の正体は取得失敗である。**

失敗理由を数え直すと、最大の塊は次だった:

    env_http80_blocked(https_err=http_404)   29
    env_http80_blocked(https_err=ssl)        19
    urlerror                                 31
    env_http80_blocked(https_err=http_403)   11

`own-website-images.py` は `http://host/deep/path.php` を
`https://host/deep/path.php` に**スキームだけ差し替えて**再試行していた。
**ドメインの根（`https://host/`）は試していない。**
`https_err=http_404` の 29 件は「https は生きているが、そのパスが無い」であって、
**根から入れば取れる可能性がある。**

## この環境の制約（先に確定させた事実）

`/root/.ccr/README.md` に明記されている:

> ### "405 Method Not Allowed" from the proxy
> The tool sent a plain-HTTP (non-CONNECT) request … **only HTTPS_PROXY is supported.**

実際に `http_proxy` を立てて叩くと **405**、立てないと **DNS が引けない**
（`CLAUDE_CODE_PROXY_RESOLVES_HOSTS=true` でプロキシ側しか名前解決しない）。
**平文 HTTP はこの環境では原理的に取得できない。** 回避策は無い。
したがって「https が生きているか」を根まで含めて総当たりするのが唯一の前進である。

## 測るもの

未解決の 152 店について、次の順で **https だけ**を試す:

    1. https://<host>/            （根）
    2. https://www.<host>/        （www を足す）
    3. https://<host の www を外したもの>/

取れたら `own-website-images.py` の `process()` を**そのまま**呼ぶ
（robots.txt 尊重・1ホスト1接続・間隔制御・料理画像判定は元のまま）。

出すのは3つ:

  1. **回収率**: 未解決 152 店のうち何店が取れるようになったか
  2. **回収分の料理画像あり率**
  3. **天井への効き**: シナリオ A（未取得は全部「画像無し」）がどれだけ動くか

## この測定が言えないこと

  - 根が取れても、その店のページとは限らない（ドメイン共有・移転済み）。
    **料理画像の判定は元のスクリプトと同じなので、そこの精度は変わらない**
  - 平文 HTTP のみのサイトは**この環境では永久に測れない**。下限として残る

実行:
    python3 measure_own_site_root_recovery.py --limit 0
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
SRC = OUT_DIR / "own-website-images.json"

# 元スクリプトはファイル名にハイフンがあり import できないので spec から読む
_spec = importlib.util.spec_from_file_location("ownsite", HERE / "own-website-images.py")
ownsite = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ownsite)          # noqa: E402

# 「まだ決着していない」理由。real（robots_disallow / 404 / not_html など）は
# 取得できた上での結論なので**触らない**。
UNRESOLVED_PREFIX = ("env_http80_blocked",)
UNRESOLVED_EXACT = {"urlerror", "http_403", "timeout", "ssl", "http_429", "http_503"}


def roots(website: str) -> list[str]:
    p = urllib.parse.urlsplit(website if "//" in website else "http://" + website)
    host = p.netloc
    if not host:
        return []
    out = [f"https://{host}/"]
    if host.startswith("www."):
        out.append(f"https://{host[4:]}/")
    else:
        out.append(f"https://www.{host}/")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    d = json.loads(SRC.read_text(encoding="utf-8"))
    res = d["results"]
    unresolved = [r for r in res
                  if str(r.get("fail_reason") or "").startswith(UNRESOLVED_PREFIX)
                  or r.get("fail_reason") in UNRESOLVED_EXACT]
    if args.limit:
        unresolved = unresolved[: args.limit]

    n_ok_before = sum(1 for r in res if not r.get("fail_reason"))
    print(f"元の測定: {len(res)} 店中 取得できた {n_ok_before} / "
          f"**未解決 {len(unresolved)}**", file=sys.stderr)

    recovered, still = [], []
    for i, r in enumerate(unresolved, 1):
        got = None
        for u in roots(r.get("website") or ""):
            html, err, final = ownsite.get_page(u)
            if html is not None:
                got = u
                break
        if not got:
            still.append({"name": r["name"], "website": r.get("website"),
                          "old_reason": r.get("fail_reason")})
            continue
        rec = {"id": r["id"], "name": r["name"], "locality": r["locality"],
               "tier": r["tier"], "website": got, "domain": r["domain"],
               "is_portal": r["is_portal"]}
        out = ownsite.process(rec)
        recovered.append({"name": r["name"], "old_reason": r.get("fail_reason"),
                          "root": got, "fail_reason": out.get("fail_reason"),
                          "n_verified_dish": out.get("n_verified_dish", 0)})
        if i % 20 == 0:
            print(f"  {i}/{len(unresolved)}  回収 {len(recovered)}", file=sys.stderr)

    n_page_ok = len(recovered)
    n_dish = sum(1 for r in recovered if r["n_verified_dish"] >= 1)

    print(f"\n=== 回収 ===", file=sys.stderr)
    print(f"  未解決 {len(unresolved)} 店のうち、**根から取れた {n_page_ok} 店 = "
          f"{n_page_ok/max(len(unresolved),1)*100:.2f}%**", file=sys.stderr)
    print(f"  そのうち**料理画像あり {n_dish} 店 = "
          f"{n_dish/max(n_page_ok,1)*100:.2f}%**", file=sys.stderr)

    # 旧理由ごとの回収率（どのバケツが本当に環境要因だったか）
    print(f"\n=== 旧理由ごとの回収率 ===", file=sys.stderr)
    agg: dict[str, list[int]] = {}
    for r in recovered:
        agg.setdefault(r["old_reason"], [0, 0])[0] += 1
    for r in still:
        agg.setdefault(r["old_reason"], [0, 0])[1] += 1
    for k in sorted(agg, key=lambda x: -(agg[x][0] + agg[x][1])):
        ok, ng = agg[k]
        print(f"  {k[:44]:46} 回収 {ok:>3} / 駄目 {ng:>3} = "
              f"{ok/max(ok+ng,1)*100:5.1f}%", file=sys.stderr)

    # --- 天井への効き -------------------------------------------------------
    n_dish_before = d["n_store_with_verified_dish_image"]
    n_with_site = d["n_with_website"]
    before = n_dish_before / n_with_site
    after = (n_dish_before + n_dish) / n_with_site
    print(f"\n=== 天井への効き（シナリオA: 未取得は全部「画像無し」）===",
          file=sys.stderr)
    print(f"  料理画像あり  {n_dish_before} → **{n_dish_before + n_dish}** 店 "
          f"/ website 所持 {n_with_site}", file=sys.stderr)
    print(f"  自社サイトの料理画像あり率 {before*100:.2f}% → **{after*100:.2f}%**"
          f"（+{(after-before)*100:.2f}pt）", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "own_site_root_recovery.json"
    p.write_text(json.dumps({
        "n_unresolved": len(unresolved), "n_recovered_page": n_page_ok,
        "n_recovered_with_dish": n_dish,
        "recovery_rate": n_page_ok / max(len(unresolved), 1),
        "dish_rate_among_recovered": n_dish / max(n_page_ok, 1),
        "own_site_dish_rate_before": before, "own_site_dish_rate_after": after,
        "by_old_reason": {k: {"recovered": v[0], "failed": v[1]}
                          for k, v in agg.items()},
        "recovered": recovered, "still_failed": still[:200],
        "env_fact": "平文HTTPはこの環境では取得不能（http_proxy を立てると 405、"
                    "立てないと DNS が引けない）。/root/.ccr/README.md に "
                    "「only HTTPS_PROXY is supported」と明記されている。",
        "caveat": "根が取れてもその店のページとは限らない（ドメイン共有・移転）。"
                  "料理画像の判定は元スクリプトと同一なので精度は変わらない。"
                  "平文HTTPのみのサイトはこの環境では測れず、下限として残る。",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
