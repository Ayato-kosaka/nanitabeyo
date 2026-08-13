#!/usr/bin/env python3
"""#1273 Round4: 全ソース合算のカバレッジ天井（70%目標の可否）

YouTube単独の天井が約2割と確定したため、他の無料ソースを足して70%に届くかを見る。
重要なのは**同一サンプルで重ね合わせる**こと。ソースごとに別々のサンプルで測ると
重複が分からず、単純加算して過大評価する。ここでは S を測ったのと同じ無作為600店
(`out/supply_ceiling_*.json`)に Overture のフィールドを突き合わせる。

測るのは「そのソースの経路が存在するか」であって「使える料理画像が取れるか」ではない。
したがって得られるのは**上限**であり、実際は各段のfunnelで必ず目減りする。

実行:
    python3 measure_multisource_ceiling.py --supply out/supply_ceiling_2026-08-13.json
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb

HERE = Path(__file__).resolve().parent
OVERTURE_PARQUET = Path("/tmp/overture-jp.parquet")

# #1273 【仕様】ポータル/SNSに飛ぶだけのURLは「店の自社サイト」ではないので分けて数える。
# tabelog/gnavi/hotpepper は #1282 で事業モデル抵触により API 利用を却下済み。
PORTAL_DOMAINS = {
    "tabelog.com", "s.tabelog.com", "r.tabelog.com", "r.gnavi.co.jp", "hotpepper.jp",
    "hitosara.com", "instagram.com", "twitter.com", "facebook.com", "ameblo.jp",
    "localplace.jp", "goo.gl", "linktr.ee",
}
OWN_DOMAIN_MAX_SHARED = 3  # 同一ドメインを共有する店舗数がこれ以下なら「自社サイト」とみなす


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 multi-source coverage ceiling")
    ap.add_argument("--supply", type=Path, default=HERE / "out" / "supply_ceiling_2026-08-13.json")
    ap.add_argument("--out", type=Path, default=HERE / "out" / "multisource_ceiling.json")
    args = ap.parse_args()

    if not OVERTURE_PARQUET.exists():
        raise SystemExit(f"Overture parquet が無い: {OVERTURE_PARQUET}")
    supply = json.loads(args.supply.read_text(encoding="utf-8"))
    rows_in = [r for r in supply["results"] if r["error"] is None]
    yt_raw = {r["restaurant"]["id"]: r["hit"] for r in rows_in}
    tier = {r["restaurant"]["id"]: r["restaurant"]["tier"] for r in rows_in}

    con = duckdb.connect()
    pred = "addresses[1].country='JP' AND list_contains(taxonomy.hierarchy,'food_and_drink')"
    con.execute(f"CREATE TEMP VIEW jp AS SELECT * FROM read_parquet('{OVERTURE_PARQUET}') WHERE {pred}")
    con.execute("CREATE TEMP TABLE s(id VARCHAR)")
    con.executemany("INSERT INTO s VALUES (?)", [(i,) for i in yt_raw])

    # 全体のドメイン頻度（自社サイト判定に使う）
    freq = dict(con.execute(
        "SELECT regexp_extract(websites[1],'https?://(?:www\\.)?([^/]+)',1), count(*) "
        "FROM jp WHERE len(websites)>0 GROUP BY 1"
    ).fetchall())

    rows = con.execute("""
        SELECT j.id, len(j.websites) > 0, len(j.socials) > 0,
               regexp_extract(j.websites[1],'https?://(?:www\\.)?([^/]+)',1)
        FROM jp j JOIN s ON s.id = j.id
    """).fetchall()

    def is_own_site(has_web: bool, dom: str | None) -> bool:
        return bool(has_web and dom and dom not in PORTAL_DOMAINS
                    and freq.get(dom, 0) <= OWN_DOMAIN_MAX_SHARED)

    n = len(rows)
    flags = []
    for rid, has_web, has_soc, dom in rows:
        flags.append({
            "id": rid, "tier": tier.get(rid),
            "youtube": bool(yt_raw.get(rid)),
            "website": bool(has_web),
            "own_site": is_own_site(has_web, dom),
            "socials": bool(has_soc),
        })

    def pct(f) -> tuple[int, float]:
        c = sum(1 for x in flags if f(x))
        return c, 100 * c / n

    singles = {
        "youtube": pct(lambda x: x["youtube"]),
        "website_any": pct(lambda x: x["website"]),
        "website_own_domain": pct(lambda x: x["own_site"]),
        "socials": pct(lambda x: x["socials"]),
    }
    unions = {
        "youtube_or_own_site": pct(lambda x: x["youtube"] or x["own_site"]),
        "youtube_or_website_any": pct(lambda x: x["youtube"] or x["website"]),
        "youtube_or_website_or_socials": pct(lambda x: x["youtube"] or x["website"] or x["socials"]),
    }

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "sample": f"S測定と同一の無作為 {n} 店（Overture母集団から層化抽出）",
            "caveat": "測っているのは『経路が存在するか』であり『使える料理画像が取れるか』ではない。"
                      "したがって上限であり、funnelで必ず目減りする。",
            "own_domain_rule": f"ポータル/SNSドメインを除き、同一ドメイン共有が{OWN_DOMAIN_MAX_SHARED}店以下",
            "youtube_flag": "生判定(店名がタイトル/チャンネル名に出現)。支店確定可能ベースだと更に下がる",
        },
        "n": n,
        "singles": {k: {"count": c, "pct": p} for k, (c, p) in singles.items()},
        "unions": {k: {"count": c, "pct": p, "meets_70": p >= 70.0} for k, (c, p) in unions.items()},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"=== 同一の無作為 {n} 店における各ソースの経路存在率 ===")
    for k, (c, p) in singles.items():
        print(f"  {k:24s} {c:4d}  {p:5.1f}%")
    print(f"\n=== 合算（重複を正しく反映）===")
    for k, (c, p) in unions.items():
        print(f"  {k:32s} {c:4d}  {p:5.1f}%  70%目標: {'達成' if p >= 70 else '未達'}")
    print(f"\nSaved: {args.out}")


if __name__ == "__main__":
    main()
