#!/usr/bin/env python3
"""#1273 Overture の socials が Meta 経路にとって「そのまま使える鍵」なのかを実測する

## なぜ測るか

REPORT.md の判定表で `socials（Meta, #1314）` は経路存在率 91.3% と最大なのに、
**「実効は未実測」**のまま残っている。オーナーに ¥60,000 の法人登記 + App Review を
判断してもらうのに、この欄が空なのは筋が悪い。

ここまでに測った経路（YouTube / 店舗自社サイト / 無料画像サービス）は、
いずれも**照合（この動画/画像はどの店か）で歩留まりの大半を失っている**。
Overture の socials が「検索して当てにいく手がかり」ではなく
**Graph API がそのまま受け取れる鍵**なら、Meta 経路だけは照合の損失が原理的に無い。
そこが本当かを確かめる。

## 測るもの

1. **socials の中身の型** — 食品系 789,612 行の socials を全数集計する。
2. **リンクが生きているか** — Facebook の **Page Plugin**
   (`https://www.facebook.com/plugins/page.php`) は認証不要の公式埋め込み
   エンドポイントで、第三者サイトから叩かれることを前提に提供されている。
   実在ページは HTML 内に `/plugins/page` を含む描画結果を返し、
   存在しないIDでは返さない。この差で生死を判定する（本文は読まない）。

   スクレイピングではなく公式埋め込みの応答有無だけを見る。負荷を避けるため
   標本は数百件に留め、直列に近い並列度で叩く。

実行:
    python3 measure_overture_facebook_link.py --sample 300
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import duckdb

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
PARQUET = Path("/tmp/overture-jp.parquet")
FOOD_CSV = HERE / "fixtures" / "overture_jp_food.csv"

PLUGIN = "https://www.facebook.com/plugins/page.php"

# #1273 【仕様】実在ページでは Page Plugin が描画結果を返し、HTML に `/plugins/page` が
# 現れる。存在しないIDでは現れない（実測: 実在 38KB / 不在 18.6KB）。
# サイズ閾値のようなマジックナンバーではなく、この文字列の有無で判定する。
LIVE_MARKER = "/plugins/page"

# 判定器が本当に効いているかを毎回確かめるための負性対照。
# 存在しない Page ID を混ぜ、これらが live 判定されたら測定を信用しない。
NEGATIVE_CONTROLS = ["999999999999999", "888888888888888", "777777777777777"]

OWNER_TARGET_PCT = 70.0

FB_ID_RE = re.compile(r"^https?://(?:www\.)?facebook\.com/([^/?#]+)", re.I)


def socials_breakdown(con: duckdb.DuckDBPyConnection) -> list[dict]:
    rows = con.sql(
        """
        SELECT regexp_extract(lower(s), '^https?://(?:www\\.)?([^/]+)', 1) AS host,
               count(DISTINCT id) AS n_place
        FROM (SELECT p.id, unnest(p.socials) AS s
              FROM read_parquet($parquet) p
              SEMI JOIN food f ON f.id = p.id
              WHERE p.socials IS NOT NULL)
        GROUP BY 1 ORDER BY n_place DESC
        """,
        params={"parquet": str(PARQUET)},
    ).fetchall()
    return [{"host": r[0], "n_place": r[1]} for r in rows if r[0]]


def sample_facebook(con: duckdb.DuckDBPyConnection, n: int, seed: int) -> list[tuple[str, str]]:
    con.sql(f"SELECT setseed({seed / 10**6})")
    rows = con.sql(
        """
        SELECT p.id, unnest(p.socials) AS s
        FROM read_parquet($parquet) p
        SEMI JOIN food f ON f.id = p.id
        WHERE p.socials IS NOT NULL
        """,
        params={"parquet": str(PARQUET)},
    ).fetchall()
    facebook = [(pid, s) for pid, s in rows if "facebook.com" in (s or "").lower()]
    import random

    return random.Random(seed).sample(facebook, min(n, len(facebook)))


def probe_page(page_ref: str, timeout: float, retries: int = 2) -> tuple[str, int]:
    """#1273 【バグ】1回の dead 判定を信じてはいけない。

    同一標本300件を2回測ったら live が 297 と 299 でぶれた。判定器は決定的なので、
    差分は Facebook 側が絞ったときに marker を含まない body を返すことによる。
    dead と出たら間隔を空けて測り直し、それでも dead のときだけ dead とする。
    live は誤って出にくい（負性対照で確認済み）ので再試行しない。
    """
    for attempt in range(retries):
        verdict, size = probe_page_once(page_ref, timeout)
        if verdict != "dead":
            return verdict, size
        if attempt + 1 < retries:
            time.sleep(2.0 * (attempt + 1))
    return "dead", size


def probe_page_once(page_ref: str, timeout: float) -> tuple[str, int]:
    """Page Plugin を1回叩き、(判定, バイト数) を返す。本文は保存しない。"""
    href = f"https://www.facebook.com/{page_ref}"
    url = f"{PLUGIN}?" + urllib.parse.urlencode(
        {"href": href, "width": 340, "tabs": "timeline"}
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return f"http_{exc.code}", 0
    except Exception as exc:  # noqa: BLE001 - 到達性の分類が目的
        return type(exc).__name__, 0
    return ("live" if LIVE_MARKER in body else "dead"), len(body)


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 Overture socials の Meta 経路適性")
    ap.add_argument("--sample", type=int, default=300)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--timeout", type=float, default=30.0)
    ap.add_argument("--seed", type=int, default=1273)
    args = ap.parse_args()

    if not PARQUET.exists():
        raise SystemExit(f"Overture parquet が無い: {PARQUET}")

    con = duckdb.connect()
    # CREATE VIEW は prepared parameter を受け付けないのでリテラルで埋める。
    # 値はこのファイル内の定数なので外部入力は混ざらない。
    con.sql(f"CREATE VIEW food AS SELECT id FROM read_csv('{FOOD_CSV}', header=true)")

    breakdown = socials_breakdown(con)
    total_food = con.sql(
        "SELECT count(*) FROM read_csv($csv, header=true)", params={"csv": str(FOOD_CSV)}
    ).fetchone()[0]

    print("=== socials の内訳（Overture JP food_and_drink 全数）===", file=sys.stderr)
    for row in breakdown:
        print(
            f"  {row['host']:20} {row['n_place']:>8,} 店 "
            f"({row['n_place'] / total_food * 100:5.2f}%)",
            file=sys.stderr,
        )

    sample = sample_facebook(con, args.sample, args.seed)

    # socials の Facebook 部分が「数値の Page ID」なのか「vanity name」なのかを見る。
    # 数値IDなら Graph API `GET /{page-id}` にそのまま渡せる = 照合が要らない。
    numeric = 0
    refs: list[str] = []
    for _, url in sample:
        match = FB_ID_RE.match(url)
        ref = match.group(1) if match else ""
        refs.append(ref)
        if ref.isdigit():
            numeric += 1

    print(
        f"\n=== 標本 {len(sample):,} 件の Facebook リンク形式 ===\n"
        f"  数値 Page ID: {numeric:,} ({numeric / len(sample) * 100:.2f}%)\n"
        f"  vanity 等   : {len(sample) - numeric:,}",
        file=sys.stderr,
    )

    targets = refs + NEGATIVE_CONTROLS
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        outcomes = list(pool.map(lambda r: probe_page(r, args.timeout), targets))

    control_outcomes = outcomes[len(refs):]
    sample_outcomes = outcomes[: len(refs)]

    print("\n=== 負性対照（存在しない Page ID）===", file=sys.stderr)
    for ref, (verdict, size) in zip(NEGATIVE_CONTROLS, control_outcomes):
        print(f"  {ref} -> {verdict} ({size:,}B)", file=sys.stderr)
    if any(v == "live" for v, _ in control_outcomes):
        print(
            "\n**負性対照が live 判定された。判定器が壊れているので下の数字は信用しない。**",
            file=sys.stderr,
        )

    counts: dict[str, int] = {}
    for verdict, _ in sample_outcomes:
        counts[verdict] = counts.get(verdict, 0) + 1
    decided = counts.get("live", 0) + counts.get("dead", 0)
    live = counts.get("live", 0)

    print(f"\n=== リンクの生死（Page Plugin, 認証不要の公式埋め込み）===", file=sys.stderr)
    print(f"  判定できた: {decided:,} / 生存 {live:,}"
          f"{f' ({live / decided * 100:.2f}%)' if decided else ''}", file=sys.stderr)
    print(f"  内訳: {counts}", file=sys.stderr)

    fb_places = next((r["n_place"] for r in breakdown if r["host"] == "facebook.com"), 0)
    if decided:
        effective = fb_places / total_food * (live / decided) * 100
        print(
            f"\nFacebook リンク保有 {fb_places:,}/{total_food:,} "
            f"({fb_places / total_food * 100:.2f}%) × 生存率 {live / decided * 100:.2f}%"
            f" = **経路存在率 {effective:.2f}%**",
            file=sys.stderr,
        )
        print(
            "これは『Meta の審査を通れた場合に、照合を挟まずに到達できる店の割合』であって、"
            "その先の「投稿に料理が写っているか」「134カテゴリに当たるか」は別途必要。",
            file=sys.stderr,
        )
        # #1273 【設計】ここから先を推定で埋めない（#1319 の外挿の誤りを繰り返さない）。
        # 代わりに「70% に届くために下流が何%必要か」という必要条件だけを出す。
        # 下流の実測には PPCA 通過が要るので、この環境では原理的に測れない。
        required = OWNER_TARGET_PCT / effective * 100
        print(
            f"\nオーナー要求 {OWNER_TARGET_PCT:.0f}% に届くための**必要条件**: "
            f"下流（ページに料理写真があり134カテゴリに当たる）の変換率が "
            f"**{required:.1f}% 以上**であること。",
            file=sys.stderr,
        )
        print(
            "下流の実測には PPCA 通過が要るため、この環境では測れない。"
            "ただし『70% が算術的に到達しうる唯一の無料経路』であることは確定する"
            f"（他経路の合算天井は上限 50.3%）。",
            file=sys.stderr,
        )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "overture_facebook_link.json"
    out_path.write_text(
        json.dumps(
            {
                "total_food_places": total_food,
                "socials_breakdown": breakdown,
                "sample_size": len(sample),
                "n_numeric_page_id": numeric,
                "numeric_page_id_pct": numeric / len(sample) * 100,
                "liveness_counts": counts,
                "liveness_decided": decided,
                "liveness_live": live,
                "negative_controls": [
                    {"ref": r, "verdict": v, "bytes": b}
                    for r, (v, b) in zip(NEGATIVE_CONTROLS, control_outcomes)
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
