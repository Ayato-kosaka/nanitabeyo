#!/usr/bin/env python3
"""#1273 収集済みだが «キャプションが空» の投稿へ、埋め込み SSR から本文を後入れする。

## なぜこれが効くか（#1815 実測）
`sns_post_raw` には **305,538 件のキャプション空の投稿**が既に入っている。うち
**156,204 件は `discovery_seed_place_id` を持つ**（柱1 店アカウント・柱1-B 店サイト埋め込み）。
つまり **店は収集時点で確定していて、足りないのはキャプション（＝料理カテゴリ）だけ**。
店の照合を通らずに «店 × 料理カテゴリ» のペアが作れるので、resolve の最大の漏れ
（`skipped_no_store` 234,108 件）を丸ごと迂回できる。

KPI は «市区町村 × 料理カテゴリ» のセルに異なり 5 店なので、効くのは店数ではなく
**«店 × カテゴリ» のペア数**である。実測では 1 店あたりのカテゴリ数は投稿本数で決まる:

| その店の matched 投稿数 | 1 店あたりカテゴリ数 |
| --- | --- |
| 1 本 | 1.06 |
| 3-4 本 | 1.88 |
| 10-19 本 | 4.13 |
| 20 本以上 | **8.55** |

対象 156,204 件は 3,317 店（1 店あたり平均 47 本）なので、**1 店を «20 本以上» の帯へ
押し上げるのに十分な在庫がある**。だから深さより幅を優先せず、`--max-per-store` で
1 店あたりを打ち切って全店を上の帯へ乗せるのが最も効率が良い。

## 取り方
`instagram.com/p/{code}/embed/captioned/` の公開 SSR HTML。トークン不要。
実測（`1273_instagram_seed_poc/embed_ratelimit.py`）で 500 連射 500/500 = HTTP 200、
約 6,870 件/時、ブロック 0。取得レートは全スレッド合計で `--rate-per-sec` に固定し、
非 200 が連続したらそのバッチを打ち切る（`--max-consecutive-errors`）。

## 使い方（db-script-run.yml）
  args: --run-id sns-2026-09-02-fsq --only-with-seed --max-per-store 25 --max-minutes 320
"""
from __future__ import annotations

import argparse
import logging
import random
import re
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from queue import Queue

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id
from common_sns import TABLE_POST_RAW, TABLE_POST_RESOLVED
from sns_html import caption_from_embed_html

LOGGER = logging.getLogger(__name__)
CHUNK = 2000  # 1 回の UPDATE に載せる件数
FLUSH_EVERY = 500  # 取れたぶんを途中で書き戻す間隔（6 時間で切られても失わない）
UA = "nanitabeyo-sns-seed/1.0"
EMBED = "https://www.instagram.com/p/{code}/embed/captioned/"
_RE_CODE = re.compile(r"instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]{5,})")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="キャプションが空の投稿へ埋め込み SSR から本文を入れる")
    p.add_argument("--run-id", default=None, help="対象の sns_post_raw.run_id")
    p.add_argument("--only-with-seed", action="store_true",
                   help="discovery_seed_place_id を持つ投稿だけ（店が確定済み＝最も確実に効く）")
    # #1273 「caption を入れてから resolve する」段取りで使う。caption 空の投稿には
    # **まだ resolve していないもの**と、**caption 無しのまま resolve 済みのもの**が混ざる。
    # 後者にも価値はある（実測 2026-09-05: run sns-2026-09-02-fsq で 20,250 投稿 /
    # 1,310 店が «resolve 済みだがカテゴリが付かなかった»）が、**取りに行く量が倍以上に
    # 増える**ので、どちらを対象にするかは呼び出し側が明示する。
    p.add_argument("--only-unresolved", action="store_true",
                   help="sns_post_resolved に 1 行も無い投稿だけ（«これから resolve する分» に絞る）")
    p.add_argument("--max-per-store", type=int, default=25,
                   help="1 店あたりの取得上限。深さより幅（実測で 20 本超えると 8.55 カテゴリ）")
    p.add_argument("--limit", type=int, default=200000, help="このバッチの取得上限")
    p.add_argument("--rate-per-sec", type=float, default=1.9,
                   help="1 秒あたりの取得数（実測 6,870/時 ≒ 1.9/s）")
    p.add_argument("--concurrency", type=int, default=4)
    p.add_argument("--max-minutes", type=int, default=320, help="CI の 6 時間上限の手前で終える")
    p.add_argument("--max-consecutive-errors", type=int, default=50,
                   help="非 200 がこれだけ続いたらバッチを打ち切る")
    p.add_argument("--dry-run", action="store_true", help="対象件数だけ数える")
    return p.parse_args()


class Pacer:
    """全スレッド合計で --rate-per-sec を超えないようにする。"""

    def __init__(self, rate_per_sec: float) -> None:
        self._interval = 1.0 / rate_per_sec if rate_per_sec > 0 else 0.0
        self._lock = threading.Lock()
        self._next = time.monotonic()

    def wait(self) -> None:
        if self._interval <= 0:
            return
        with self._lock:
            now = time.monotonic()
            if self._next < now:
                self._next = now
            delay = self._next - now
            self._next += self._interval
        if delay > 0:
            time.sleep(delay)


def _fetch_caption(code: str, timeout: float = 20.0) -> tuple[str | None, int]:
    """(caption, status)。caption は取れなければ None。"""
    req = urllib.request.Request(EMBED.format(code=code), headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        return None, e.code
    except Exception:  # noqa: BLE001 - ネットワーク断は «取れなかった» と同じ扱い
        return None, -1
    # ⚠️ `captions_from_html`（第三者サイトの blockquote 用）ではなく、
    # 公式の埋め込みページ用の抽出器を使う。構造が違い、前者では 1 件も採れない。
    return caption_from_embed_html(raw), status


def _select_sql(pipeline: BigQueryPipeline, only_with_seed: bool, max_per_store: int,
                only_unresolved: bool = False) -> str:
    seed_filter = ("AND discovery_seed_place_id IS NOT NULL AND discovery_seed_place_id != ''"
                   if only_with_seed else "")
    # 「まだ resolve していない投稿」= resolved に post_id が 1 行も無いもの。run_id や
    # resolve_version では絞らない（同じ投稿が複数の収集 run に入るため。5_1 の
    # --skip-resolved-anywhere と同じ考え方）。
    unresolved_filter = ""
    if only_unresolved:
        unresolved_filter = (
            f"AND post_id NOT IN (SELECT post_id FROM `{pipeline.table(TABLE_POST_RESOLVED)}` "
            "WHERE post_id IS NOT NULL)")
    # 1 店あたりを打ち切る。深く掘るより全店を «20 本以上» の帯へ乗せる方がペアが増える。
    per_store = ""
    if max_per_store > 0:
        per_store = f"""
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY COALESCE(NULLIF(discovery_seed_place_id, ''), account_id, post_id)
        ORDER BY fetched_at DESC
      ) <= {int(max_per_store)}"""
    return f"""
      SELECT post_id, canonical_url
      FROM `{pipeline.table(TABLE_POST_RAW)}`
      WHERE run_id = @rid AND (caption IS NULL OR LENGTH(caption) = 0)
        AND canonical_url IS NOT NULL {seed_filter} {unresolved_filter}
      {per_store}
    """


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    from google.cloud import bigquery

    rows = list(pipeline.execute(
        _select_sql(pipeline, args.only_with_seed, args.max_per_store, args.only_unresolved),
        [bigquery.ScalarQueryParameter("rid", "STRING", run_id)]))
    targets = []
    for r in rows:
        m = _RE_CODE.search(r["canonical_url"] or "")
        if m:
            targets.append((r["post_id"], m.group(1)))
    random.shuffle(targets)  # 1 店に固まらせず、全店へ均等に効かせる
    targets = targets[:args.limit]
    LOGGER.info("キャプションが空で取りにいける投稿 %d 件（%.1f 時間ぶん @ %.1f/s）",
                len(targets), len(targets) / max(args.rate_per_sec, 0.01) / 3600, args.rate_per_sec)
    if args.dry_run or not targets:
        return

    deadline = time.monotonic() + args.max_minutes * 60
    pacer = Pacer(args.rate_per_sec)
    got: Queue = Queue()
    state = {"consecutive_errors": 0, "stop": False, "ok": 0, "empty": 0, "err": 0}
    lock = threading.Lock()

    def work(item: tuple[str, str]) -> None:
        post_id, code = item
        if state["stop"] or time.monotonic() > deadline:
            return
        pacer.wait()
        cap, status = _fetch_caption(code)
        with lock:
            if status == 200:
                state["consecutive_errors"] = 0
                if cap:
                    state["ok"] += 1
                    got.put({"post_id": post_id, "caption": cap})
                else:
                    state["empty"] += 1
            else:
                state["err"] += 1
                state["consecutive_errors"] += 1
                if state["consecutive_errors"] >= args.max_consecutive_errors:
                    if not state["stop"]:
                        LOGGER.warning("非 200 が %d 回続いたのでこのバッチを打ち切ります",
                                       state["consecutive_errors"])
                    state["stop"] = True

    sql = f"""
      UPDATE `{pipeline.table(TABLE_POST_RAW)}` t
      SET caption = s.caption
      FROM (
        SELECT @pids[OFFSET(o)] AS post_id, @caps[OFFSET(o)] AS caption
        FROM UNNEST(GENERATE_ARRAY(0, ARRAY_LENGTH(@pids) - 1)) o
      ) s
      WHERE t.run_id = @rid AND t.post_id = s.post_id
        AND (t.caption IS NULL OR LENGTH(t.caption) = 0)
    """

    def flush() -> int:
        batch = []
        while not got.empty():
            batch.append(got.get())
        done = 0
        for i in range(0, len(batch), CHUNK):
            part = batch[i:i + CHUNK]
            pipeline.execute_dml_retrying(sql, [
                bigquery.ScalarQueryParameter("rid", "STRING", run_id),
                bigquery.ArrayQueryParameter("pids", "STRING", [b["post_id"] for b in part]),
                bigquery.ArrayQueryParameter("caps", "STRING", [b["caption"] for b in part]),
            ])
            done += len(part)
        return done

    written = 0
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        for idx, _ in enumerate(pool.map(work, targets), 1):
            if idx % FLUSH_EVERY == 0:
                written += flush()
                LOGGER.info("  %d/%d 取得（本文あり %d / 空 %d / 失敗 %d）→ 書き戻し累計 %d",
                            idx, len(targets), state["ok"], state["empty"], state["err"], written)
            if state["stop"] or time.monotonic() > deadline:
                break
    written += flush()
    LOGGER.info("キャプション後入れ完了: 書き戻し %d 件（本文あり %d / 空 %d / 失敗 %d）",
                written, state["ok"], state["empty"], state["err"])


if __name__ == "__main__":
    main()
