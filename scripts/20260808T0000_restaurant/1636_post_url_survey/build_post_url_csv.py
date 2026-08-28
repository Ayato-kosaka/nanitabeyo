#!/usr/bin/env python3
"""#1636 SNS の検索ページに投稿の URL が何件並ぶかを数え、CSV にする

## 数えているもの

**検索語 1 つで、投稿の URL が何件・何秒で並ぶか。それだけ。**
店の特定・料理カテゴリ・純増率・`add-record` の操作時間は、このスクリプトの対象外
（あとの PoC で扱う）。

## 数え方

EC2 上の Chrome で、人が開くのと同じ公開の検索ページを開き、
**ページ内で 1 本の JavaScript を実行**して画面を下へ送りながら URL を数える。
時刻はページ内の `Date.now()` で取るので、**LLM の思考時間は入らない**
（入れると、画面を送るのにかかった実時間より大きく出る）。

画面を送るたびに 3 秒待つ。遅れて描画されるのを待つ必要があるので、
**5 回送れば 15 秒が下限**である。この 15 秒は総所要のうち動かせない部分として読む。

## scroll_index の決め方

ブラウザ側は「URL の配列（挿入順）」と「各回時点での累計件数」を返す。
JS の `Set` は挿入順を保つので、累計件数で配列を切れば
**その URL が何回目に画面を送ったところで現れたか**が復元できる。

実行:
    python3 build_post_url_csv.py raw/*_run2.json     # CSV を作り、集計を出す
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

#: 「検索語を変えて同じことを繰り返したら何本ぶんか」を出すときの目安件数（#1636 の議論の単位）。
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
    # `scroll` は整数とは限らない。実キー操作へ切り替えた回は "real-1..5" のような
    # ラベルが入る（何回ぶんをまとめたかが分かるようにブラウザ側でそう記録している）。
    boundaries: list[tuple[str, int]] = []  # (scroll_index, cumulative)
    for step in steps:
        boundaries.append((str(step.get("scroll", 0)), int(step.get("cumulative", 0))))

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
        last = boundaries[-1][0] if boundaries else "0"
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
    print(f"  {provider:10} {n:>4} 件 / 検索語 1 つ", file=sys.stderr, end="")

    # 効いていない操作で空回りした区間を «かかった時間» に数えてはいけない。
    # Instagram の window.scrollTo のように、moved も cumulative も動かないまま
    # 待っただけの区間が実際にあった。**件数が増え始めてから増え終わるまで**を数える。
    steps = doc.get("steps") or []
    grew = [i for i in range(1, len(steps))
            if int(steps[i]["cumulative"]) > int(steps[i - 1]["cumulative"])]
    if not grew:
        print("  /  スクロールで 1 件も増えず", file=sys.stderr)
        return

    start_ms = int(steps[grew[0] - 1].get("ms", 0))
    end_ms = int(steps[grew[-1]].get("ms", 0))
    gained = int(steps[grew[-1]]["cumulative"]) - int(steps[grew[0] - 1]["cumulative"])
    window_sec = (end_ms - start_ms) / 1000
    initial = int(steps[0]["cumulative"])

    print(f"  /  初期表示 {initial} 件 ＋ スクロールで {gained:+d} 件 を {window_sec:.1f} 秒",
          file=sys.stderr)
    if total_ms:
        print(f"             総所要 {total_ms / 1000:.1f} 秒"
              f"（うち空回り {(total_ms / 1000) - window_sec:.1f} 秒）", file=sys.stderr)

    # 1 検索語で並ぶ件数には頭打ちがある（TikTok のタグページは実測で頭打ちになった）。
    # したがって 1 万件は «1 件あたり秒 × 1 万» では出ず、
    # **«検索語を何本ぶん見るか» × «1 本あたりの所要»** になる。
    # 1 本あたりの所要は «効いた操作だけ» で見る（空回りは手順を直せば消える時間なので、
    # そのまま先の見積もりへ持ち込むと過大になる）。ページを開く時間は別途数秒かかる。
    keywords = -(-TARGET_POSTS // n) if n else 0
    hours = keywords * window_sec / 3600
    print(f"             → 1 万件は検索語 **{keywords} 本ぶん** ＝ **{hours:.1f} 時間**"
          f"（ページを開く時間と語をまたいだ重複は未計上なので下限）", file=sys.stderr)

    # 並び順は steps の順序そのもの（ラベルが文字列のこともあるので sort しない）。
    by_scroll: dict[str, int] = {}
    order: list[str] = []
    for row in rows:
        key = row["scroll_index"]
        if key not in by_scroll:
            by_scroll[key] = 0
            order.append(key)
        by_scroll[key] += 1
    detail = " ".join(f"{i}:{by_scroll[i]:+d}" if i != "0" else f"{i}:{by_scroll[i]}"
                      for i in order)
    print(f"             スクロールごとの増分  {detail}", file=sys.stderr)

    # スクロールで 1 件も増えていないなら、総所要のほとんどは «増えないのを待った時間» である。
    # そのまま «1 件あたり秒» として読むと、初期表示ぶんを待ち時間で割った無意味な数になる。
    if order and all(by_scroll.get(i, 0) == 0 for i in order if i != "0"):
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
