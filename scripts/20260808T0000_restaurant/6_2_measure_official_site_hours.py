#!/usr/bin/env python3
"""#1666 公式サイトから営業時間をどれだけ «機械で構造化できるか» を実測する（読み取り専用）。

## なぜ要るか

営業時間の供給元は 2 つある。OSM は dev へ投入済みだが **62 万店に対する被覆は約 2%**
（13,065 店）。本命は website を持つ **282,163 店（45.4%）** の公式サイトである。

[実現性の実測（10 件）](https://github.com/Ayato-kosaka/nanitabeyo/issues/843#issuecomment-5429418172)
は «記載があるか» までを測った（到達できた 7 件のうち 5 件にあった）。しかし
**«記載がある» と «機械で構造化できる» は別**で、そこは未検証のままだった。
さらにその実測自身が「10 件では C 分類（画像内 OCR）や robots の実態は分からない」と書いている。

**クローラを作る前に、決定的パーサ（`jp_site_opening_hours.py`）の実際の命中率を測る。**
ここが十分に高ければ LLM は要らない。低ければ «LLM へ回す残り» が何件なのかが分かり、
金額の判断材料になる（全件 LLM は中央値ベースで 3.68 億トークンという見積もりが出ている）。

## 何を数えるか（ここが設計の要）

到達できたページを **3 つに分ける**。この分け方が «LLM が要るか» を決める。

| 分類 | 意味 |
| --- | --- |
| `parsed` | 決定的パーサが行を作れた = **$0 で構造化できる** |
| `mentions_hours_unparsed` | 営業時間の語はあるのにパーサが諦めた = **LLM の候補はここだけ** |
| `no_hours_mentioned` | そもそも営業時間の記載が見当たらない = LLM でも取れない |

⚠️ その手前に `not_japanese_page` がある。**日本語かどうかはページの中身で決める。**
`--country JP` を効かせても韓国語サイトが標本に残り、座標を出したら **韓国にある店**だった
（国コードの誤り。下の `_HOURS_MENTION_RE` の直前の注記に詳細）。国コードを直しても
«日本にある韓国料理店» は残るので、**どのみち母数から外す判定はページの中身で要る**。

⚠️ **`parsed` の «正しさ» は測っていない。** ここで分かるのは «構造化できた件数» であって
«内容が合っているか» ではない。パーサの正しさは実サイトの原文 5 件に対する
`test_jp_site_opening_hours.py` が担当する。**この 2 つを混ぜて報告しないこと。**

## 相手のサイトへの態度

- `robots.txt` を取得し、**禁止されていれば取りに行かない**（`blocked_by_robots` として数える）
- User-Agent を名乗る（`NanitabeyoResearchBot/1.0`）
- **1 件あたり `--min-interval` 秒以上あける**（既定 2.0。実測 10 件のときと同じ）
- タイムアウトと本文サイズに上限を置く。**再試行しない**（相手を 2 度叩かない）
- トップページ 1 枚だけを見る。**リンクは辿らない**（実測で 3 ホップ必要な例があったが、
  それは «追従が要る割合» を別途測る話。ここでは «1 枚で取れる割合» を測る）

## ⚠️ 既定で日本（JP）に閉じる

パーサは**日本語専用**である。dry-run（run 33988256520）の標本 20 件に韓国語サイトが
3 件あり、そのまま測ると «日本語ページの何割を読めるか» が薄まって判断材料にならない。
`--country ALL` で外せるが、そのときの数字を «日本語パーサの命中率» として読まないこと。

## 使い方

    script_path: scripts/20260808T0000_restaurant/6_2_measure_official_site_hours.py
    args: --schema dev --limit 300
    requirements_path: scripts/20260808T0000_restaurant/requirements.txt

まず `--dry-run` で対象だけ出して SQL を確かめること（ネットワークへ出ない）。

環境変数: DATABASE_URL（必須）
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# ⚠️ 取りに行く作法（robots / UA / 上限 / 分類）は official_site_crawl に 1 本化してある。
#    ここへ書き写さないこと。書き写すと «測った数字» と «6_3 が入れた行» がずれる。
from official_site_crawl import (  # noqa: E402
    classify_page,
    fetch,
    html_to_text,
    robots_allows,
    to_ascii_url,  # noqa: F401  — テストが参照する
)

# ⚠️ **国で絞る。** パーサは日本語専用なので、韓国語サイトを母数に混ぜると
# «日本語ページの何割を読めるか» が薄まり、«LLM が要るか» の判断材料にならなくなる。
# dry-run（run 33988256520）の標本 20 件に韓国語サイトが 3 件あって気づいた。
# `--country ALL` で外せるが、そのときは «日本語パーサの命中率» として読まないこと。
SAMPLE_SQL = """
SELECT r.id::text, r.name, l.value AS url, r.country_code, r.latitude, r.longitude
FROM {schema}.restaurant_links l
JOIN {schema}.restaurants r ON r.id = l.restaurant_id
WHERE l.kind = 'website'
  AND NULLIF(btrim(l.value), '') IS NOT NULL
  AND l.value ~* '^https?://'
  AND (%(country)s = 'ALL' OR r.country_code = %(country)s)
ORDER BY md5(l.restaurant_id::text || %(seed)s)
LIMIT %(limit)s
"""


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--schema", default="dev", help="対象スキーマ（既定 dev）")
    p.add_argument("--limit", type=int, default=300, help="標本の件数（既定 300）")
    p.add_argument("--seed", default="1666", help="標本の並びを決める文字列。同じ値なら同じ標本になる")
    p.add_argument(
        "--country",
        default="JP",
        help="国コードで絞る（既定 JP）。パーサは日本語専用なので既定で JP に閉じる。ALL で全件",
    )
    p.add_argument("--min-interval", type=float, default=2.0, help="1 件あたり最低これだけ空ける秒数")
    p.add_argument("--timeout", type=float, default=20.0, help="1 件あたりのタイムアウト秒")
    p.add_argument("--dry-run", action="store_true", help="ネットワークへ出ず、対象だけ出す")
    args = p.parse_args()

    if args.schema == "public":
        # ⚠️ 本番スキーマを読む理由がここには無い（website の分布は dev で足りる）。
        print("❌ このスクリプトは public を対象にしません（dev で測る）", file=sys.stderr)
        return 2

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("❌ DATABASE_URL が未設定です", file=sys.stderr)
        return 2

    import psycopg2  # 依存は requirements.txt（psycopg2-binary）

    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            SAMPLE_SQL.format(schema=args.schema),
            {"seed": args.seed, "limit": args.limit, "country": args.country},
        )
        rows = cur.fetchall()

    print(f"標本: {len(rows)} 件（schema={args.schema} / seed={args.seed} / country={args.country}）")
    if args.country != "JP":
        print("⚠️ country が JP ではありません。この結果を «日本語パーサの命中率» として読まないこと")
    if args.dry_run:
        for rid, name, url, cc, lat, lon in rows[:20]:
            print(f"  {cc}  ({lat:.3f},{lon:.3f})  {name}  {url}")
        print(f"  …（--dry-run のためここで終わり。ネットワークへは出ていません）")
        return 0

    counts: Counter[str] = Counter()
    failure_reasons: Counter[str] = Counter()
    robots_cache: dict[str, urllib.robotparser.RobotFileParser | None] = {}
    # not_japanese_page も例を残す。«日本にある韓国料理店なのか国コードの誤りなのか» を
    # 後から人が確かめられる唯一の手がかりになる。
    examples: dict[str, list[str]] = {"parsed": [], "mentions_hours_unparsed": [], "not_japanese_page": []}
    last_request_at = 0.0

    for i, (rid, name, url, _cc, _lat, _lon) in enumerate(rows, start=1):
        wait = args.min_interval - (time.monotonic() - last_request_at)
        if wait > 0:
            time.sleep(wait)
        last_request_at = time.monotonic()

        try:
            if not robots_allows(url, robots_cache, args.timeout):
                counts["blocked_by_robots"] += 1
                continue
            html, reason = fetch(url, args.timeout)
        except Exception as e:  # noqa: BLE001
            html, reason = None, f"{type(e).__name__}"

        if html is None:
            counts["unreachable"] += 1
            failure_reasons[reason] += 1
        else:
            bucket = classify_page(html_to_text(html))
            counts[bucket] += 1
            if bucket in examples and len(examples[bucket]) < 5:
                examples[bucket].append(f"{name} {url}")

        if i % 25 == 0:
            print(f"  … {i}/{len(rows)} 件（{dict(counts)}）", flush=True)

    total = len(rows)
    reached = counts["parsed"] + counts["mentions_hours_unparsed"] + counts["no_hours_mentioned"]
    reached_any = reached + counts["not_japanese_page"]

    def pct(n: int, d: int) -> str:
        return f"{n / d * 100:.1f}%" if d else "—"

    print("\n===== 結果 =====")
    print(f"標本                         : {total}")
    print(f"  到達できなかった           : {counts['unreachable']}  ({pct(counts['unreachable'], total)})")
    print(f"  robots.txt が禁止していた  : {counts['blocked_by_robots']}  ({pct(counts['blocked_by_robots'], total)})")
    print(f"  到達できた                 : {reached_any}  ({pct(reached_any, total)})")
    print(f"    うち日本語でないページ   : {counts['not_japanese_page']}  ({pct(counts['not_japanese_page'], reached_any)})")
    print(f"    うち日本語のページ       : {reached}  ({pct(reached, reached_any)})")
    print("\n日本語ページの内訳（← ここが «LLM が要るか» を決める）")
    print(f"  parsed（$0 で構造化できた）        : {counts['parsed']}  ({pct(counts['parsed'], reached)})")
    print(f"  mentions_hours_unparsed（LLM 候補）: {counts['mentions_hours_unparsed']}  ({pct(counts['mentions_hours_unparsed'], reached)})")
    print(f"  no_hours_mentioned（記載なし）     : {counts['no_hours_mentioned']}  ({pct(counts['no_hours_mentioned'], reached)})")

    if failure_reasons:
        print("\n到達できなかった理由の内訳")
        for reason, n in failure_reasons.most_common(12):
            print(f"  {n:4d}  {reason}")

    for label, items in examples.items():
        if items:
            print(f"\n{label} の例（最大 5 件）")
            for it in items:
                print(f"  {it}")

    print("\n⚠️ parsed は «構造化できた件数» であって «内容が正しい件数» ではない。")
    print("   パーサの正しさは test_jp_site_opening_hours.py（実サイトの原文 5 件）が担当する。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
