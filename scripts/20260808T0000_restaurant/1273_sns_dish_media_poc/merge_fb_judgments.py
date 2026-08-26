#!/usr/bin/env python3
"""#1633 目視判定の生ログ（JSONL）を記入シート CSV へ流し込む。

判定そのものは EC2 上の `claude --chrome` がブラウザで写真タブを開いて行い、
1件ずつ JSON で書き出している（`out/fb_dish_photo_raw_judgments.jsonl`）。
このスクリプトは**それを CSV の判定列へ写すだけ**で、値の解釈も補完もしない。
生ログを正とし、CSV は集計スクリプト（measure_fb_dish_photo_manual.py）の入力形式に
合わせるための派生物、という関係にしてある。

    python3 merge_fb_judgments.py            # 既定の入出力で流し込む
    python3 merge_fb_judgments.py --check    # 書き換えずに、値の妥当性だけ見る

生ログ1行の形（`seen` は「本当に画面を見たか」を後から検証するための欄）:

    {"no": 1, "page": "ok", "dish_photo": "yes", "n_dish": "3-5",
     "identifiable": "yes", "recent": "unknown", "note": "…", "seen": "天丼, 蕎麦"}
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
RAW = OUT_DIR / "fb_dish_photo_raw_judgments.jsonl"
SHEET = OUT_DIR / "fb_dish_photo_worksheet.csv"

# 記入シートの判定列と、許される値。ここに無い値は流し込まずに落とす（黙って通さない）
ALLOWED = {
    "page": {"ok", "dead", "private"},
    "dish_photo": {"yes", "no", ""},
    "n_dish": {"0", "1-2", "3-5", "6+", ""},
    "identifiable": {"yes", "partial", "no", ""},
    "recent": {"yes", "no", "unknown", ""},
}


def load_raw(path: Path) -> tuple[dict[int, dict], list[str]]:
    judgments: dict[int, dict] = {}
    problems: list[str] = []
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError as e:
            problems.append(f"L{i}: JSON として読めない ({e})")
            continue
        try:
            no = int(rec["no"])
        except (KeyError, TypeError, ValueError):
            problems.append(f"L{i}: no が無い/数値でない: {line[:80]}")
            continue
        for col, ok in ALLOWED.items():
            v = str(rec.get(col, "")).strip()
            if v not in ok:
                problems.append(f"no={no}: {col}={v!r} は許されない値")
        if no in judgments:
            problems.append(f"no={no}: 重複。後の行で上書きする")
        judgments[no] = rec
    return judgments, problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="CSV を書き換えず妥当性だけ見る")
    ap.add_argument("--raw", type=Path, default=RAW)
    ap.add_argument("--sheet", type=Path, default=SHEET)
    args = ap.parse_args()

    if not args.raw.exists():
        print(f"{args.raw} がありません。", file=sys.stderr)
        return 1

    judgments, problems = load_raw(args.raw)
    rows = list(csv.DictReader(args.sheet.open(encoding="utf-8")))
    fieldnames = list(rows[0].keys())

    filled = 0
    for r in rows:
        rec = judgments.get(int(r["no"]))
        if not rec:
            continue
        for col in ("page", "dish_photo", "n_dish", "identifiable", "recent"):
            r[col] = str(rec.get(col, "")).strip()
        # note には「見えたもの」と「実際に判定した URL」も残す。
        # 数字ID の URL が通らず店名で探し直したページがあるので、
        # どのページを見た判定なのかを後から追えるようにしておく。
        note = str(rec.get("note", "")).strip()
        seen = str(rec.get("seen", "")).strip()
        url = str(rec.get("judged_url", "")).strip()
        parts = [note] if note else []
        if seen:
            parts.append(f"【見えたもの: {seen}】")
        if url and url != r["url"]:
            parts.append(f"【判定したURL: {url}】")
        r["note"] = "".join(parts)
        filled += 1

    missing = sorted(set(int(r["no"]) for r in rows) - set(judgments))
    print(f"生ログ {len(judgments)} 件 / シート {len(rows)} 件 → 流し込み {filled} 件", file=sys.stderr)
    if missing:
        print(f"  未判定の no: {missing}", file=sys.stderr)
    for p in problems:
        print(f"  ⚠ {p}", file=sys.stderr)

    if args.check:
        print("  --check なので CSV は書き換えていない。", file=sys.stderr)
        return 1 if problems else 0

    with args.sheet.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)
    print(f"-> {args.sheet}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
