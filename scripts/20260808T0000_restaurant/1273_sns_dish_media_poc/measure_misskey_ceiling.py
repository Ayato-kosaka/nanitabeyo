#!/usr/bin/env python3
"""#1273 Misskey(Fediverse) がリンクに依存しない店名起点の経路として使えるかを実測する

## なぜ

現在地は天井 41.3%。70% に届くには「リンク層を 89.1% までカバー」が要るが、
89% の規模で経路が存在するのは Facebook Page ID だけで、
**Page ID から写真へ到達する無料・無認証の手段は存在しない**ことを実測で確認した
（Page Plugin の応答 38KB を精査したが post permalink 0件 / 画像 0件。
　中身はクライアント側描画で、サーバ応答は JS/CSS のシェルだけ）。

そこで逆側を攻める。**リンク無し層(30.31%)のカバレッジを上げれば、
リンク層に必要な 89.1% が下がる。** 現在リンク無し層は YouTube の 26.0% しかない。

Misskey は日本語圏で規模があり、`POST /api/notes/search` が
**APIキー不要・無料**で 200 を返す（実測）。ここが YouTube に足せるかを測る。

## 測りかた

`measure_seed_youtube_ceiling.py` と**同じ標本・同じ判定思想**で測る。
違う標本や緩い基準で測ると「足せる」かどうかが判断できない。

- 標本: `out/seed_strata_sample.json`（seed をリンク有無で2層化し各150店）
- 判定: 店名が本文に出現し、かつ**画像が添付されている**こと。
  dish_media は媒体が要るので、テキストだけの言及はヒットにしない。
  短い店名は市区町村名の裏取りを必須にする（#1310 で入れた規則と同じ）。

## 権利について

本スクリプトは**経路が存在するかの計測のみ**を行う。実際に表示する場合は
投稿者の権利処理が別途必要で、YouTube の公式 iframe のような
「提供元が用意した埋め込み」に相当するものが Misskey にあるかは未確認。
ここで出る数字は**供給の上限**であって、そのまま使える数ではない。

実行:
    python3 measure_misskey_ceiling.py
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from measure_supply_ceiling import (  # noqa: E402
    MIN_NAME_LEN_FOR_SUBSTRING,
    core_name,
    normalize,
    wilson_interval,
)

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
SEED_CACHE = OUT_DIR / "seed_strata_sample.json"

ENDPOINT = "https://misskey.io/api/notes/search"

# measure_seed_population.py の実測値。
TOTAL_SEEDS = 1_132_482
SEEDS_WITH_OVERTURE = 789_235
SEEDS_WITHOUT_OVERTURE = 343_247
OWNER_TARGET_PCT = 70.0
LINK_ROUTE_CEILING = 0.480
# measure_seed_youtube_ceiling.py の実測（リンク無し層）。
YT_LINKLESS_RATE = 0.260


# #1273 【バグ】並列3で投げたら 300件中 153件が http_429 で落ち、
# 標本の半分が欠測した。欠測したまま率を出すと信用できないので、
# 直列＋間隔＋429時の指数バックオフにする。速度より欠測ゼロを優先する。
_THROTTLE_S = 1.2
_RETRY_ON_429 = 4


def search(query: str, limit: int, timeout: float) -> tuple[list[dict], str | None]:
    for attempt in range(_RETRY_ON_429):
        notes, err = _search_once(query, limit, timeout)
        if err != "http_429":
            return notes, err
        time.sleep(_THROTTLE_S * (2 ** attempt))
    return [], "http_429"


def _search_once(query: str, limit: int, timeout: float) -> tuple[list[dict], str | None]:
    payload = json.dumps({"query": query, "limit": limit}).encode()
    req = urllib.request.Request(
        ENDPOINT,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8", "replace")), None
    except urllib.error.HTTPError as exc:
        return [], f"http_{exc.code}"
    except Exception as exc:  # noqa: BLE001 - 到達性の分類が目的
        return [], type(exc).__name__


def judge_note(name: str, locality: str, notes: list[dict]) -> dict:
    """店名が本文に出現し、かつ画像が添付されている note があるか。

    #1310 で入れた規則をそのまま使う: 短い店名は地名の裏取りが取れたときだけ採用する。
    これを緩めると「Value」「弁当」のような一般語で誤爆する。
    """
    nm = normalize(name)
    core = normalize(core_name(name))
    loc = normalize(locality)

    best = None
    n_with_image = 0
    for note in notes:
        files = note.get("files") or []
        has_image = any((f.get("type") or "").startswith("image") for f in files)
        if has_image:
            n_with_image += 1
        text = normalize(note.get("text") or "")
        for needle, kind in ((nm, "full_name"), (core, "core_name")):
            if not needle or needle not in text:
                continue
            if len(needle) < MIN_NAME_LEN_FOR_SUBSTRING and not (loc and loc in text):
                continue
            if not has_image:
                continue  # dish_media は媒体が要る。テキスト言及だけは採らない。
            cand = {
                "note_id": note.get("id"),
                "evidence": kind,
                "n_files": len(files),
                "short_name_corroborated_by_locality": len(needle) < MIN_NAME_LEN_FOR_SUBSTRING,
            }
            if best is None:
                best = cand
    return {"hit": best is not None, "best_match": best,
            "n_results": len(notes), "n_with_image": n_with_image}


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 Misskey 経路存在率")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--timeout", type=float, default=30.0)
    args = ap.parse_args()

    if not SEED_CACHE.exists():
        raise SystemExit(
            f"seed 標本が無い: {SEED_CACHE}"
            "（measure_seed_youtube_ceiling.py --rebuild で作る）"
        )
    payload = json.loads(SEED_CACHE.read_text(encoding="utf-8"))

    results: dict[str, list[dict]] = {}
    for stratum, items in payload["sample"].items():
        print(f"\n=== {stratum}: {len(items)} 店を Misskey 検索 ===", file=sys.stderr)
        started = time.time()

        def probe(item: dict) -> dict:
            notes, err = search(item["name"], args.limit, args.timeout)
            verdict = judge_note(item["name"], item["locality"], notes)
            return {"seed_id": item["seed_id"], "name": item["name"],
                    "error": err, **verdict}

        # 直列で回す。Misskey 側のレート制限に合わせる。
        rows = []
        for i, item in enumerate(items):
            rows.append(probe(item))
            if i % 25 == 24:
                print(f"    {i + 1}/{len(items)}", file=sys.stderr)
            time.sleep(_THROTTLE_S)
        results[stratum] = rows
        ok = [r for r in results[stratum] if r["error"] is None]
        hit = [r for r in ok if r["hit"]]
        print(
            f"  判定できた {len(ok)}/{len(items)} / ヒット {len(hit)} "
            f"({len(hit) / len(ok) * 100 if ok else 0:.2f}%) / {time.time() - started:.0f}s",
            file=sys.stderr,
        )
        errs: dict[str, int] = {}
        for r in results[stratum]:
            if r["error"]:
                errs[r["error"]] = errs.get(r["error"], 0) + 1
        if errs:
            print(f"  エラー: {errs}", file=sys.stderr)

    summary = {}
    for stratum, rows in results.items():
        ok = [r for r in rows if r["error"] is None]
        hit = [r for r in ok if r["hit"]]
        rate = len(hit) / len(ok) if ok else 0.0
        lo, hi = wilson_interval(len(hit), len(ok)) if ok else (0.0, 0.0)
        summary[stratum] = {"n_ok": len(ok), "n_hit": len(hit), "rate": rate,
                            "wilson_lo": lo, "wilson_hi": hi}

    print("\n=== 層別 Misskey 経路存在率（店名が本文にあり画像添付あり）===", file=sys.stderr)
    for stratum, s in summary.items():
        print(
            f"  {stratum:18} {s['n_hit']:>4}/{s['n_ok']:<4} = {s['rate'] * 100:>6.2f}% "
            f"(95%CI {s['wilson_lo'] * 100:.1f}-{s['wilson_hi'] * 100:.1f}%)",
            file=sys.stderr,
        )

    mk_linkless = summary.get("without_overture", {}).get("rate", 0.0)
    share_link = SEEDS_WITH_OVERTURE / TOTAL_SEEDS
    share_linkless = SEEDS_WITHOUT_OVERTURE / TOTAL_SEEDS

    # #1273 【設計】和集合を実測していないので「YouTube と完全に独立」という
    # **最も甘い仮定**で上限だけ出す。実際は重なるので必ずこれより小さい。
    union_upper = 1 - (1 - YT_LINKLESS_RATE) * (1 - mk_linkless)
    required_before = (OWNER_TARGET_PCT / 100 - YT_LINKLESS_RATE * share_linkless) / share_link
    required_after = (OWNER_TARGET_PCT / 100 - union_upper * share_linkless) / share_link

    print("\n=== リンク無し層に足したときの効き ===", file=sys.stderr)
    print(f"  YouTube 単独            : {YT_LINKLESS_RATE * 100:.2f}%", file=sys.stderr)
    print(f"  + Misskey（独立と仮定・上限）: {union_upper * 100:.2f}%", file=sys.stderr)
    print(
        f"\n  70% に必要なリンク層カバレッジ: "
        f"{required_before * 100:.2f}% -> {required_after * 100:.2f}%"
        f"（{(required_before - required_after) * 100:+.2f}pt）",
        file=sys.stderr,
    )
    print(f"  現在のリンク層は {LINK_ROUTE_CEILING * 100:.1f}%", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "misskey_ceiling.json"
    out_path.write_text(
        json.dumps(
            {
                "endpoint": ENDPOINT,
                "summary": summary,
                "yt_linkless_rate": YT_LINKLESS_RATE,
                "misskey_linkless_rate": mk_linkless,
                "union_upper_linkless": union_upper,
                "required_link_coverage_before_pct": required_before * 100,
                "required_link_coverage_after_pct": required_after * 100,
                "results": results,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
