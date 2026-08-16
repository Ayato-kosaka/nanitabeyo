#!/usr/bin/env python3
"""#1273 r_N の補正を**目視ではなく再現可能な判定**に置き換える（料理語ゲート）

## なぜ

r_N を 3面すべて目視して 34.79% → 10.32〜18.16% に直した。しかし
**目視は私の判断であって、回し直しても再現しない。** 施策の評価に使う数字が
人手ラベル頼みなのは弱い。**機械で同じ補正ができるかを確かめる。**

仮説は単純である。**dish_media に要るのは料理写真なので、
店名が当たっただけでなく「料理語が一緒に出ている」ことを要求すればよい。**
（`measure_effective_ceiling.py` のコメントに
「カテゴリ付与率 ≒ 店名マッチの精度」と書いてあったのと同じ発想。）

## 測るもの

保存済みのヒット本文（YouTube はタイトル / Misskey・Bluesky は投稿本文）に
`CategoryMatcher` を当て、**料理カテゴリが付くものだけを残す**。そのうえで

  1. ゲート後の **precision**（目視ラベルを正解として測る）
  2. ゲートが**取りこぼした TP**（recall の損）
  3. ゲート後の r_N と、目視補正した r_N の一致

を出す。**目視ラベルはゲートの検証にだけ使い、数字そのものには使わない。**

## この判定が言えないこと

  - ゲートは AND なので**ヒットを減らすことしかしない**。
    元々ヒットしなかったものは拾えない（**下限**）
  - 本文に料理語が無いが映像には料理がある、という取りこぼしは残る
  - 料理語の辞書（`dish_category_matcher`）の精度に依存する

実行:
    python3 measure_rn_category_gate.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dish_category_matcher import CategoryMatcher  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

W_LINK = 789_235 / 1_132_482
W_NOLINK = 343_247 / 1_132_482
OWNER_TARGET = 0.70
R_L_MEASURED_MAX = 0.3820
N_SAMPLE = 150


def load_youtube() -> list[dict]:
    d = json.loads((OUT_DIR / "seed_youtube_ceiling.json").read_text(encoding="utf-8"))
    return [{"name": r["name"],
             "text": (r.get("best_match") or {}).get("title") or ""}
            for r in d["results"]["without_overture"] if r.get("hit")]


def load_bluesky() -> list[dict]:
    d = json.loads((OUT_DIR / "bluesky_ceiling.json").read_text(encoding="utf-8"))
    return [{"name": r["name"], "text": (r.get("best_match") or {}).get("text") or ""}
            for r in d["layers"]["without_overture"]["detail"] if r.get("hit")]


def load_misskey() -> list[dict]:
    d = json.loads((OUT_DIR / "misskey_hit_review.json").read_text(encoding="utf-8"))
    return [{"name": r["name"], "text": r.get("text") or ""}
            for r in d["layers"]["without_overture"]["rows"] if not r.get("gone")]


def labels(fn: str, key: str = "without_overture") -> tuple[set, set]:
    d = json.loads((OUT_DIR / fn).read_text(encoding="utf-8"))[key]
    strict = {x if isinstance(x, str) else x["name"] for x in d["strict_tp"]}
    loose = strict | {x["name"] for x in d.get("loose_only_tp", [])}
    return strict, loose


SURFACES = {
    "YouTube": (load_youtube, "youtube_strata_hit_labels.json", 0.2533),
    "Misskey": (load_misskey, "misskey_hit_labels.json", 0.1267),
    "Bluesky": (load_bluesky, "bluesky_hit_labels.json", 0.1333),
}


def main() -> None:
    cm = CategoryMatcher()
    rows = {}
    gated_rates = []

    for surface, (loader, label_file, raw_rate) in SURFACES.items():
        hits = loader()
        _, loose = labels(label_file)
        kept, dropped_tp, kept_fp = [], [], []
        for h in hits:
            passes = bool(cm.match(h["text"]))
            is_tp = h["name"] in loose
            if passes:
                kept.append(h)
                if not is_tp:
                    kept_fp.append(h)
            elif is_tp:
                dropped_tp.append(h)
        n_keep = len(kept)
        n_tp_keep = n_keep - len(kept_fp)
        prec_before = len([h for h in hits if h["name"] in loose]) / max(len(hits), 1)
        prec_after = n_tp_keep / max(n_keep, 1)
        # ゲート後の経路存在率 = 機械判定率 × (残ったヒット / 元のヒット)
        rate_gated = raw_rate * n_keep / max(len(hits), 1)
        rate_gated_tp = raw_rate * n_tp_keep / max(len(hits), 1)
        gated_rates.append(rate_gated)
        rows[surface] = {
            "n_hit": len(hits), "n_kept": n_keep,
            "precision_before": prec_before, "precision_after": prec_after,
            "n_dropped_tp": len(dropped_tp),
            "recall_of_gate": (len([h for h in hits if h["name"] in loose])
                               - len(dropped_tp))
            / max(len([h for h in hits if h["name"] in loose]), 1),
            "rate_machine": raw_rate, "rate_after_gate": rate_gated,
            "rate_true_positive_only": rate_gated_tp,
            "dropped_tp": [h["name"] for h in dropped_tp],
            "kept_fp": [h["name"] for h in kept_fp],
        }
        print(f"=== {surface} ===", file=sys.stderr)
        print(f"  ヒット {len(hits)} → ゲート後 **{n_keep}**", file=sys.stderr)
        print(f"  precision {prec_before*100:5.1f}% → **{prec_after*100:5.1f}%**",
              file=sys.stderr)
        print(f"  ゲートが落とした TP {len(dropped_tp)} 件"
              f"（recall {rows[surface]['recall_of_gate']*100:.1f}%）", file=sys.stderr)
        print(f"  経路存在率 {raw_rate*100:5.2f}% → **{rate_gated*100:4.2f}%**",
              file=sys.stderr)
        if kept_fp:
            print(f"  残った偽陽性: "
                  + " / ".join(f"『{h['name']}』" for h in kept_fp[:6]), file=sys.stderr)

    u = 1.0
    for r in gated_rates:
        u *= (1 - r)
    r_n = 1 - u
    need = (OWNER_TARGET - W_NOLINK * r_n) / W_LINK

    print(f"\n=== ゲート後の r_N（独立仮定＝上限）===", file=sys.stderr)
    print(f"  **{r_n*100:.2f}%**", file=sys.stderr)
    print(f"  （目視補正: 厳格 10.32% / 緩い 18.16%、監査前 34.79%）", file=sys.stderr)
    print(f"\n  70% に要る r_L **{need*100:.2f}%**"
          f"（実測上限 {R_L_MEASURED_MAX*100:.2f}% との差 "
          f"{(need-R_L_MEASURED_MAX)*100:.2f}pt）", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "rn_category_gate.json"
    p.write_text(json.dumps({
        "surfaces": rows, "r_n_after_gate": r_n,
        "r_l_required": need, "r_l_measured_max": R_L_MEASURED_MAX,
        "comparison": {"audit_strict": 0.1032, "audit_loose": 0.1816,
                       "before_audit": 0.3479},
        "caveat": "ゲートは AND なのでヒットを減らすことしかしない（下限）。"
                  "本文に料理語が無いが映像には料理がある取りこぼしは残る。"
                  "目視ラベルはゲートの検証にだけ使い、数字そのものには使っていない。",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
