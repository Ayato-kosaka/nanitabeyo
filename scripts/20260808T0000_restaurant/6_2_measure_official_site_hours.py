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
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from jp_site_opening_hours import parse_jp_site_opening_hours  # noqa: E402

USER_AGENT = "NanitabeyoResearchBot/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo; research)"
MAX_BYTES = 2_000_000  # 実測で生 HTML 1.4MB のサイトがあった。それが入る程度で頭打ちにする

# 「営業時間の話をしている」と読める語。`jp_site_opening_hours` の判定より **広く**取る。
# ここは «パーサが諦めただけで、人間なら読めた» を数えるための網なので、緩いほうが正しい。
_HOURS_MENTION_RE = re.compile(r"営業時間|営業日|定休日|休業日|open|OPEN|Open|ランチ|ディナー|開店|閉店")


def html_to_text(html: str) -> str:
    """script / style / タグを落として本文だけにする。

    ⚠️ 依存を増やさないため正規表現で済ませている。**構造は見ていない**ので、
       «どのタグに書いてあるか» が要る用途にはそのまま流用しないこと。
    """
    text = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", html)
    text = re.sub(r"(?s)<!--.*?-->", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
    )
    return re.sub(r"\s+", " ", text).strip()


def fetch(url: str, timeout: float) -> tuple[str | None, str]:
    """(本文, 失敗理由) を返す。成功なら理由は空文字。**再試行しない。**"""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            ctype = res.headers.get("Content-Type", "")
            if "html" not in ctype.lower():
                return None, f"not_html({ctype[:40]})"
            raw = res.read(MAX_BYTES)
        charset = None
        m = re.search(r"charset=([\w-]+)", ctype, re.I)
        if m:
            charset = m.group(1)
        if not charset:
            head = raw[:4096].decode("ascii", "ignore")
            m = re.search(r'charset=["\']?([\w-]+)', head, re.I)
            charset = m.group(1) if m else "utf-8"
        try:
            return raw.decode(charset, "replace"), ""
        except LookupError:
            return raw.decode("utf-8", "replace"), ""
    except urllib.error.HTTPError as e:
        return None, f"http_{e.code}"
    except urllib.error.URLError as e:
        return None, f"urlerror({str(e.reason)[:40]})"
    except Exception as e:  # noqa: BLE001 — 相手のサイトは何でも返してくる
        return None, f"{type(e).__name__}({str(e)[:40]})"


def robots_allows(url: str, cache: dict[str, urllib.robotparser.RobotFileParser | None], timeout: float) -> bool:
    """robots.txt を見て、この URL を取ってよいかを返す。

    ⚠️ **robots.txt 自体が取れないときは «許可» とみなす。** 取れない理由は
       «置いていない»（= 制限なし）が実測 10 件中 3 件あった。取れないことを禁止と
       読むと、制限を課していないサイトまで数から落ちて母数が歪む。
    """
    parts = urllib.parse.urlsplit(url)
    origin = f"{parts.scheme}://{parts.netloc}"
    if origin not in cache:
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(f"{origin}/robots.txt")
        try:
            # urllib.robotparser は UA を名乗らないので自前で取りに行く
            req = urllib.request.Request(f"{origin}/robots.txt", headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as res:
                rp.parse(res.read(200_000).decode("utf-8", "replace").splitlines())
            cache[origin] = rp
        except Exception:  # noqa: BLE001
            cache[origin] = None  # 取れなかった = 制限なしとして扱う
    rp = cache[origin]
    return True if rp is None else rp.can_fetch(USER_AGENT, url)


SAMPLE_SQL = """
SELECT r.id::text, r.name, l.value AS url
FROM {schema}.restaurant_links l
JOIN {schema}.restaurants r ON r.id = l.restaurant_id
WHERE l.kind = 'website'
  AND NULLIF(btrim(l.value), '') IS NOT NULL
  AND l.value ~* '^https?://'
ORDER BY md5(l.restaurant_id::text || %(seed)s)
LIMIT %(limit)s
"""


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--schema", default="dev", help="対象スキーマ（既定 dev）")
    p.add_argument("--limit", type=int, default=300, help="標本の件数（既定 300）")
    p.add_argument("--seed", default="1666", help="標本の並びを決める文字列。同じ値なら同じ標本になる")
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
        cur.execute(SAMPLE_SQL.format(schema=args.schema), {"seed": args.seed, "limit": args.limit})
        rows = cur.fetchall()

    print(f"標本: {len(rows)} 件（schema={args.schema} / seed={args.seed}）")
    if args.dry_run:
        for rid, name, url in rows[:20]:
            print(f"  {rid}  {name}  {url}")
        print(f"  …（--dry-run のためここで終わり。ネットワークへは出ていません）")
        return 0

    counts: Counter[str] = Counter()
    failure_reasons: Counter[str] = Counter()
    robots_cache: dict[str, urllib.robotparser.RobotFileParser | None] = {}
    examples: dict[str, list[str]] = {"parsed": [], "mentions_hours_unparsed": []}
    last_request_at = 0.0

    for i, (rid, name, url) in enumerate(rows, start=1):
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
            text = html_to_text(html)
            if parse_jp_site_opening_hours(text) is not None:
                counts["parsed"] += 1
                if len(examples["parsed"]) < 5:
                    examples["parsed"].append(f"{name} {url}")
            elif _HOURS_MENTION_RE.search(text):
                counts["mentions_hours_unparsed"] += 1
                if len(examples["mentions_hours_unparsed"]) < 5:
                    examples["mentions_hours_unparsed"].append(f"{name} {url}")
            else:
                counts["no_hours_mentioned"] += 1

        if i % 25 == 0:
            print(f"  … {i}/{len(rows)} 件（{dict(counts)}）", flush=True)

    total = len(rows)
    reached = counts["parsed"] + counts["mentions_hours_unparsed"] + counts["no_hours_mentioned"]

    def pct(n: int, d: int) -> str:
        return f"{n / d * 100:.1f}%" if d else "—"

    print("\n===== 結果 =====")
    print(f"標本                         : {total}")
    print(f"  到達できなかった           : {counts['unreachable']}  ({pct(counts['unreachable'], total)})")
    print(f"  robots.txt が禁止していた  : {counts['blocked_by_robots']}  ({pct(counts['blocked_by_robots'], total)})")
    print(f"  到達できた                 : {reached}  ({pct(reached, total)})")
    print("\n到達できたページの内訳（← ここが «LLM が要るか» を決める）")
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
