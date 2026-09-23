#!/usr/bin/env python3
"""#2006 Cloud Run 側から見た «同じクエリが 0.5 秒のときも 60 秒のときもある» の正体を採る（読み取り専用）。

## なぜ要るか

2026-09-21 から `/v1/dish-media/search` の尾が壊れている（p50 は 0.5 秒のまま、
p95 が 17 秒 / 最大 62 秒）。BigQuery のアプリログで次の 5 つは実測で否定済み。

  1. API のコード変更（api-deploy は 09-10 が最後）
  2. 索引の欠落 / INVALID（宣言 82 件すべて存在・VALID）
  3. DB インスタンス全体の不調（長時間クエリ 0 / 接続 27/60）
  4. 営業時間テーブルが埋まった（本番 0 行）
  5. generic plan への切り替わり（custom と generic が同値 10〜18 ms）

残る候補は **Cloud Run 側のインスタンス競合・コールドスタート・CPU スロットリング**だが、
アプリの stdout には «遅かった» までしか出ない。Cloud Run のリクエストログは
BigQuery へ sink されていないので（sink は run_googleapis_com_stdout だけ）、
Logging / Monitoring を直接読む。

## 何を見れば決着するのか

**遅いリクエストが «同じインスタンスに固まっているか»。**

- 固まっている → そのインスタンスの競合・スロットリング
- 散っている   → インスタンス個別の問題ではない（別の原因へ戻る）

コールドスタートなら、遅いリクエストの直前にそのインスタンスの最初のリクエストが来る。

## 読み取り専用である

Logging と Monitoring を **読むだけ**。書き込み系の API は呼ばない。

## 使い方

    script_path:       scripts/ops-checks/diagnose_cloud_run_latency.py
    args:              --since 2026-09-21T00:00:00Z --until 2026-09-24T00:00:00Z
    requirements_path: scripts/ops-checks/requirements.txt
"""

from __future__ import annotations

import argparse
import collections
import logging
import re

LOGGER = logging.getLogger(__name__)

PROJECT = "food-scroll"
SERVICE = "api-production"
SLOW_SECONDS = 10.0


def _parse_latency(value) -> float | None:
    """httpRequest.latency は "1.234s" か {seconds, nanos} で来る。秒（float）へ揃える。"""
    if value is None:
        return None
    if isinstance(value, dict):
        return float(value.get("seconds", 0)) + float(value.get("nanos", 0)) / 1e9
    if hasattr(value, "total_seconds"):
        return value.total_seconds()
    match = re.match(r"^([0-9.]+)s$", str(value))
    return float(match.group(1)) if match else None


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", required=True, help="RFC3339（例: 2026-09-21T00:00:00Z）")
    parser.add_argument("--until", required=True)
    parser.add_argument("--url-contains", default="dish-media/search")
    parser.add_argument("--limit", type=int, default=4000)
    args = parser.parse_args()

    from google.cloud import logging as gcl

    client = gcl.Client(project=PROJECT)
    # ⚠️ 絞り込みは **サーバ側**で掛ける。クライアント側で捨てると
    # 無関係な行で page/limit を食い潰し、«遅いものが 1 件も無かった» という
    # 嘘の結論が出る（最初の実行で実際にこれを踏んだ）。
    log_filter = (
        'resource.type="cloud_run_revision" '
        f'resource.labels.service_name="{SERVICE}" '
        'logName:"run.googleapis.com%2Frequests" '
        f'httpRequest.requestUrl:"{args.url_contains}" '
        f'timestamp>="{args.since}" timestamp<"{args.until}"'
    )

    LOGGER.info("=" * 72)
    LOGGER.info("# Cloud Run リクエストログ（%s 〜 %s）", args.since, args.until)
    LOGGER.info("=" * 72)

    total = 0
    matched = 0
    slow_by_instance: dict[str, int] = collections.Counter()
    all_by_instance: dict[str, int] = collections.Counter()
    slow_rows: list[tuple[str, float, str]] = []
    all_rows: list[tuple] = []

    dumped = False
    for entry in client.list_entries(filter_=log_filter, page_size=1000):
        if not dumped:
            dumped = True
            LOGGER.info("--- 生の 1 件（フィールド名を確かめるため）---")
            LOGGER.info("  http_request: %s", getattr(entry, "http_request", None))
            LOGGER.info("  labels      : %s", dict(entry.labels or {}))
            LOGGER.info("  resource    : %s", getattr(getattr(entry, "resource", None), "labels", None))
            LOGGER.info("-" * 40)
        total += 1
        if total > args.limit:
            LOGGER.info("（--limit %s に達したので打ち切り）", args.limit)
            break
        http = getattr(entry, "http_request", None) or {}
        matched += 1
        labels = dict(entry.labels or {})
        resource_labels = dict(getattr(getattr(entry, "resource", None), "labels", None) or {})
        instance = (
            labels.get("run.googleapis.com/instanceId")
            or labels.get("instanceId")
            or resource_labels.get("instanceId")
            or "(unknown)"
        )
        short = instance[-12:] if instance != "(unknown)" else instance
        all_by_instance[short] += 1
        seconds = _parse_latency(http.get("latency"))
        all_rows.append((entry.timestamp, seconds, short))
        if seconds is not None and seconds >= SLOW_SECONDS:
            slow_by_instance[short] += 1
            slow_rows.append((entry.timestamp.isoformat(), seconds, short))

    LOGGER.info("読んだ行: %s / 対象 URL に一致: %s / うち %s 秒以上: %s",
                total, matched, SLOW_SECONDS, len(slow_rows))

    if matched == 0:
        LOGGER.warning("⚠️ 1 件も一致しませんでした。service_name / 期間 / URL を確認すること")
        return 0

    LOGGER.info("")
    LOGGER.info("-" * 72)
    LOGGER.info("# インスタンス別（遅い / 全体）— 固まっていれば競合、散っていれば別の原因")
    LOGGER.info("-" * 72)
    for instance, n_all in all_by_instance.most_common(20):
        n_slow = slow_by_instance.get(instance, 0)
        ratio = (n_slow / n_all * 100) if n_all else 0
        mark = " ⚠️" if ratio >= 30 and n_all >= 3 else ""
        LOGGER.info("  %-14s 遅い %3d / 全体 %4d  (%5.1f%%)%s", instance, n_slow, n_all, ratio, mark)

    LOGGER.info("")
    LOGGER.info("  インスタンス数: 全体 %s / 遅いものが出た %s",
                len(all_by_instance), len(slow_by_instance))

    # #2006 «インスタンスの最初のほうだけ遅い» ＝ コールドスタート / 接続プールの立ち上がり。
    # «途中から遅くなる» ＝ そのインスタンスが後から劣化している。別の打ち手になるので分ける。
    LOGGER.info("")
    LOGGER.info("-" * 72)
    LOGGER.info("# 遅いのはインスタンスの «何番目» のリクエストか")
    LOGGER.info("-" * 72)
    per_instance: dict[str, list] = collections.defaultdict(list)
    for ts, seconds, instance in all_rows:
        per_instance[instance].append((ts, seconds))
    bucket = collections.Counter()
    slow_positions: list[int] = []
    for instance, rows in per_instance.items():
        rows.sort(key=lambda row: row[0])
        for position, (_, seconds) in enumerate(rows, start=1):
            if seconds is not None and seconds >= SLOW_SECONDS:
                slow_positions.append(position)
                if position == 1:
                    bucket["1 番目"] += 1
                elif position <= 3:
                    bucket["2〜3 番目"] += 1
                elif position <= 10:
                    bucket["4〜10 番目"] += 1
                else:
                    bucket["11 番目以降"] += 1
    for name in ("1 番目", "2〜3 番目", "4〜10 番目", "11 番目以降"):
        LOGGER.info("  %-12s %3d 件", name, bucket.get(name, 0))
    if slow_positions:
        slow_positions.sort()
        median = slow_positions[len(slow_positions) // 2]
        LOGGER.info("  遅いリクエストの «順番» の中央値: %s 番目", median)

    LOGGER.info("")
    LOGGER.info("-" * 72)
    LOGGER.info("# 遅いリクエスト（先頭 25 件）")
    LOGGER.info("-" * 72)
    for ts, seconds, instance in sorted(slow_rows, key=lambda row: -row[1])[:25]:
        LOGGER.info("  %-28s %7.1f s  instance=%s", ts, seconds, instance)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
