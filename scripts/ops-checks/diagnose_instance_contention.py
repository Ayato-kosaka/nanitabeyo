#!/usr/bin/env python3
"""#2006 «遅いのはインスタンス» の先へ — 同居リクエストによる CPU 競合かを確かめる（読み取り専用）。

## なぜ要るか

`/v1/dish-media/search` は、同じコード・同じ DB に対してインスタンスによって
p50 0.22 秒 〜 41.7 秒とばらついていた。クエリや入力の差では説明が付かない。

残った仮説は「**重い同居リクエストが CPU を奪っている**」。Cloud Run は 1 インスタンスで
複数リクエストを同時に捌くので、重い処理（Google Places を叩く `/v1/dishes/bulk-import` 等）
が居座ると、本来 0.5 秒の DB クエリまで巻き添えで待たされる。

## なぜ Monitoring だけでは足りないか

Cloud Run の `container/cpu/utilizations` や `max_request_concurrencies` は
**リビジョン単位の分布**で、`instance_id` のラベルを持たない。
「どのインスタンスが忙しかったか」は Monitoring からは出ない。

そこで **リクエストログから同居数を自分で数える**。各リクエストの区間は
[timestamp - latency, timestamp] で分かるので、同じインスタンス上で重なっている
リクエストを数えれば、その瞬間の同時実行数が出る。**これは実測であって推定ではない。**

## 読み取り専用である

Logging を読むだけ。書き込み系の API は呼ばない。

## 使い方

    script_path:       scripts/ops-checks/diagnose_instance_contention.py
    args:              --since 2026-09-21T12:00:00Z --until 2026-09-21T14:30:00Z
    requirements_path: scripts/ops-checks/requirements.txt
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import logging
import re

LOGGER = logging.getLogger(__name__)

PROJECT = "food-scroll"
SERVICE = "api-production"
SLOW_SECONDS = 10.0


def _parse_latency(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, dict):
        return float(value.get("seconds", 0)) + float(value.get("nanos", 0)) / 1e9
    if hasattr(value, "total_seconds"):
        return value.total_seconds()
    match = re.match(r"^([0-9.]+)s$", str(value))
    return float(match.group(1)) if match else None


def _short_url(url: str) -> str:
    path = re.sub(r"^https?://[^/]+", "", url or "")
    path = path.split("?", 1)[0]
    return re.sub(r"[0-9a-fA-F]{8}-[0-9a-fA-F-]+", "<id>", path)[:44]


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", required=True)
    parser.add_argument("--until", required=True)
    parser.add_argument("--target", default="dish-media/search")
    parser.add_argument("--limit", type=int, default=30000)
    args = parser.parse_args()

    from google.cloud import logging as gcl

    client = gcl.Client(project=PROJECT)
    # ⚠️ URL で絞らない。**同居しているリクエストこそが見たいもの**だから。
    log_filter = (
        'resource.type="cloud_run_revision" '
        f'resource.labels.service_name="{SERVICE}" '
        'logName:"run.googleapis.com%2Frequests" '
        f'timestamp>="{args.since}" timestamp<"{args.until}"'
    )

    Req = collections.namedtuple("Req", "start end url instance latency")
    by_instance: dict[str, list] = collections.defaultdict(list)
    total = 0

    for entry in client.list_entries(filter_=log_filter, page_size=1000):
        total += 1
        if total > args.limit:
            LOGGER.warning("⚠️ --limit %s に達した。窓を狭めること（結果は不完全）", args.limit)
            break
        http = getattr(entry, "http_request", None) or {}
        latency = _parse_latency(http.get("latency"))
        if latency is None:
            continue
        labels = dict(entry.labels or {})
        instance = labels.get("run.googleapis.com/instanceId") or labels.get("instanceId") or "(unknown)"
        end = entry.timestamp
        start = end - dt.timedelta(seconds=latency)
        by_instance[instance[-12:]].append(
            Req(start, end, _short_url(http.get("requestUrl") or ""), instance[-12:], latency)
        )

    LOGGER.info("=" * 76)
    LOGGER.info("# 同居リクエストの実測（%s 〜 %s）", args.since, args.until)
    LOGGER.info("=" * 76)
    LOGGER.info("読んだリクエスト: %s / インスタンス: %s", total, len(by_instance))

    slow_conc: list[int] = []
    fast_conc: list[int] = []
    neighbour_when_slow = collections.Counter()

    for instance, reqs in by_instance.items():
        reqs.sort(key=lambda r: r.start)
        for req in reqs:
            if args.target not in req.url:
                continue
            overlapping = [
                other for other in reqs
                if other is not req and other.start < req.end and other.end > req.start
            ]
            concurrency = len(overlapping)
            if req.latency >= SLOW_SECONDS:
                slow_conc.append(concurrency)
                for other in overlapping:
                    neighbour_when_slow[other.url] += 1
            else:
                fast_conc.append(concurrency)

    def _stats(name: str, values: list[int]) -> None:
        if not values:
            LOGGER.info("  %-22s （該当なし）", name)
            return
        values = sorted(values)
        LOGGER.info(
            "  %-22s 件数 %4d / 同時実行 中央値 %2d / 最大 %3d / 平均 %5.1f",
            name, len(values), values[len(values) // 2], values[-1],
            sum(values) / len(values),
        )

    LOGGER.info("")
    LOGGER.info("-" * 76)
    LOGGER.info("# %s のリクエストが «何本と同居していたか»", args.target)
    LOGGER.info("-" * 76)
    _stats("遅い（%.0fs 以上）" % SLOW_SECONDS, slow_conc)
    _stats("速い", fast_conc)
    LOGGER.info("")
    LOGGER.info("  ⚠️ 遅い側の同時実行が速い側より明らかに大きければ «同居による競合» で確定。")
    LOGGER.info("     同じなら競合ではなく、インスタンス自体の別の問題へ戻る。")

    LOGGER.info("")
    LOGGER.info("-" * 76)
    LOGGER.info("# 遅いときに同居していた相手（上位 12）")
    LOGGER.info("-" * 76)
    for url, n in neighbour_when_slow.most_common(12):
        LOGGER.info("  %-46s %5d 回", url, n)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
