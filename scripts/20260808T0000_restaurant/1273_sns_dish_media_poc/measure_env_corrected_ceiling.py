#!/usr/bin/env python3
"""#1273 取得失敗を「環境のせい」と「本当に無い」に分けて、実効天井を引き直す

## なぜ

実効天井 18.55–20.79% の最大の項は自社サイト経路だが、その分母は
**この実行環境で取得できた 153/305 店**である。取得できなかった 152 店を
全部「dish 画像が無い店」として数えていたら、本番環境の値を過小評価する。

`measure_env_limit_bound.py` では**平文HTTP(:80)の 403 だけ**を環境起因として
75 店を除外した。しかし今日 `measure_menu_text_full.py` を回したところ、
120 店中 66 店が `http_403`、23 店が `dns` で落ち、
`$HTTPS_PROXY/__agentproxy/status` は該当ホストに
`connect_rejected`（"gateway answered 502 to CONNECT (policy denial or upstream failure)"）
を記録していた。**ゲートウェイの拒否は urlerror / dns / 403 のどれにも化ける。**

つまり 75 店という除外は**環境起因の過小カウント**である。

## やること

キャッシュ済みの 305 店の失敗理由を 3 つに分ける。**新規取得はしない。**

  - env  : 環境起因が確実（平文HTTP遮断として既に分類済み）
  - real : 本当に取れない／画像が無い（robots 拒否、404、HTMLでない、img が無い）
  - amb  : どちらとも言えない（urlerror / http_403 / timeout / ssl / 5xx / 429）

`amb` を全部 real 側に寄せた値と全部 env 側に寄せた値で**帯**を出す。
帯の下端が現行の 18.55–20.79%、上端が「環境の遮断が無ければここまで」である。

## この帯が言えないこと

上端は**本番環境で必ず出る値ではない**。amb を全部環境起因と仮定した極端であり、
本番でも robots や JS 必須は残る。**要求① の 70% には、上端でも届かない**。

実行:
    python3 measure_env_corrected_ceiling.py
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

# #1273 失敗理由の分類。キー前方一致で見る。
ENV_PREFIXES = ("env_http80_blocked",)
REAL_REASONS = {"robots_disallow", "http_404", "not_html", "js_required_or_no_img",
                "no_image_tag"}
AMBIGUOUS_REASONS = {"urlerror", "http_403", "timeout", "ssl", "http_429", "http_503",
                     "http_500", "http_502", "dns"}

SHARE_LINK = 789_235 / 1_132_482
SHARE_LINKLESS = 343_247 / 1_132_482

OWN_SITE_PRECISION_LOW = 0.467
OWN_SITE_PRECISION_HIGH = 0.750
OWN_SITE_CATEGORY = 0.767
YT_PATH = 0.2733
YT_CATEGORY = 0.500
LINKLESS_EFFECTIVE = 0.1993   # measure_effective_ceiling.py と同じ実測合成値
OWNER_TARGET = 0.70


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (c - h, c + h)


def main() -> None:
    path = OUT_DIR / "own-website-images.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data["results"]
    n_sample = data["sample_size"]
    n_with_site = len(rows)

    n_ok = n_env = n_real = n_amb = 0
    unclassified: dict[str, int] = {}
    n_dish = 0
    for r in rows:
        reason = r.get("fail_reason")
        if not reason:
            n_ok += 1
            hits = [v for v in r.get("verified", [])
                    if v.get("ok") and v.get("food_word")
                    and min(v.get("w") or 0, v.get("h") or 0) >= 200]
            if hits:
                n_dish += 1
            continue
        if reason.startswith(ENV_PREFIXES):
            n_env += 1
        elif reason in REAL_REASONS:
            n_real += 1
        elif reason in AMBIGUOUS_REASONS:
            n_amb += 1
        else:
            unclassified[reason] = unclassified.get(reason, 0) + 1

    print(f"website を持つ {n_with_site} 店の内訳", file=sys.stderr)
    print(f"  取得成功            : {n_ok}", file=sys.stderr)
    print(f"  環境起因が確実(env) : {n_env}", file=sys.stderr)
    print(f"  本当に取れない(real): {n_real}", file=sys.stderr)
    print(f"  どちらとも言えない  : {n_amb}", file=sys.stderr)
    print(f"  分類外              : {unclassified}", file=sys.stderr)
    print(f"  うち dish 画像あり  : {n_dish}", file=sys.stderr)

    # amb をどちらに寄せるかで評価可能母数が変わる。
    other = sum(unclassified.values())
    scenarios = {
        # 【自戒】最初これを「現行」と書いたが、現行の 18.55-20.79% は env 除外すら
        # していない 103/600 = 17.17% である。3段階を全部並べないと比較にならない。
        "A 無補正（取れなかった店は全部「画像が無い」）": n_with_site,
        "B env 確実分だけ除外（既存 measure_env_limit_bound と同じ）":
            n_ok + n_real + n_amb + other,
        "C amb も env 扱い（ゲートウェイ拒否は403/urlerror/dnsに化ける）": n_ok + n_real,
    }

    print(f"\n=== 自社サイト経路の dish 画像あり率 ===", file=sys.stderr)
    own_rates = {}
    for label, denom in scenarios.items():
        rate = n_dish / max(denom, 1)
        lo, hi = wilson(n_dish, denom)
        # 600 店標本に写す: website 所持率 305/600 は変わらない。
        of600 = rate * (n_with_site / n_sample)
        own_rates[label] = of600
        print(f"  {label}", file=sys.stderr)
        print(f"    評価可能 {denom} 店中 {n_dish} 店 = {rate * 100:.2f}% "
              f"(95%CI {lo * 100:.1f}–{hi * 100:.1f}%)", file=sys.stderr)
        print(f"    → 全店に対して {of600 * 100:.2f}%", file=sys.stderr)

    print(f"\n=== 実効天井の引き直し ===", file=sys.stderr)
    out_rows = []
    for label, own_img in own_rates.items():
        for plabel, precision in (("独立店 precision 46.7%", OWN_SITE_PRECISION_LOW),
                                  ("チェーン precision 75.0%", OWN_SITE_PRECISION_HIGH)):
            own_eff = own_img * precision * OWN_SITE_CATEGORY
            yt_eff = YT_PATH * YT_CATEGORY
            link_eff = 1 - (1 - own_eff) * (1 - yt_eff)
            total = link_eff * SHARE_LINK + LINKLESS_EFFECTIVE * SHARE_LINKLESS
            out_rows.append({"denominator": label, "precision": plabel,
                             "own_site_dish_image": own_img, "own_site_effective": own_eff,
                             "link_layer_effective": link_eff, "total_effective": total})
            print(f"  {label[:22]:24} / {plabel:22} → **{total * 100:.2f}%**",
                  file=sys.stderr)

    lo = min(r["total_effective"] for r in out_rows)
    hi = max(r["total_effective"] for r in out_rows)
    print(f"\n  **実効天井の帯: {lo * 100:.2f}% 〜 {hi * 100:.2f}%**", file=sys.stderr)
    print(f"  要求 {OWNER_TARGET * 100:.0f}% との差: "
          f"{(OWNER_TARGET - hi) * 100:.2f}pt 〜 {(OWNER_TARGET - lo) * 100:.2f}pt",
          file=sys.stderr)
    print(
        "\n  ※ 上端は amb を全部「環境のせい」と仮定した極端で、本番で必ず出る値ではない。\n"
        "     本番でも robots 拒否・JS 必須・404 は残る（それらは real に数えてある）。\n"
        "  ※ union を独立と仮定し、YouTube は「店名が出る動画には料理も映っている」と\n"
        "     仮定しているので、いずれも上限側に効く。**上端でも 70% には届かない。**",
        file=sys.stderr,
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "env_corrected_ceiling.json"
    out_path.write_text(
        json.dumps({"n_with_website": n_with_site, "n_sample": n_sample,
                    "n_fetch_ok": n_ok, "n_env": n_env, "n_real": n_real,
                    "n_ambiguous": n_amb, "unclassified": unclassified,
                    "n_with_dish_image": n_dish,
                    "denominators": scenarios, "scenarios": out_rows,
                    "effective_ceiling_low": lo, "effective_ceiling_high": hi,
                    "owner_target": OWNER_TARGET,
                    "evidence_env_denial": "agentproxy status が connect_rejected "
                                           "(gateway answered 502 to CONNECT) を記録"},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
