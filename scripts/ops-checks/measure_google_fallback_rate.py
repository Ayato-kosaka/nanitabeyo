#!/usr/bin/env python3
"""#1781 / #843 本番で «検索 1 回あたり何割が Google へ落ちているか» を測る（読み取り専用）。

## なぜ要るか — `回/日` は依存の指標ではない

2026-09-16 に #1781 へ「`bulkImportFromGoogle` の発火が **348.9 回/日 → 224.3 回/日
（約 36% 減）**」と書き、1.14 リリースの効果として報告した。**これは誤りだった。**

発火回数は**検索数に比例する量**で、検索が減れば依存が 1 ミリも減っていなくても減る。
2026-10-04 に分母（検索の入口 `FindByCriteria`）を入れて測り直すと、

| 窓 | 検索 | 発火 | **発火 / 検索** | 検索/日 | 発火/日 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 08-10〜09-04（08-18/19 を除く 24 日） | 12,455 | 9,106 | **73.1%** | 519.0 | 379.4 |
| 09-11〜10-03（API は同一ビルドの 23 日） | 5,603 | 4,008 | **71.5%** | 243.6 | 174.3 |

**発火/日 −54% に対し検索/日 −53%。** 減ったぶんはそのまま検索が減ったぶんで、
**率は −1.6pt で実質不動**だった。訂正の記録は
https://github.com/Ayato-kosaka/nanitabeyo/issues/1781#issuecomment-5980631769

**同じ間違いを二度しないために、この指標をスクリプトにする。**
手で SQL を書くと、また分母を忘れる。

## 出すもの

1. 日ごとの `検索 / 発火 / 率`
2. 窓の合計と、`検索/日` `発火/日` `率`
3. `--split-at` を渡すと 2 つの窓を並べ、**回数の変化率と率の変化**を両方出す
   （回数だけ見て «減った» と読まないため）

## ⚠️ コストの規則をコードに入れてある

`.codex/bigquery/safety-policy.md` の 2 つを、お願いではなく**実装**で守る。

- **`*_event_logs` ビューを使わない。** あのビューの `created_at` は計算列なので
  パーティションが刈れず、**1 日 18.4 GB** かかる。生テーブル
  `run_googleapis_com_stdout` を `timestamp` で絞れば同じ 1 日が約 77 MB
- **必ず dry run してから実行する。** 見積もりが `--max-bytes`（既定 1 GiB）を
  超えたら**流さずに終わる**。1 GiB はポリシーの «ユーザーに聞く» 閾値である

## 使い方

    script_path:       scripts/ops-checks/measure_google_fallback_rate.py
    args:              --since 2026-09-11 --until 2026-10-04
    requirements_path: scripts/ops-checks/requirements.txt

`--dry-run` は SQL と見積もりバイト数だけを出す（クエリは流さない）。
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys

# ⚠️ ここを `*_event_logs` ビューへ変えてはいけない（上の「コストの規則」）。
RAW_TABLE = "{project}.{dataset}.run_googleapis_com_stdout"

# 検索の入口と、Google へ落ちたときの入口。
#
# ⚠️ **分母（SEARCH_EVENT）を外してはいけない。** これが無い数字は «依存» ではなく
#    «交通量» を測っている（上の表の 36% 減がそれだった）。
SEARCH_EVENT = "FindByCriteria"  # DishMediaService.findByCriteria の入口ログ
FALLBACK_EVENT = "BulkImportFromGoogle"  # DishesService.bulkImportFromGoogle の入口ログ

DAILY_SQL = """
SELECT DATE(timestamp) AS d,
  COUNTIF(jsonPayload.event_name = @search_event) AS searches,
  COUNTIF(jsonPayload.event_name = @fallback_event) AS fallbacks
FROM `{table}`
WHERE timestamp >= @since AND timestamp < @until
  AND jsonPayload.log_type = 'backend_event_logs'
  AND jsonPayload.event_name IN (@search_event, @fallback_event)
GROUP BY d
ORDER BY d
"""

ONE_GIB = 1024 * 1024 * 1024


def ratio(fallbacks: int, searches: int) -> float | None:
    """発火 / 検索。検索が 0 なら `None`（0 除算を «0%» と書かない）。"""
    if searches <= 0:
        return None
    return fallbacks / searches


def summarize(rows: list[tuple[dt.date, int, int]]) -> dict[str, float | int | None]:
    """窓の合計と 1 日あたり。`rows` は (日付, 検索, 発火)。"""
    days = len(rows)
    searches = sum(r[1] for r in rows)
    fallbacks = sum(r[2] for r in rows)
    return {
        "days": days,
        "searches": searches,
        "fallbacks": fallbacks,
        "ratio": ratio(fallbacks, searches),
        "searches_per_day": searches / days if days else None,
        "fallbacks_per_day": fallbacks / days if days else None,
    }


def compare(before: dict, after: dict, *, flat_within_pt: float = 3.0) -> dict:
    """2 つの窓を比べ、**回数の変化と率の変化を分けて**返す。

    `verdict` は 3 つだけ。

    - `volume_only` … 率の差が `flat_within_pt`（既定 3pt）以内。
      回数が動いていても **依存は動いていない**
    - `dependency_down` / `dependency_up` … 率そのものが動いた

    ⚠️ **回数の変化率を verdict に使わない。** 2026-09-16 の誤りはそれだった。
    """
    before_ratio, after_ratio = before["ratio"], after["ratio"]
    if before_ratio is None or after_ratio is None:
        return {"verdict": "unknown", "ratio_delta_pt": None, "fallbacks_per_day_change": None}
    delta_pt = (after_ratio - before_ratio) * 100
    if abs(delta_pt) <= flat_within_pt:
        verdict = "volume_only"
    elif delta_pt < 0:
        verdict = "dependency_down"
    else:
        verdict = "dependency_up"
    change = None
    if before["fallbacks_per_day"]:
        change = after["fallbacks_per_day"] / before["fallbacks_per_day"] - 1
    searches_change = None
    if before["searches_per_day"]:
        searches_change = after["searches_per_day"] / before["searches_per_day"] - 1
    return {
        "verdict": verdict,
        "ratio_delta_pt": delta_pt,
        "fallbacks_per_day_change": change,
        "searches_per_day_change": searches_change,
    }


def _pct(value: float | None) -> str:
    return f"{value * 100:.1f}%" if value is not None else "—"


def _signed_pct(value: float | None) -> str:
    return f"{value * 100:+.0f}%" if value is not None else "—"


def _parse_day(value: str) -> dt.datetime:
    """`2026-09-11` か `2026-09-11T00:00:00Z` を UTC の datetime にする。"""
    text = value.replace("Z", "+00:00")
    parsed = dt.datetime.fromisoformat(text) if "T" in text else dt.datetime.fromisoformat(f"{text}T00:00:00+00:00")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def build_query(project: str, dataset: str) -> str:
    return DAILY_SQL.format(table=RAW_TABLE.format(project=project, dataset=dataset))


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--project", default="food-scroll")
    p.add_argument("--dataset", default="nanitabeyo_logs_prod")
    p.add_argument("--since", required=True, help="開始（UTC・この日を含む）。例: 2026-09-11")
    p.add_argument("--until", required=True, help="終了（UTC・この日を含まない）。例: 2026-10-04")
    p.add_argument(
        "--split-at",
        help="この日で 2 つの窓に分け、回数の変化と率の変化を分けて出す（例: 2026-09-11）",
    )
    p.add_argument(
        "--max-bytes",
        type=int,
        default=ONE_GIB,
        help="dry run の見積もりがこれを超えたら流さない（既定 1 GiB = ポリシーの «聞く» 閾値）",
    )
    p.add_argument("--dry-run", action="store_true", help="SQL と見積もりだけ出し、クエリは流さない")
    args = p.parse_args()

    since, until = _parse_day(args.since), _parse_day(args.until)
    if since >= until:
        print("❌ --since は --until より前である必要があります", file=sys.stderr)
        return 2

    from google.cloud import bigquery  # 依存は scripts/ops-checks/requirements.txt

    client = bigquery.Client(project=args.project)
    sql = build_query(args.project, args.dataset)
    params = [
        bigquery.ScalarQueryParameter("since", "TIMESTAMP", since),
        bigquery.ScalarQueryParameter("until", "TIMESTAMP", until),
        bigquery.ScalarQueryParameter("search_event", "STRING", SEARCH_EVENT),
        bigquery.ScalarQueryParameter("fallback_event", "STRING", FALLBACK_EVENT),
    ]

    estimate = client.query(
        sql, job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False, query_parameters=params)
    )
    scanned = estimate.total_bytes_processed or 0
    print(f"見積もり: {scanned / 1024 / 1024:.1f} MB（上限 {args.max_bytes / 1024 / 1024:.0f} MB）")
    if args.dry_run:
        print(sql)
        return 0
    if scanned > args.max_bytes:
        print(
            f"❌ 見積もりが上限を超えました。窓を狭めるか、--max-bytes を明示してください"
            f"（.codex/bigquery/safety-policy.md の «1 GB 以上は聞く»）",
            file=sys.stderr,
        )
        return 2

    job = client.query(sql, job_config=bigquery.QueryJobConfig(query_parameters=params))
    rows = [(r["d"], int(r["searches"]), int(r["fallbacks"])) for r in job.result()]
    if not rows:
        print("⚠️ 1 行も返りませんでした（窓が空か、イベント名が変わった可能性があります）")
        return 0

    print(f"\n# 日ごと（{SEARCH_EVENT} / {FALLBACK_EVENT}）")
    print(f"{'日付':<12}{'検索':>8}{'発火':>8}{'発火/検索':>12}")
    for day, searches, fallbacks in rows:
        print(f"{day!s:<12}{searches:>8}{fallbacks:>8}{_pct(ratio(fallbacks, searches)):>12}")

    whole = summarize(rows)
    print(f"\n# 窓の合計（{whole['days']} 日）")
    print(f"  検索 {whole['searches']:,} / 発火 {whole['fallbacks']:,} → **発火/検索 {_pct(whole['ratio'])}**")
    print(f"  検索/日 {whole['searches_per_day']:.1f} / 発火/日 {whole['fallbacks_per_day']:.1f}")
    print("  ⚠️ `発火/日` を «依存» の指標として報告しないこと。率で書く（このファイルの冒頭）")

    if args.split_at:
        boundary = _parse_day(args.split_at).date()
        before = summarize([r for r in rows if r[0] < boundary])
        after = summarize([r for r in rows if r[0] >= boundary])
        verdict = compare(before, after)
        print(f"\n# {boundary} で分けて比較")
        for label, part in (("前", before), ("後", after)):
            print(
                f"  {label}: {part['days']} 日 / 検索 {part['searches']:,} / 発火 {part['fallbacks']:,}"
                f" → 率 {_pct(part['ratio'])}（検索/日 {part['searches_per_day']:.1f} / 発火/日 {part['fallbacks_per_day']:.1f}）"
            )
        print(
            f"  発火/日 {_signed_pct(verdict['fallbacks_per_day_change'])} に対し"
            f" 検索/日 {_signed_pct(verdict['searches_per_day_change'])}"
        )
        print(f"  率の差: {verdict['ratio_delta_pt']:+.1f}pt → **{verdict['verdict']}**")
        if verdict["verdict"] == "volume_only":
            print("  ⚠️ 回数は動いていても **依存は動いていない**。«減った» と書かないこと")
    return 0


if __name__ == "__main__":
    sys.exit(main())
