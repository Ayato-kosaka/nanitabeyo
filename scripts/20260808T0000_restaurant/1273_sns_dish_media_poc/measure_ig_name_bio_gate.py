#!/usr/bin/env python3
"""#1269 — IG アカウントの `name` / `biography` を店名で照合し、誤紐付けを落とせるか測る

## なぜこれをやるのか

#1269 の最大の未解決課題は **誤紐付け（別主体のアカウントを店に結んでしまう）** である。
オーナーの Phase 0 実測では 31 件中 **12 件が other_entity**（商業施設・観光協会・
空港・温泉施設など、店とは別の主体）だった。61.3% しか正しくない。

私は一度 **プロフィールの `website` を店の公式サイトと逆照合する**案を出したが、
オーナーがこれを実測して **循環している**ことを示された。ハンドルはそもそも
店のサイトから採っているので、website が一致するのは当たり前で、
別主体 7 件中 6 件が「一致」してしまう。**門にならない。**

そこで **`name`（表示名）と `biography`（自己紹介文）** を使う。これは
店のサイトには載っていない、Instagram 側だけが持つ情報なので、循環しない。

  例: そば長 → locoplacela というハンドル。website は そば長のサイトかもしれないが、
      `name` は「ロコプレイス」であって「そば長」ではない。

## 測るもの

  正 = store_own ∪ chain_or_brand（19件）、誤 = other_entity（12件）

  | | 門なし | 門あり |
  |---|---|---|
  | precision | 19/31 = 61.3% | TP/(TP+FP) |
  | recall | 100% | TP/19 |

## この測定が言えないこと

  - **n=31 である。** Wilson 区間を必ず併記する
  - 31 件は #1269 のサンプルであり、母集団の抽出方法に依存する
  - 門を通った先の「料理写真が写っているか」は**別問題**で、ここでは測らない

実行:
    python3 measure_ig_name_bio_gate.py
"""

from __future__ import annotations

import json
import math
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
API = "https://graph.facebook.com/v21.0"

# 店名から落とす語。支店名・業態語は「どの店にも出る」ので鍵にならない
DROP = ["店", "支店", "本店", "総本店", "駅前店", "店舗",
        "株式会社", "有限会社", "レストラン", "カフェ", "喫茶"]
SYM = re.compile(r"[\s　・･\-ー−–—/／()（）「」『』【】＆&,.．、。'\"!！?？+＋*＊:：;；]")


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def norm(s: str) -> str:
    """NFKC → 小文字 → 記号と空白を落とす。全角/半角・カナ表記ゆれを吸収する"""
    return SYM.sub("", unicodedata.normalize("NFKC", s or "").lower())


def keys(store: str) -> list[str]:
    """店名から照合鍵を作る。短すぎる鍵は「どこにでも出る」ので捨てる"""
    n = norm(store)
    out = [n]
    for d in DROP:
        dn = norm(d)
        if n.endswith(dn) and len(n) > len(dn) + 1:
            out.append(n[: -len(dn)])
    # 支店名は末尾の地名であることが多い。空白区切りの先頭語も鍵にする
    head = norm(store.split()[0]) if store.split() else ""
    if head:
        out.append(head)
    core = min((k for k in out if k), key=len, default="")
    # #1269 で確立した規則。ラテン文字だけの語は切らない（'La' が門にならない）
    if core and len(core) >= 4 and not re.fullmatch(r"[a-z0-9]+", core):
        out.append(core[:3])
    return [k for k in dict.fromkeys(out) if len(k) >= 3]


def call(uid: str, tok: str, handle: str) -> dict:
    fields = (f"business_discovery.username({handle})"
              "{id,username,name,biography,website,followers_count,media_count}")
    url = f"{API}/{uid}?" + urllib.parse.urlencode({"fields": fields, "access_token": tok})
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return {"ok": True, "data": json.loads(r.read())}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read())
        except Exception:                                        # noqa: BLE001
            body = {}
        err = body.get("error") or {}
        return {"ok": False, "code": err.get("code"), "message": (err.get("message") or "")[:200]}
    except Exception as e:                                       # noqa: BLE001
        return {"ok": False, "code": None, "message": type(e).__name__}


def main() -> None:
    tokf = OUT / ".ig_token"
    if not tokf.exists():
        raise SystemExit("out/.ig_token がありません（1行目 IG_USER_ID / 2行目 TOKEN）")
    lines = [x.strip() for x in tokf.read_text().splitlines() if x.strip()]
    uid, tok = lines[0], lines[1]

    src = json.loads((OUT / "phase0_bd.json").read_text())
    rows_in = src["rows"]
    print(f"入力 {len(rows_in)} 件（オーナーの Phase 0 ラベル付き）")

    rows = []
    for i, r in enumerate(rows_in, 1):
        h, store, label = r["handle"], r.get("store") or "", r["attribution_label"]
        res = call(uid, tok, h)
        bd = (res.get("data", {}).get("business_discovery") or {}) if res["ok"] else {}
        name, bio = bd.get("name") or "", bd.get("biography") or ""
        ks = keys(store)
        hay_name, hay_bio = norm(name), norm(bio)
        hit_name = [k for k in ks if k in hay_name]
        hit_bio = [k for k in ks if k in hay_bio]
        rows.append({
            "handle": h, "store": store, "label": label,
            "api_ok": res["ok"], "api_error": None if res["ok"] else res.get("message"),
            "name": name, "biography_head": bio[:200],
            "keys": ks, "hit_in_name": hit_name, "hit_in_bio": hit_bio,
            "pass_name": bool(hit_name),
            "pass_name_or_bio": bool(hit_name or hit_bio),
        })
        print(f"  {i:2d}/{len(rows_in)} {h:28s} name={name[:18]!r:22s} "
              f"name門={'○' if hit_name else '×'} bio込={'○' if hit_name or hit_bio else '×'} [{label}]")
        time.sleep(0.4)

    ok = [r for r in rows if r["api_ok"]]
    pos = [r for r in ok if r["label"] in ("store_own", "chain_or_brand")]
    neg = [r for r in ok if r["label"] == "other_entity"]

    def gate(field: str) -> dict:
        tp = sum(1 for r in pos if r[field])
        fp = sum(1 for r in neg if r[field])
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / len(pos) if pos else 0.0
        return {"tp": tp, "fp": fp, "fn": len(pos) - tp, "tn": len(neg) - fp,
                "precision_pct": round(prec * 100, 1),
                "precision_ci_pct": [round(x * 100, 1) for x in wilson(tp, tp + fp)],
                "recall_pct": round(rec * 100, 1),
                "recall_ci_pct": [round(x * 100, 1) for x in wilson(tp, len(pos))]}

    base_prec = len(pos) / len(ok) * 100 if ok else 0.0
    summary = {
        "purpose": "#1269 IG name/biography × 店名 の門で誤紐付けを落とせるか",
        "measured_at": time.strftime("%Y-%m-%d"),
        "n_input": len(rows_in), "n_api_ok": len(ok),
        "n_positive": len(pos), "n_negative": len(neg),
        "baseline_precision_pct": round(base_prec, 1),
        "baseline_precision_ci_pct": [round(x * 100, 1) for x in wilson(len(pos), len(ok))],
        "gate_name_only": gate("pass_name"),
        "gate_name_or_bio": gate("pass_name_or_bio"),
        "caveat": "n=31。母集団は #1269 の抽出に依存する。門を通った先の料理写真率は別問題で未測定",
        "rows": rows,
    }
    (OUT / "ig_name_bio_gate.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2))

    print("\n=== 結果 ===")
    print(f"門なし precision {summary['baseline_precision_pct']}% "
          f"CI{summary['baseline_precision_ci_pct']}  (正 {len(pos)} / 判定できた {len(ok)})")
    for k in ("gate_name_only", "gate_name_or_bio"):
        g = summary[k]
        print(f"{k:18s} precision {g['precision_pct']}% CI{g['precision_ci_pct']}  "
              f"recall {g['recall_pct']}% CI{g['recall_ci_pct']}  "
              f"(TP{g['tp']} FP{g['fp']} FN{g['fn']} TN{g['tn']})")
    print("→ out/ig_name_bio_gate.json")


if __name__ == "__main__":
    main()
