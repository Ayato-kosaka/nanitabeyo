#!/usr/bin/env python3
"""#1273 チェーン本部サイトは「1サイトで数百〜数千店」に届く。そこを実測する

## なぜ見落としていたか

`own-website-images.py` は「同一ドメインを共有するのが3店以下」を自社サイトとみなし、
**4店以上で共有されるドメインを除外**していた（`OWN_DOMAIN_MAX_SHARED`）。
600店の標本ではチェーンの支店が1〜2件しか入らないので、この規則は妥当に見えていた。

しかし全国で数えると、**4店以上で共有されるドメインが 237,715店（母集団の30.11%）**を
占める。しかも 201店以上のドメインは **159件で 117,596店（14.9%）**。
つまり**除外していた層が、1サイトあたりの到達店舗数が最も大きい層**だった。

チェーンの料理は全支店で同一なので、本部サイトのメニュー写真は
その支店で実際に食べられる料理の写真である。dish_media として妥当性がある。

## 測るもの

ポータル（食べログ/ぐるなび/ホットペッパー等）と SNS を除いた
**本物のチェーン本部サイト**に絞り、既存の抽出器で料理画像が取れるかを実測する。

判定は `own-website-images.py` と同一（`MIN_DISH_IMAGE_PX` と `food_word`）。
基準を変えると過去ラウンドと比較できない。

実行:
    python3 measure_chain_sites.py --top 30
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))

import importlib.util

_spec = importlib.util.spec_from_file_location(
    "own_website_images", Path(__file__).resolve().parent / "own-website-images.py"
)
_owi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_owi)

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
PARQUET = "/tmp/overture-jp.parquet"
FOOD_CSV = HERE / "fixtures" / "overture_jp_food.csv"

MIN_SHARED = 4  # own-website-images.py が「チェーン」として除外していた閾値


def chain_domains(min_stores: int) -> list[dict]:
    con = duckdb.connect()
    con.sql("PRAGMA disable_progress_bar")
    con.sql(f"CREATE VIEW food AS SELECT id FROM read_csv('{FOOD_CSV}', header=true)")
    rows = con.sql(
        f"""
        WITH w AS (
          SELECT p.id, p.websites[1] AS url,
                 regexp_extract(lower(p.websites[1]),'https?://(?:www\\.)?([^/]+)',1) AS dom
          FROM read_parquet('{PARQUET}') p SEMI JOIN food f ON f.id = p.id
          WHERE p.websites IS NOT NULL AND len(p.websites) > 0
        )
        SELECT dom, count(*) n, any_value(url) sample_url
        FROM w WHERE dom <> '' GROUP BY 1 HAVING count(*) >= {min_stores}
        ORDER BY n DESC
        """
    ).fetchall()
    return [{"domain": r[0], "n_stores": r[1], "url": r[2]} for r in rows]


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 チェーン本部サイトの実測")
    ap.add_argument("--per-band", type=int, default=20, help="規模帯ごとに何件実取得するか")
    ap.add_argument("--min-shared", type=int, default=MIN_SHARED)
    args = ap.parse_args()

    domains = chain_domains(args.min_shared)
    total_chain_stores = sum(d["n_stores"] for d in domains)

    # #1273 【仕様】ポータル・SNS は「チェーン本部サイト」ではない。
    # own-website-images.py の PORTAL_RE をそのまま使い、判定基準を揃える。
    real = [d for d in domains if not _owi.PORTAL_RE.search(d["domain"])]
    portal = [d for d in domains if _owi.PORTAL_RE.search(d["domain"])]
    real_stores = sum(d["n_stores"] for d in real)
    portal_stores = sum(d["n_stores"] for d in portal)

    total_food = duckdb.connect().sql(
        f"SELECT count(*) FROM read_csv('{FOOD_CSV}', header=true)"
    ).fetchone()[0]

    print(f"=== {args.min_shared}店以上で共有されるドメイン ===", file=sys.stderr)
    print(f"  全体        : {len(domains):,} ドメイン / {total_chain_stores:,} 店 "
          f"({total_chain_stores / total_food * 100:.2f}%)", file=sys.stderr)
    print(f"  ポータル/SNS : {len(portal):,} ドメイン / {portal_stores:,} 店 "
          f"({portal_stores / total_food * 100:.2f}%) ← 規約上使えない", file=sys.stderr)
    print(f"  **本物のチェーン本部**: {len(real):,} ドメイン / {real_stores:,} 店 "
          f"({real_stores / total_food * 100:.2f}%)", file=sys.stderr)

    # #1273 【設計】上位だけを測ると大手の整ったサイトばかり見ることになり、
    # 下位チェーン（4-10店など）の歩留まりが分からないまま全体に外挿してしまう。
    # 規模帯ごとに決定的抽出（SHA-256順）して、帯別のヒット率を出す。
    bands = [
        ("201+", 201, 10**9),
        ("51-200", 51, 200),
        ("11-50", 11, 50),
        ("4-10", 4, 10),
    ]
    band_of: dict[str, str] = {}
    targets: list[dict] = []
    band_pop: dict[str, dict] = {}
    for label, lo, hi in bands:
        pool = [d for d in real if lo <= d["n_stores"] <= hi]
        band_pop[label] = {
            "n_domains": len(pool),
            "n_stores": sum(d["n_stores"] for d in pool),
        }
        pool.sort(key=lambda d: hashlib.sha256(d["domain"].encode()).hexdigest())
        picked = pool[: args.per_band]
        for d in picked:
            band_of[d["domain"]] = label
        targets.extend(picked)

    print("\n=== 規模帯ごとの母数 ===", file=sys.stderr)
    for label, _, _ in bands:
        p = band_pop[label]
        print(f"  {label:>8}: {p['n_domains']:>6,} ドメイン / {p['n_stores']:>8,} 店 "
              f"({p['n_stores'] / total_food * 100:5.2f}%)", file=sys.stderr)

    print(f"\n=== 各帯 {args.per_band} 件ずつ計 {len(targets)} チェーンを実取得 ===",
          file=sys.stderr)

    results = []
    for i, d in enumerate(targets):
        started = time.time()
        rec = {
            "id": d["domain"], "name": d["domain"], "locality": "", "tier": "chain",
            "website": d["url"], "domain": d["domain"], "is_portal": False,
            "pages": [], "fail_reason": None, "candidates": [], "verified": [],
            "n_verified_dish": 0,
        }
        try:
            out = _owi.process(rec)
        except Exception as exc:  # noqa: BLE001
            out = dict(rec, fail_reason=f"crash:{type(exc).__name__}")
        out["n_stores"] = d["n_stores"]
        results.append(out)
        print(
            f"  [{i + 1:>2}/{len(targets)}] {d['n_stores']:>6,}店 {d['domain'][:30]:32} "
            f"dish={out['n_verified_dish']:<3} {out.get('fail_reason') or 'ok':<24} "
            f"{time.time() - started:.0f}s",
            file=sys.stderr,
        )

    for r in results:
        r["band"] = band_of.get(r["domain"], "?")

    print("\n=== 規模帯別のヒット率 ===", file=sys.stderr)
    print("  帯        測定  ヒット  ドメイン基準  店舗数基準", file=sys.stderr)
    band_rates = {}
    for label, _, _ in bands:
        rows = [r for r in results if r["band"] == label]
        if not rows:
            continue
        h = [r for r in rows if r["n_verified_dish"] >= 1]
        hs = sum(r["n_stores"] for r in h)
        ts = sum(r["n_stores"] for r in rows)
        band_rates[label] = {
            "n_measured": len(rows), "n_hit": len(h),
            "domain_rate": len(h) / len(rows),
            "store_rate": hs / ts if ts else 0.0,
        }
        print(f"  {label:>8}  {len(rows):>4}  {len(h):>5}   {len(h) / len(rows) * 100:>8.1f}%"
              f"   {hs / ts * 100 if ts else 0:>8.1f}%", file=sys.stderr)

    # #1273 【設計】全体の寄与は帯ごとに重み付けして足す。上位30だけで外挿すると
    # 大手の整ったサイトの率を下位帯にも当ててしまい、過大評価になる。
    weighted = 0.0
    for label, _, _ in bands:
        if label in band_rates:
            weighted += band_pop[label]["n_stores"] * band_rates[label]["store_rate"]
    print(f"\n  帯別に重み付けした到達店舗数: {weighted:,.0f} 店 "
          f"= 母集団の {weighted / total_food * 100:.2f}%", file=sys.stderr)
    print(f"  （目視 precision 75.0% を掛けると {weighted * 0.75 / total_food * 100:.2f}%）",
          file=sys.stderr)

    hit = [r for r in results if r["n_verified_dish"] >= 1]
    hit_stores = sum(r["n_stores"] for r in hit)
    target_stores = sum(r["n_stores"] for r in results)
    print(f"\n=== 結果 ===", file=sys.stderr)
    print(f"  料理画像が取れたチェーン: {len(hit)}/{len(results)} "
          f"({len(hit) / len(results) * 100:.1f}%)", file=sys.stderr)
    print(f"  それが代表する店舗数    : {hit_stores:,}/{target_stores:,} "
          f"({hit_stores / target_stores * 100:.1f}%)", file=sys.stderr)

    if results:
        rate = hit_stores / target_stores
        projected = real_stores * rate
        print(
            f"\n  上位{len(targets)}件のヒット率を全 {len(real):,} チェーンに当てはめると、"
            f"**{projected:,.0f} 店 = 母集団の {projected / total_food * 100:.2f}%**",
            file=sys.stderr,
        )
        print(
            "  ※ 上位は大手なのでサイトが整っている。下位ほど落ちるはずで、これは上限側の見積り。",
            file=sys.stderr,
        )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "chain_sites.json"
    out_path.write_text(
        json.dumps(
            {
                "min_shared": args.min_shared,
                "n_domains_all": len(domains),
                "n_stores_all": total_chain_stores,
                "n_domains_portal": len(portal),
                "n_stores_portal": portal_stores,
                "n_domains_real_chain": len(real),
                "n_stores_real_chain": real_stores,
                "total_food_places": total_food,
                "band_population": band_pop,
                "band_rates": band_rates,
                "weighted_reach_stores": weighted,
                "weighted_reach_pct": weighted / total_food * 100,
                "n_fetched": len(results),
                "n_hit": len(hit),
                "hit_stores": hit_stores,
                "target_stores": target_stores,
                "results": [
                    {k: v for k, v in r.items() if k not in ("candidates", "verified")}
                    for r in results
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
