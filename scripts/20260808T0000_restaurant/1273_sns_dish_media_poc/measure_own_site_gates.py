#!/usr/bin/env python3
"""#1273 店舗自社サイト経路の判定ゲートを組み替えて、どこまで伸ばせるかを上限で押さえる

## なぜ

リンク層は現在 48.0%。70% に届くには 85.06% が要る（`measure_misskey_ceiling.py`）。
48.0% は「YouTube ∪ 店舗自社サイト」で、自社サイト側は
**リンク保有 56.14% に対して実効 7.16%** しか出ていない。ここは供給ではなく実装の問題。

`own-website-images.py:410` の判定はゲート2つだけである:

    if v["ok"] and min(v["w"], v["h"]) >= 300 and c["food_word"]:

**画像そのものを見ていない。** 寸法とキーワードという2つの代理変数で決めている。
取得に成功した153店のうち61店が「候補はあるのに0件」で落ちており、
その61店が持つ取得成功画像225枚の落ち方は:

| 寸法 | 食語 | 枚数 |
|---|---|---|
| NG | OK | 112（min(w,h)の中央値 131） |
| OK | NG | 85 |
| NG | NG | 28 |

本スクリプトはキャッシュ済みの `out/own-website-images.json` だけを使い、
**再取得せずに**ゲートを組み替えたときのカバレッジを計算する。
「どこまで伸ばせるか」を上限で押さえ、37pt の不足を埋められるかを判定するのが目的。

実行:
    python3 measure_own_site_gates.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

# measure_seed_population.py / measure_misskey_ceiling.py の実測値。
TOTAL_SEEDS = 1_132_482
SHARE_LINK = 789_235 / TOTAL_SEEDS
SHARE_LINKLESS = 343_247 / TOTAL_SEEDS
LINKLESS_RATE = 0.3537  # YouTube ∪ Misskey（独立仮定・上限）
REQUIRED_LINK_COVERAGE = 0.8506  # 70% に届くために必要
CURRENT_LINK_COVERAGE = 0.480  # YouTube ∪ 自社サイト の現状

# own-website-images.py:410 の現行ゲート。
CURRENT_MIN_DIM = 300


def passes(v: dict, min_dim: int, require_food_word: bool) -> bool:
    if not v.get("ok"):
        return False
    if min(v.get("w") or 0, v.get("h") or 0) < min_dim:
        return False
    if require_food_word and not v.get("food_word"):
        return False
    return True


def main() -> None:
    path = OUT_DIR / "own-website-images.json"
    if not path.exists():
        raise SystemExit(f"#1304 の測定結果が無い: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    results = data["results"]
    n_sample = data["sample_size"]
    precision = data["visual_verification"]["precision"]

    fetch_ok = [r for r in results if not r.get("fail_reason")]
    env_blocked = [
        r for r in results if (r.get("fail_reason") or "").startswith("env_http80_blocked")
    ]

    print(f"600店中 website あり {len(results)} / 取得成功 {len(fetch_ok)} / "
          f"環境で評価不能 {len(env_blocked)}", file=sys.stderr)

    print("\n=== ゲートを組み替えたときのカバレッジ（600店に対する raw）===", file=sys.stderr)
    print("min(w,h)  食語必須   該当店  raw%    現行比", file=sys.stderr)
    rows = []
    baseline = None
    for min_dim in (300, 250, 200, 150, 100, 0):
        for require_food in (True, False):
            covered = sum(
                1 for r in fetch_ok if any(passes(v, min_dim, require_food) for v in r["verified"])
            )
            raw = covered / n_sample * 100
            if min_dim == CURRENT_MIN_DIM and require_food:
                baseline = raw
            rows.append({"min_dim": min_dim, "require_food_word": require_food,
                         "covered": covered, "raw_pct": raw})
    for row in rows:
        delta = f"{row['raw_pct'] - baseline:+.2f}pt" if baseline is not None else ""
        mark = " <- 現行" if row["min_dim"] == CURRENT_MIN_DIM and row["require_food_word"] else ""
        print(
            f"  {row['min_dim']:>4}    {'要' if row['require_food_word'] else '不要':>4}"
            f"     {row['covered']:>4}  {row['raw_pct']:>5.2f}%  {delta:>8}{mark}",
            file=sys.stderr,
        )

    # 上限: 取得に成功した店は全て使える料理写真を1枚持っていた、という最も甘い仮定。
    upper_raw = len(fetch_ok) / n_sample * 100
    print(f"\n理論上限（取得成功した {len(fetch_ok)} 店が全て料理写真を持つ）: "
          f"{upper_raw:.2f}%", file=sys.stderr)

    # #1273 【設計】ここで「精度を上げれば届く」と言わないために、
    # 最も甘い上限でリンク層がどこまで行くかを出して、必要な 85.06% と突き合わせる。
    print("\n=== 不足 37pt を埋められるか ===", file=sys.stderr)
    print(f"  70% に必要なリンク層カバレッジ : {REQUIRED_LINK_COVERAGE * 100:.2f}%",
          file=sys.stderr)
    print(f"  現在のリンク層                : {CURRENT_LINK_COVERAGE * 100:.2f}%",
          file=sys.stderr)

    # 自社サイトを上限まで伸ばしたときのリンク層。YouTube(33.5%)との和集合を
    # 「完全に独立」という最も甘い仮定で上限だけ出す。
    yt_on_link_layer = 0.335
    own_site_now = 0.1533
    own_site_upper = upper_raw / 100
    union_now = 1 - (1 - yt_on_link_layer) * (1 - own_site_now)
    union_upper = 1 - (1 - yt_on_link_layer) * (1 - own_site_upper)
    print(
        f"\n  自社サイトを raw 上限 {upper_raw:.2f}% まで伸ばし、YouTube 33.5% と"
        f"完全独立と仮定しても、\n"
        f"  リンク層は {union_now * 100:.2f}% -> **{union_upper * 100:.2f}%** にしかならない。",
        file=sys.stderr,
    )
    gap = (REQUIRED_LINK_COVERAGE - union_upper) * 100
    print(f"  必要な {REQUIRED_LINK_COVERAGE * 100:.2f}% には **{gap:.2f}pt 足りない。**",
          file=sys.stderr)

    ceiling_upper = (union_upper * SHARE_LINK + LINKLESS_RATE * SHARE_LINKLESS) * 100
    print(f"\n  そのときの全体の天井: **{ceiling_upper:.2f}%**（要求 70%）", file=sys.stderr)
    print(
        "\n**結論: 自社サイトの判定を完璧にしても 70% には届かない。**"
        "ただし無料で数pt は取れるので、やる価値はある。",
        file=sys.stderr,
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "own_site_gates.json"
    out_path.write_text(
        json.dumps(
            {
                "n_sample": n_sample,
                "n_with_website": len(results),
                "n_fetch_ok": len(fetch_ok),
                "n_env_blocked": len(env_blocked),
                "visual_precision": precision,
                "gate_grid": rows,
                "own_site_upper_raw_pct": upper_raw,
                "link_layer_now_pct": union_now * 100,
                "link_layer_upper_pct": union_upper * 100,
                "required_link_coverage_pct": REQUIRED_LINK_COVERAGE * 100,
                "gap_pt": gap,
                "overall_ceiling_upper_pct": ceiling_upper,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
