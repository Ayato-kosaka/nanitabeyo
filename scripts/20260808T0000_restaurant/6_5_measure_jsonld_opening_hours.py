#!/usr/bin/env python3
"""#1666 «JSON-LD の営業時間を読むと何件増えるか» を測る（読み取り専用）。

## なぜ要るか

`official_site_crawl.html_to_text()` は分類の前に **`<script>` を丸ごと捨てている**。
したがって schema.org の `Restaurant.openingHours` / `openingHoursSpecification` は
クローラが **1 バイトも見ていない**（リポジトリ全体に `ld+json` の言及が無い）。

⚠️ **これは «取りこぼしているかもしれない» という仮説である。**
#1666 では «測る前に断言して 2 回外している»（「定休日の書き方で 36% 拾える」も
「1 ホップは東京で 65% 効く」も、実データを読んだら違った）。**実装の前に測る。**

## 何を出すか

**同じ HTML** に対して 2 通りの読み方を当て、交差表を出す。

                    JSON-LD 有  JSON-LD 無
    本文パーサ 成功      A          B      … 既に取れている（JSON-LD は要らない）
    本文パーサ 失敗      C          D      … C が **増えぶんそのもの**

判断の材料は `C / 標本` である。ここが数%なら実装しない。

⚠️ **«JSON-LD が書いてある» を増えぶんに数えない。** `"openingHours": "Mo-Su"`（曜日だけ）
   や `opens`/`closes` の無い spec が実在する。`jsonld_opening_hours.entries_with_times`
   が «開始と終了の両方がある» ものだけを返すので、交差表はそれで作る。
   参考のため «時刻の無い JSON-LD» の件数も別に出す。

## 歩き方はクローラと同じにする

`6_3` は «トップで取れなければ 1 ホップ» で歩く。**測るときも同じに歩く**
（トップだけで測ると、本文パーサの成功率が本番より低く出て C が過大になる）。
1 店あたりのリクエストは最大 2 回のままである。

## ⚠️ DB へは 1 行も書かない

実行:
    python3 scripts/20260808T0000_restaurant/6_5_measure_jsonld_opening_hours.py \\
        --schema dev --limit 300 --order seed
"""

from __future__ import annotations

import argparse
import importlib
import logging
import re
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# ⚠️ 取りに行く作法・分類はクローラと同じものを使う（写経しない）。
from official_site_crawl import (  # noqa: E402
    classify_page_with_reason,
    fetch,
    html_to_text,
    pick_hop,
    robots_allows,
)
from jsonld_opening_hours import (  # noqa: E402
    entries_with_times,
    extract_opening_hours_entries,
)

# ⚠️ 候補の絞り込みもクローラと同じ SQL を使う。別の集合を測ると意味が無い。
_crawler = importlib.import_module("6_3_crawl_official_site_hours")
CANDIDATE_SQL = _crawler.CANDIDATE_SQL
NEAR_CLAUSE = _crawler.NEAR_CLAUSE
ORDER_BY_DISTANCE = _crawler.ORDER_BY_DISTANCE
ORDER_BY_SEED = _crawler.ORDER_BY_SEED
SOURCE = _crawler.SOURCE
parse_near = _crawler.parse_near

LOGGER = logging.getLogger(__name__)


def measure_html(html: str) -> tuple[str, bool, bool]:
    """1 ページ分を «本文の箱 / 使える JSON-LD があるか / 時刻の無い JSON-LD があるか» にする。

    ⚠️ 純関数にしてある（ネットワークも DB も触らない）。
       `test_measure_jsonld_opening_hours.py` がここを縛る。
    """
    bucket, _reason = classify_page_with_reason(html_to_text(html))
    usable = bool(entries_with_times(html))
    written = bool(extract_opening_hours_entries(html))
    return bucket, usable, written and not usable


# 取りに行けなかった理由のまとめ方。**「到達できなかった」で 1 つに束ねてはいけない**
# （#1884）。中身は «消えたサイト» と «拒否されたサイト» と «遅いサイト» で、
# 打つ手がまるで違う。前者は URL を捨てる話、後者 2 つはクロールの作法の話である。
_FAILURE_GROUPS: tuple[tuple[str, str], ...] = (
    ("dead_404", r"^http_(404|410)$"),
    ("forbidden_403", r"^http_(401|403)$"),
    ("server_5xx", r"^http_5\d\d$"),
    ("other_http", r"^http_\d+$"),
    ("dns_or_refused", r"(?i)name or service|nodename|getaddrinfo|refused|unreachable"),
    ("timeout", r"(?i)timed? ?out|timeout"),
    ("tls", r"(?i)ssl|certificate|tlsv"),
    ("not_html", r"^not_html"),
)


def classify_failure(reason: str) -> str:
    """`fetch` が返した理由を «打つ手が同じもの» へまとめる。

    ⚠️ **知らない形を `other` に落として黙らないこと。** 実際の文字列も一緒に出すので、
       次に読む人が «other が多いのはなぜか» を推測せずに追える。
    """
    for label, pattern in _FAILURE_GROUPS:
        if re.search(pattern, reason):
            return label
    return "other"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev", choices=["dev"])
    parser.add_argument("--country", default="JP")
    parser.add_argument("--limit", type=int, required=True, help="⚠️ 必須。標本の件数")
    parser.add_argument("--seed", default="1666")
    parser.add_argument(
        "--order",
        default="seed",
        choices=["seed", "distance"],
        help="⚠️ 既定を暗黙にしない（→ 6_3 の ORDER_BY_* のコメント）",
    )
    parser.add_argument("--near", help='"緯度,経度"。渡すとその半径内だけ')
    parser.add_argument("--near-radius-m", type=float, default=700.0)
    parser.add_argument("--min-interval", type=float, default=2.0)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--examples", type=int, default=5)
    args = parser.parse_args()

    from pg_sync_common import connect_postgres
    from pipeline_common import configure_logging
    from psycopg2 import sql as sql_module

    configure_logging()

    near_lat, near_lon = parse_near(args.near)
    if args.order == "distance" and near_lat is None:
        LOGGER.error("--order distance は --near と一緒に渡すこと")
        return 2

    connection = connect_postgres(args.schema, allow_public=False)
    try:
        with connection.cursor() as cursor:
            # PostGIS は extensions スキーマに居る（#2039）
            cursor.execute(
                sql_module.SQL("SET search_path TO {}, extensions, public").format(
                    sql_module.Identifier(args.schema)
                )
            )
            cursor.execute("SET default_transaction_read_only = on")

        sql = CANDIDATE_SQL.format(
            schema=args.schema,
            only_missing="",  # ⚠️ 失敗した店こそ測りたいので «まだ無い店» で絞らない
            near=NEAR_CLAUSE if near_lat is not None else "",
            order=ORDER_BY_DISTANCE if args.order == "distance" else ORDER_BY_SEED,
        )
        params = {
            "country": args.country,
            "seed": args.seed,
            "limit": args.limit,
            "source": SOURCE,
            "near_lat": near_lat,
            "near_lon": near_lon,
            "near_radius_m": args.near_radius_m,
        }
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            candidates = cursor.fetchall()
    finally:
        connection.rollback()
        connection.close()

    LOGGER.info(
        "標本: %d 件（schema=%s / country=%s / 並び=%s / 範囲=%s）",
        len(candidates),
        args.schema,
        args.country,
        args.order,
        f"{args.near} 半径 {args.near_radius_m:.0f}m" if near_lat is not None else "全国",
    )

    # 交差表の 4 マス。キーは (本文パーサが成功したか, 使える JSON-LD があったか)
    cross: Counter[tuple[bool, bool]] = Counter()
    unreachable = 0
    blocked = 0
    # #1884 «到達できなかった» の内訳。束ねたままでは打つ手が決まらない
    failure_groups: Counter[str] = Counter()
    failure_examples: dict[str, str] = {}
    jsonld_without_times = 0
    # 本文では取れず JSON-LD で取れた（= 増えぶんそのもの）
    gained: list[tuple[str, str, object]] = []

    robots_cache: dict = {}
    last_request_at = 0.0

    def throttle():
        nonlocal last_request_at
        wait = args.min_interval - (time.monotonic() - last_request_at)
        if wait > 0:
            time.sleep(wait)
        last_request_at = time.monotonic()

    def get(url: str) -> tuple[str | None, str]:
        """(本文, 失敗理由) を返す。

        ⚠️ **理由を捨てないこと。** 最初に書いたとき `html, _reason = fetch(...)` と
           受け流しており、«到達できなかった 178 件» の中身が run のログにも残らなかった
           （#1884 が欲しい数字そのものを、計算してから捨てていた）。
        """
        throttle()
        try:
            if not robots_allows(url, robots_cache, args.timeout):
                return None, "robots"
            return fetch(url, args.timeout)
        except Exception as error:  # noqa: BLE001
            return None, f"{type(error).__name__}({str(error)[:40]})"

    for i, (_rid, name, url) in enumerate(candidates, start=1):
        if i % 25 == 0:
            LOGGER.info(
                "  … %d/%d（本文成功=%d / JSON-LD だけで取れた=%d）",
                i,
                len(candidates),
                cross[(True, True)] + cross[(True, False)],
                len(gained),
            )

        try:
            if not robots_allows(url, robots_cache, args.timeout):
                blocked += 1
                continue
        except Exception:  # noqa: BLE001
            blocked += 1
            continue

        html, reason = get(url)
        if html is None:
            unreachable += 1
            failure_groups[classify_failure(reason)] += 1
            failure_examples.setdefault(classify_failure(reason), reason)
            continue

        bucket, usable, written_only = measure_html(html)
        hit_url = url
        entries = entries_with_times(html)

        # ⚠️ クローラと同じく «トップで取れなければ 1 ホップ»。トップだけで測ると
        #    本文パーサの成功率が本番より低く出て、増えぶんが過大になる。
        if bucket != "parsed":
            hop_url, _label = pick_hop(html, url)
            if hop_url:
                hop_html, _hop_reason = get(hop_url)
                if hop_html is not None:
                    hop_bucket, hop_usable, hop_written_only = measure_html(hop_html)
                    if hop_bucket == "parsed":
                        bucket = "parsed"
                    if hop_usable and not usable:
                        usable = True
                        hit_url = hop_url
                        entries = entries_with_times(hop_html)
                    written_only = written_only or hop_written_only

        parsed = bucket == "parsed"
        cross[(parsed, usable)] += 1
        if written_only and not usable:
            jsonld_without_times += 1
        if usable and not parsed:
            gained.append((name, hit_url, entries[0]))

    total = len(candidates)
    walked = sum(cross.values())
    LOGGER.info("===== 結果 =====")
    LOGGER.info("標本            : %d 件", total)
    LOGGER.info("  到達できなかった: %d 件", unreachable)
    if unreachable:
        # #1884 内訳を出す。«消えた» と «拒否された» と «遅い» は打つ手が違う
        for label, n in failure_groups.most_common():
            LOGGER.info(
                "      %-16s %4d 件（%.1f%% の標本）  例: %s",
                label,
                n,
                100 * n / total if total else 0,
                failure_examples.get(label, "")[:48],
            )
    LOGGER.info("  robots で不可   : %d 件", blocked)
    LOGGER.info("  読めた（= 交差表の母数）: %d 件", walked)
    LOGGER.info("")
    LOGGER.info("                      JSON-LD 有   JSON-LD 無")
    LOGGER.info("  本文パーサ 成功  %10d %12d", cross[(True, True)], cross[(True, False)])
    LOGGER.info("  本文パーサ 失敗  %10d %12d", cross[(False, True)], cross[(False, False)])
    LOGGER.info("")
    LOGGER.info(
        "参考: 時刻の無い JSON-LD だけがあったページ: %d 件"
        "（«書いてある» を増えぶんに数えると、これを混ぜることになる）",
        jsonld_without_times,
    )
    gain = cross[(False, True)]
    LOGGER.info("")
    LOGGER.info(
        "⭐ 本文パーサの成功: %d 件（読めた %d 件の %.1f%% / 標本 %d 件の %.1f%%）",
        cross[(True, True)] + cross[(True, False)],
        walked,
        100 * (cross[(True, True)] + cross[(True, False)]) / walked if walked else 0,
        total,
        100 * (cross[(True, True)] + cross[(True, False)]) / total if total else 0,
    )
    LOGGER.info(
        "⭐ JSON-LD だけで取れた（増えぶん）: %d 件（標本の %.1f%%）",
        gain,
        100 * gain / total if total else 0,
    )
    for name, hit_url, entry in gained[: args.examples]:
        # ⚠️ 出すのは «その店が公開している営業時間» の 1 件分だけ（診断用、短く）
        LOGGER.info("    例: %s  %s  %.120s", name, hit_url, entry)
    LOGGER.info("")
    LOGGER.info("⚠️ このスクリプトは DB へ 1 行も書いていない（測るだけ）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
