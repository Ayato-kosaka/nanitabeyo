#!/usr/bin/env python3
"""place_id がまだ生きているかを、**課金ゼロの SKU だけ**で確かめる（#1639）。

## 目的

オーナー案:
「google place id を、無料の place details で回して結果がなければ閉店扱いにする」

これが成立するかを、**推測ではなく対照実験で**決める。

## ⚠️ 課金しないための作り

`Place Details` は fieldMask 次第で SKU が変わり、**Essentials / Pro / Enterprise は
すべて有料**である。無料なのは **IDs Only（`id` だけを要求する）** のみ。

そこでこのスクリプトは **fieldMask を `id` に固定し、引数でも環境変数でも変えられない**
ようにしてある。定数を書き換えない限り課金 SKU へは移れない。
`assert` でも二重に固定しているので、うっかり編集しても実行時に落ちる。

クォータ（オーナー確認済み）: GetPlaceRequest 1,000,000/日・3,000/分。
62 万件を 1 日で回せる。既定 QPS は余裕を見て低くしてある。

## なぜ «404 = 閉店» を信じてはいけないか

**Google は閉店した店を消さない。** `businessStatus: CLOSED_PERMANENTLY` を立てたまま
place_id は有効に残る。404 が返るのは主に **place_id のローテーション/統合**であり、
閉店とは限らない。しかも IDs Only の Place Details は、まさに «古い place_id を最新へ
差し替える» ための API として Google が用意しているものである。

したがって «404 率が高い» だけでは何も言えない。**閉店群と営業中群で 404 率を比べる**
必要がある。

## 対照実験

`--input` に `place_id,label` の CSV を渡す。label は `closed` か `control`。

  - `closed` : IFAS 由来で閉店が確定している 260 店（#1639 で特定済み）
  - `control`: 営業中とみなせる店から無作為抽出した同数

出力は label ごとの HTTP status 分布。判定は次のとおり。

  閉店群だけ 404 が高い    → 案は成立。閾値を決めて本採用
  両群とも 404 がほぼ 0    → 404 は閉店の信号ではない。businessStatus が要る（有料）
  両群とも 404 が高い      → place_id の鮮度の問題。先に棚卸しが要る

**1 行も書き込まない。** 結果は標準出力と、指定があれば CSV に出すだけ。
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline_common import configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places/{place_id}"

# ⚠️ 変更禁止。ここを増やした瞬間に課金 SKU へ移る。
# `id` だけ = Place Details Essentials (IDs Only) = $0・無制限。
FIELD_MASK = "id"
assert FIELD_MASK == "id", "fieldMask を id 以外にすると課金 SKU になる"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="place_id の生死を IDs Only（課金ゼロ）で確かめます"
    )
    parser.add_argument(
        "--input", required=True, help="place_id,label の CSV（label は closed / control）"
    )
    parser.add_argument("--output", help="1件ごとの結果を書き出す CSV")
    parser.add_argument(
        "--qps", type=float, default=10.0, help="毎秒リクエスト数（上限 3,000/分 = 50/秒）"
    )
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument(
        "--limit", type=int, help="先頭 N 件だけ試す（動作確認用）"
    )
    return parser.parse_args()


def probe(place_id: str, api_key: str, timeout: float) -> tuple[int, str | None]:
    """1件問い合わせて (HTTPステータス, 返ってきたid) を返す。

    id が変わって返ることがある（Google が新しい place_id へ差し替える）。
    それは «生きているが ID が変わった» であり、閉店ではない。区別できるよう返す。
    """

    url = PLACE_DETAILS_URL.format(place_id=urllib.parse.quote(place_id, safe=""))
    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": FIELD_MASK,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
            return int(response.status), body.get("id")
    except urllib.error.HTTPError as error:
        return int(error.code), None
    except urllib.error.URLError:
        return 0, None


def main() -> None:
    configure_logging()
    args = parse_args()

    api_key = os.environ.get("PLACES_TEXT_SEARCH_API_KEY")
    if not api_key:
        raise SystemExit("PLACES_TEXT_SEARCH_API_KEY が未設定です")

    rows = []
    with open(args.input, encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            rows.append((row["place_id"].strip(), row.get("label", "control").strip()))
    if args.limit:
        rows = rows[: args.limit]
    LOGGER.info("対象: %d件（fieldMask=%r / 課金ゼロSKU）", len(rows), FIELD_MASK)

    interval = 1.0 / args.qps if args.qps > 0 else 0.0
    results = []
    stats: dict[str, Counter] = {}
    next_at = time.monotonic()
    for index, (place_id, label) in enumerate(rows, start=1):
        now = time.monotonic()
        if now < next_at:
            time.sleep(next_at - now)
        next_at = max(now, next_at) + interval

        status, returned_id = probe(place_id, api_key, args.timeout)
        if status == 200 and returned_id and returned_id != place_id:
            outcome = "200_id_changed"
        elif status == 200:
            outcome = "200_same_id"
        else:
            outcome = str(status)
        stats.setdefault(label, Counter())[outcome] += 1
        results.append(
            {"place_id": place_id, "label": label, "status": status,
             "returned_id": returned_id or "", "outcome": outcome}
        )
        if index % 50 == 0:
            LOGGER.info("  %d/%d", index, len(rows))

    LOGGER.info("")
    LOGGER.info("=== label ごとの結果 ===")
    for label, counter in sorted(stats.items()):
        total = sum(counter.values())
        LOGGER.info("%s（%d件）", label, total)
        for outcome, count in counter.most_common():
            LOGGER.info("  %-16s %5d件 (%5.1f%%)", outcome, count, 100.0 * count / total)

    if "closed" in stats and "control" in stats:
        def rate_404(c: Counter) -> float:
            t = sum(c.values())
            return 100.0 * c.get("404", 0) / t if t else 0.0
        closed_rate = rate_404(stats["closed"])
        control_rate = rate_404(stats["control"])
        LOGGER.info("")
        LOGGER.info("404率: 閉店群 %.1f%% / 対照群 %.1f%%", closed_rate, control_rate)
        LOGGER.info(
            "判定: %s",
            "閉店群だけ高い → 案は成立しそう"
            if closed_rate - control_rate >= 20.0
            else "差が小さい → 404 は閉店の信号として使えない",
        )

    if args.output:
        with open(args.output, "w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(
                stream, fieldnames=["place_id", "label", "status", "returned_id", "outcome"]
            )
            writer.writeheader()
            writer.writerows(results)
        LOGGER.info("結果を書き出しました: %s", args.output)


if __name__ == "__main__":
    main()
