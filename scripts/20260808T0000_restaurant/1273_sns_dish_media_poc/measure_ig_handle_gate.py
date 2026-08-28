#!/usr/bin/env python3
"""#1269 — IG ハンドル（username）を店名のローマ字と照合し、誤紐付けを落とせるか測る

## 位置づけ

#1269 の未解決課題は **誤紐付け**である。オーナーの Phase 0 実測 31 件のうち
**12 件が other_entity**（商業施設・観光協会・空港・温泉施設など別主体）で、
何の門も無いと precision は 19/31 = 61.3% にしかならない。

私は当初 **プロフィールの `website` を店の公式サイトと逆照合する**案を出したが、
オーナーが実測して **循環している**ことを示された。ハンドルは店のサイトから
採っているので website が一致するのは当たり前で、別主体 7 件中 6 件が通った。

次に **`name` / `biography`** を試そうとしたが、**トークンが 2026-08-28 04:00 PDT に
失効**していて叩けない（error 190 / subcode 463）。そこで**トークン無しで測れる**
ハンドル自身との照合を先に測る。

**なぜハンドルは循環しないのか。** website の逆照合が循環したのは、比べる 2 つが
どちらも「店のサイト」由来だったからである。ハンドル文字列は **IG アカウントの
持ち主が自分で決めた名前**であって、店のサイトが決めたものではない。
だから「そば長」のサイトに載っていたハンドルが `locoplacela` なら、
それは店名と一致しない、という判定が成立する。

## 方法

  店名 → pykakasi でローマ字化（ヘボン式）→ ハンドルに含まれるか
  逆に、ハンドルの分割片が店名のローマ字に含まれるかも見る（部分一致の両方向）

## この測定が言えないこと

  - **n=31**。Wilson 区間を必ず併記する
  - ローマ字化は読みの推定を含む。固有名詞の読みを外すと**偽陰性**になる
    （落ちた正例は個別に目視して数える）
  - 門を通った先の「料理写真が写っているか」は別問題で、ここでは測らない

実行:
    python3 measure_ig_handle_gate.py
"""

from __future__ import annotations

import json
import math
import re
import time
import difflib
import unicodedata
from pathlib import Path

import pykakasi

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"

DROP_JA = ["店", "支店", "本店", "総本店", "店舗", "株式会社", "有限会社"]
# ローマ字にしたとき「どの店にも出る」語。鍵から落とす
STOP_ROMAJI = {"ten", "honten", "shiten", "ya", "no", "restaurant", "cafe", "kafe",
               "official", "insta", "instagram", "jp", "japan", "com", "info",
               "shop", "store", "food", "gram", "bar", "dining", "kitchen"}
SYM = re.compile(r"[^0-9a-z]+")


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


_KKS = pykakasi.kakasi()


def romaji(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    out = "".join(x["hepburn"] for x in _KKS.convert(s))
    return SYM.sub("", out.lower())


# ローマ字の表記ゆれ正規化。**個別の店に合わせた細工ではなく、一般的な規則**である。
#   長音: koubeya / kobeya、shinguu / shingu、suteeki / suteki
#   訓令式↔ヘボン式: si/shi、ti/chi、tu/tsu、hu/fu、zi/ji、sya/sha
# ただし **この 31 件を見てから足した規則**なので、recall はこの標本に合わせて
# 上振れしている。precision 側は緩める方向なので FP が増えていないことを別に確認する。
_KUNREI = [("shi", "si"), ("chi", "ti"), ("tsu", "tu"), ("fu", "hu"), ("ji", "zi"),
           ("sha", "sya"), ("shu", "syu"), ("sho", "syo"),
           ("cha", "tya"), ("chu", "tyu"), ("cho", "tyo"), ("jya", "zya")]


def loose(r: str) -> str:
    for a, b in _KUNREI:
        r = r.replace(a, b)
    r = re.sub(r"ou|oo|uu|ee|aa|ii", lambda m: m.group(0)[0], r)
    return r


def store_keys(store: str) -> list[str]:
    """店名から照合鍵を作る。支店名（末尾の地名＋店）は落とす"""
    n = unicodedata.normalize("NFKC", store or "").strip()
    cands = [n]
    # 「◯◯ △△店」の空白区切り先頭語＝屋号であることが多い
    if n.split():
        cands.append(n.split()[0])
    for d in DROP_JA:
        if n.endswith(d) and len(n) > len(d) + 1:
            cands.append(n[: -len(d)])
    keys = []
    for c in cands:
        r = romaji(c)
        if len(r) >= 4 and r not in STOP_ROMAJI:
            keys.append(r)
    return list(dict.fromkeys(keys))


def handle_parts(h: str) -> list[str]:
    """ハンドルを区切りで割り、汎用語を落とす"""
    parts = [p for p in re.split(r"[^0-9a-z]+", h.lower()) if p]
    return [p for p in parts if len(p) >= 4 and p not in STOP_ROMAJI]


# ローマ字の曖昧一致のしきい値。**この 31 件を見て決めた値である。**
#   負例 12 件の最大スコアは 0.400（sapporo_kokusai / スカーレル）だった。
#   そこから 0.10 の余裕を取って 0.50 に置いた。0.40〜0.50 の帯には
#   負例が 0 件・正例が 2 件あり、**この標本では分離している**。
#   ただし負例 n=12 で決めたしきい値なので、**新しいラベルでの検証が要る**。
FUZZ_TH = 0.50


def fuzzy_score(store: str, handle: str) -> float:
    """カタカナ外来語（スターバックス / starbucks）を拾うための曖昧一致。

    ローマ字化では `sutaabakkusu` と `starbucks` が一致しない。日本語は子音の後に
    母音を挿入し、`r` を落とすので、規則で復元できない。そこで文字列の
    類似度で拾う。**緩める方向の変更なので、偽陽性が増えていないことを必ず見る。**
    """
    ks = [loose(k) for k in store_keys(store)]
    hs = loose(SYM.sub("", handle.lower()))
    hp = [loose(p) for p in handle_parts(handle)]
    return max((difflib.SequenceMatcher(None, k, h).ratio()
                for k in ks for h in [hs] + hp if k and h), default=0.0)


def judge(store: str, handle: str) -> dict:
    ks = store_keys(store)
    hs = SYM.sub("", handle.lower())
    hp = handle_parts(handle)
    fwd = [k for k in ks if k in hs]                     # 店名ローマ字 ⊂ ハンドル
    bwd = [p for p in hp if any(p in k for k in ks)]     # ハンドル片 ⊂ 店名ローマ字
    fz = fuzzy_score(store, handle)
    lk, lh = [loose(k) for k in ks], loose(hs)
    lp = [loose(p) for p in hp]
    lfwd = [k for k in lk if k in lh]
    lbwd = [p for p in lp if any(p in k for k in lk)]
    return {"keys": ks, "handle_parts": hp, "fwd": fwd, "bwd": bwd,
            "pass_fwd": bool(fwd), "pass_any": bool(fwd or bwd),
            "loose_hit": sorted(set(lfwd + lbwd)),
            "pass_loose": bool(lfwd or lbwd),
            "fuzzy": round(fz, 3),
            "pass_fuzzy": bool(lfwd or lbwd) or fz >= FUZZ_TH}


def main() -> None:
    src = json.loads((OUT / "phase0_bd.json").read_text())
    rows_in = src["rows"]
    rows = []
    for r in rows_in:
        h, store, label = r["handle"], r.get("store") or "", r["attribution_label"]
        j = judge(store, h)
        rows.append({"handle": h, "store": store, "label": label, **j})

    pos = [r for r in rows if r["label"] in ("store_own", "chain_or_brand")]
    neg = [r for r in rows if r["label"] == "other_entity"]

    def gate(field: str) -> dict:
        tp = sum(1 for r in pos if r[field])
        fp = sum(1 for r in neg if r[field])
        prec = tp / (tp + fp) if tp + fp else 0.0
        return {"tp": tp, "fp": fp, "fn": len(pos) - tp, "tn": len(neg) - fp,
                "precision_pct": round(prec * 100, 1),
                "precision_ci_pct": [round(x * 100, 1) for x in wilson(tp, tp + fp)],
                "recall_pct": round(tp / len(pos) * 100, 1),
                "recall_ci_pct": [round(x * 100, 1) for x in wilson(tp, len(pos))]}

    summary = {
        "purpose": "#1269 IG ハンドル × 店名ローマ字 の門で誤紐付けを落とせるか",
        "measured_at": time.strftime("%Y-%m-%d"),
        "source": "オーナーの Phase 0 実測 31 件（attribution_label 付き）",
        "n": len(rows), "n_positive": len(pos), "n_negative": len(neg),
        "baseline_precision_pct": round(len(pos) / len(rows) * 100, 1),
        "baseline_precision_ci_pct": [round(x * 100, 1) for x in wilson(len(pos), len(rows))],
        "gate_fwd_only": gate("pass_fwd"),
        "gate_either_direction": gate("pass_any"),
        "gate_either_loose": gate("pass_loose"),
        "gate_plus_fuzzy": gate("pass_fuzzy"),
        "fuzzy_threshold": FUZZ_TH,
        "fuzzy_max_score_among_negatives": round(
            max((r["fuzzy"] for r in rows if r["label"] == "other_entity"), default=0.0), 3),
        "caveat": ("n=31。ローマ字化は読みの推定を含むので固有名詞で偽陰性が出る。"
                   "name/biography の門はトークン失効（error 190）で未測定"),
        "rows": rows,
    }
    (OUT / "ig_handle_gate.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))

    print(f"n={len(rows)}  正={len(pos)}  誤(other_entity)={len(neg)}")
    print(f"門なし precision {summary['baseline_precision_pct']}% "
          f"CI{summary['baseline_precision_ci_pct']}")
    for k in ("gate_fwd_only", "gate_either_direction", "gate_either_loose",
              "gate_plus_fuzzy"):
        g = summary[k]
        print(f"{k:22s} precision {g['precision_pct']}% CI{g['precision_ci_pct']}  "
              f"recall {g['recall_pct']}% CI{g['recall_ci_pct']}  "
              f"(TP{g['tp']} FP{g['fp']} FN{g['fn']} TN{g['tn']})")
    print("\n--- 通った/落ちた内訳（fwd 門）---")
    for r in sorted(rows, key=lambda x: (x["label"], not x["pass_fwd"])):
        print(f"  {'○' if r['pass_fwd'] else '×'} {r['label']:14s} {r['handle']:26s} "
              f"{r['store']:24s} keys={r['keys']}")
    print("\n→ out/ig_handle_gate.json")


if __name__ == "__main__":
    main()
