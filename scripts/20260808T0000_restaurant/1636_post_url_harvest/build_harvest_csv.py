#!/usr/bin/env python3
"""#1636 SNS 検索ページから投稿 URL を集める速さを測る（収集だけ）

## 測っているもの

**投稿 URL を何秒で何件集められるか。それだけ。**
店の特定・料理カテゴリ・純増率・`add-record` の人力秒数は、このスクリプトの対象外
（あとの PoC で最適化する）。

## 測り方

EC2 上の実 Chrome で SNS の検索ページを開き、**ページ内で 1 本の JavaScript を実行**して
下スクロール 5 回と URL 収集を行う。時刻はページ内の `Date.now()` で取るので、
**LLM の思考時間は入らない**（本番の収集器は LLM を挟まないため、入れると過大評価になる）。

各スクロールのあと 3 秒待つ。遅延読み込みを待つ必要があるので、
**5 スクロール = 15 秒が下限**である。この 15 秒は総所要のうち動かせない部分として読む。

## scroll_index の決め方

ブラウザ側は「URL の配列（挿入順）」と「各スクロール時点での累計件数」を返す。
JS の `Set` は挿入順を保つので、累計件数で配列を切れば
**その URL が何スクロール目で現れたか**が復元できる。

実行:
    python3 build_harvest_csv.py harvest/*.json     # CSV を作り、集計を出す
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
CSV_PATH = OUT_DIR / "post_urls.csv"

COLUMNS = [
    "provider",
    "search_keyword",
    "search_url",
    "scroll_index",
    "post_url",
    "collected_at",
]

#: 1 万件を集めるのに何時間かかるかの換算に使う目標件数。
TARGET_POSTS = 10_000


def load(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def rows_of(doc: dict, collected_at: str) -> list[dict]:
    """1 provider ぶんの JSON を CSV 行へ落とす。

    `steps[i].cumulative` は「スクロール i 回目の直後までに見えていた累計件数」なので、
    直前の累計との差が「そのスクロールで増えた件数」になる。
    """
    urls: list[str] = doc.get("urls") or []
    steps = doc.get("steps") or []
    boundaries: list[tuple[int, int]] = []  # (scroll_index, cumulative)
    for step in steps:
        boundaries.append((int(step.get("scroll", 0)), int(step.get("cumulative", 0))))

    rows: list[dict] = []
    prev = 0
    for scroll_index, cumulative in boundaries:
        for url in urls[prev:cumulative]:
            rows.append(
                {
                    "provider": doc.get("provider", ""),
                    "search_keyword": doc.get("keyword", ""),
                    "search_url": doc.get("search_url", ""),
                    "scroll_index": scroll_index,
                    "post_url": url,
                    "collected_at": collected_at,
                }
            )
        prev = max(prev, cumulative)

    # 累計が URL 総数に届いていない場合（fallback 経路など）は、残りを最終スクロールに寄せる。
    if prev < len(urls):
        last = boundaries[-1][0] if boundaries else 0
        for url in urls[prev:]:
            rows.append(
                {
                    "provider": doc.get("provider", ""),
                    "search_keyword": doc.get("keyword", ""),
                    "search_url": doc.get("search_url", ""),
                    "scroll_index": last,
                    "post_url": url,
                    "collected_at": collected_at,
                }
            )
    return rows


def report(doc: dict, rows: list[dict]) -> None:
    provider = doc.get("provider", "?")
    if doc.get("blocked"):
        print(f"  {provider:10} **収集できず** reason={doc.get('reason', '')!r}",
              file=sys.stderr)
        return

    n = len(rows)
    total_ms = doc.get("total_ms")
    print(f"  {provider:10} {n:>4} 件", file=sys.stderr, end="")
    if total_ms:
        sec = total_ms / 1000
        per = sec / n if n else float("nan")
        hours = TARGET_POSTS * per / 3600
        print(f"  /  {sec:6.1f} 秒  =  **1 件 {per:.2f} 秒**"
              f"  → 1 万件 {hours:.1f} 時間", file=sys.stderr)
    else:
        print("  /  total_ms なし（fallback 経路）", file=sys.stderr)

    by_scroll: dict[int, int] = {}
    for row in rows:
        by_scroll[row["scroll_index"]] = by_scroll.get(row["scroll_index"], 0) + 1
    order = sorted(by_scroll)
    detail = " ".join(f"{i}:{by_scroll[i]:+d}" if i else f"{i}:{by_scroll[i]}"
                      for i in order)
    print(f"             スクロールごとの増分  {detail}", file=sys.stderr)

    # スクロールで 1 件も増えていないなら、総所要のほとんどは «増えないのを待った時間» である。
    # そのまま «1 件あたり秒» として読むと、初期表示ぶんを待ち時間で割った無意味な数になる。
    if order and all(by_scroll.get(i, 0) == 0 for i in order if i > 0):
        print("             ⚠ スクロールで 1 件も増えていない。"
              "上の «1 件あたり秒» は初期表示ぶんを待ち時間で割っただけで、"
              "収集速度として読んではいけない", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", type=Path,
                    help="EC2 から回収した provider ごとの JSON")
    ap.add_argument("--collected-at", default="",
                    help="収集日時（ISO8601）。CSV の全行に入れる")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    all_rows: list[dict] = []
    print("=== provider ごとの実測 ===", file=sys.stderr)
    for path in args.files:
        doc = load(path)
        rows = rows_of(doc, args.collected_at)
        report(doc, rows)
        all_rows.extend(rows)

    with CSV_PATH.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(all_rows)
    print(f"\n-> {CSV_PATH.relative_to(HERE)}  {len(all_rows)} 行", file=sys.stderr)


if __name__ == "__main__":
    main()
