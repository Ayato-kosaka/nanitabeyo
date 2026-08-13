#!/usr/bin/env python3
"""#1279 供給上限 S の実測（#1273 Round3）

S = 「YouTube上に、その店舗を識別可能な形で名指しした動画が1本以上存在する店舗の割合」。
Route Bのカバレッジは coverage = S x R_eff に分解でき R_eff<=1 なので coverage<=S。
つまり S は、こちらのパイプライン性能をいくら上げても超えられない天井であり、
60%目標の可否をほぼ単独で決める数字。

母集団は #843 が用意する Overture Places JP food_and_drink (789,612件) を使う。
現行の public.restaurants (103,528件) は bulk-import 済みの一部にすぎず、
母集団として使うと S を過大評価する（既にGoogle Placesに載っている＝相対的に著名な店に偏るため）。

yt-dlp（非公式スクレイピング、#1283でオーナーがToSグレーゾーンを許容済み）で
`ytsearch{depth}:"{店名} {市区町村}"` を投げ、返ってきた動画のタイトル/チャンネル名に
店名が出現するかを判定する。動画バイナリは取得せず、メタデータのみ扱う。

実行:
    python3 measure_supply_ceiling.py --sample-size 400 --out out/supply_ceiling.json
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
import math
import re
import subprocess
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
OVERTURE_CSV = FIXTURES / "overture_jp_food.csv"

YT_DLP = Path("/tmp/yt-dlp-latest")  # #1283 【設計】standalone実行ファイルを使う(環境同梱版は古く壊れている)

# #1283 【実測】約1,000クエリ/15分を超えるとソフトなレート制限(403)が8〜16%でプラトーする。
# 本スクリプトは数百クエリ規模なので並列4で安全域に収める。
DEFAULT_CONCURRENCY = 4
DEFAULT_DEPTH = 5  # 店名という強いクエリなので、上位5件に出ないなら深掘りしても拾えない
DEFAULT_SAMPLE_SIZE = 400

# #1279 【設計】地域格差(#1273 §37)を同時に測るため、1km セルの店舗数で3層に層化する。
DENSITY_TIERS = [("urban", 50), ("suburban", 10), ("rural", 0)]  # (名前, セル店舗数の下限)

# #1279 【仕様】短い店名は誤マッチ(false positive)でSを過大評価するため、
# タイトル部分一致を認める最小文字数。2文字の「一休」等は地名corroborationを要求する。
MIN_NAME_LEN_FOR_SUBSTRING = 3

GENERIC_NAME_TOKENS = ("店", "本店", "支店", "食堂", "カフェ", "レストラン")


# ---------------------------------------------------------------------------
# 名寄せ用の正規化
# ---------------------------------------------------------------------------


def normalize(text: str) -> str:
    """全角/半角・大文字小文字・空白・記号を落として比較用の正規形にする。

    店名は媒体によって「麺屋　武蔵」「麺屋武蔵」「麺屋 武蔵」と揺れるため、
    比較の前に空白と記号を除去する。
    """
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).lower()
    return re.sub(r"[\s　\-‐－—–_,.、。・/／\\|｜!！?？\"'“”'']+", "", text)


def core_name(name: str) -> str:
    """括弧内の補足や支店表記を落とした「コア名」。sns_dish_media_poc.py と同じ方針。"""
    core = (name or "").strip()
    for op in ("（", "(", "【", "["):
        idx = core.find(op)
        if idx > 0:
            core = core[:idx]
            break
    return core.strip()


# ---------------------------------------------------------------------------
# サンプリング
# ---------------------------------------------------------------------------


@dataclass
class Restaurant:
    id: str
    name: str
    latitude: float
    longitude: float
    locality: str
    confidence: float
    tier: str


def density_tier_index(rows: list[dict], radius_m: int = 1000) -> dict[tuple[int, int], int]:
    """1kmセルごとの店舗数を数え、層化のための密度インデックスを作る。"""
    dlat = (2 * radius_m) / 111_320
    dlon = (2 * radius_m) / (111_320 * math.cos(math.radians(35.7)))
    counter: collections.Counter = collections.Counter()
    for r in rows:
        counter[(int(r["_lat"] / dlat), int(r["_lon"] / dlon))] += 1
    return counter


def load_and_stratify(sample_size: int) -> tuple[list[Restaurant], dict]:
    """Overture CSVを読み、密度3層に層化してSHA-256の決定的サンプリングを行う。

    決定的サンプリング: 再実行しても同じ標本になるよう、乱数ではなく id のハッシュ順で選ぶ。
    """
    if not OVERTURE_CSV.exists():
        raise SystemExit(f"fixture not found: {OVERTURE_CSV}（open_data_pocのparquetから再生成すること）")
    csv.field_size_limit(10**7)
    rows = []
    with OVERTURE_CSV.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            try:
                lat, lon = float(r["latitude"]), float(r["longitude"])
            except (TypeError, ValueError):
                continue
            if not (24 <= lat <= 46 and 122 <= lon <= 154):
                continue
            if not (r.get("name") or "").strip():
                continue
            r["_lat"], r["_lon"] = lat, lon
            rows.append(r)

    dlat = 2000 / 111_320
    dlon = 2000 / (111_320 * math.cos(math.radians(35.7)))
    counter = density_tier_index(rows)

    def tier_of(r: dict) -> str:
        n = counter[(int(r["_lat"] / dlat), int(r["_lon"] / dlon))]
        for name, lo in DENSITY_TIERS:
            if n >= lo:
                return name
        return "rural"

    buckets: dict[str, list[dict]] = collections.defaultdict(list)
    for r in rows:
        buckets[tier_of(r)].append(r)

    population = {k: len(v) for k, v in buckets.items()}
    per_tier = max(1, sample_size // len(DENSITY_TIERS))
    sample: list[Restaurant] = []
    for tier, _ in DENSITY_TIERS:
        pool = buckets.get(tier, [])
        pool.sort(key=lambda r: hashlib.sha256(r["id"].encode()).hexdigest())
        for r in pool[:per_tier]:
            sample.append(
                Restaurant(
                    id=r["id"],
                    name=r["name"].strip(),
                    latitude=r["_lat"],
                    longitude=r["_lon"],
                    locality=(r.get("locality") or "").strip(),
                    confidence=float(r["confidence"]) if r.get("confidence") else 0.0,
                    tier=tier,
                )
            )
    return sample, {"population_by_tier": population, "population_total": len(rows)}


# ---------------------------------------------------------------------------
# YouTube 検索と判定
# ---------------------------------------------------------------------------


def yt_search(query: str, depth: int, timeout: int = 90) -> tuple[list[dict], str | None]:
    """yt-dlpのflat-playlistでytsearchを1回投げる。動画バイナリは取得しない。

    戻り値: (entries, error)。403等の失敗時は entries=[] と error文字列を返し、例外は投げない。
    """
    cmd = [sys.executable, str(YT_DLP), "--flat-playlist", "-J", "--no-warnings",
           f"ytsearch{depth}:{query}"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return [], "timeout"
    if not proc.stdout.strip():
        return [], (proc.stderr.strip().splitlines()[-1][:200] if proc.stderr.strip() else "empty")
    try:
        data = json.loads(proc.stdout.splitlines()[-1])
    except json.JSONDecodeError:
        return [], "json_decode_error"
    entries = [e for e in (data.get("entries") or []) if e]
    err = None
    if not entries and proc.stderr.strip():
        err = proc.stderr.strip().splitlines()[-1][:200]
    return entries, err


def judge(rest: Restaurant, entries: list[dict]) -> dict:
    """返ってきた動画のうち、その店舗を識別可能な形で名指ししたものがあるかを判定する。

    保守的に測る（Sの過大評価を避ける）:
      - 判定材料はタイトルとチャンネル名。flat-playlistの概要欄は末尾が切り詰められるため
        主根拠には使わず、参考シグナルとしてのみ記録する。
      - 3文字未満のコア名は、市区町村名が同じ動画に出現している場合のみ一致とみなす。
    したがって得られるのはSの下限側の推定値。
    """
    nm = normalize(rest.name)
    core = normalize(core_name(rest.name))
    loc = normalize(rest.locality)
    # 「〇〇店」だけのような一般語しか残らないコア名は誤マッチ源なので使わない
    if core and core in {normalize(t) for t in GENERIC_NAME_TOKENS}:
        core = ""

    best = None
    for e in entries:
        title = normalize(e.get("title") or "")
        channel = normalize(e.get("channel") or e.get("uploader") or "")
        desc = normalize(e.get("description") or "")
        for needle, kind in ((nm, "full_name"), (core, "core_name")):
            if not needle:
                continue
            short = len(needle) < MIN_NAME_LEN_FOR_SUBSTRING
            for field, fname, conf in ((title, "title", 1.0), (channel, "channel", 0.9)):
                if needle and needle in field:
                    # 短い店名は地名の裏取りが取れたときだけ採用する
                    if short and not (loc and (loc in title or loc in desc)):
                        continue
                    cand = {
                        "video_id": e.get("id"),
                        "title": e.get("title"),
                        "channel": e.get("channel") or e.get("uploader"),
                        "evidence": f"{kind}_in_{fname}",
                        "confidence": conf,
                        "short_name_corroborated_by_locality": bool(short),
                    }
                    if best is None or cand["confidence"] > best["confidence"]:
                        best = cand
    return {
        "hit": best is not None,
        "best_match": best,
        "n_results": len(entries),
        # 概要欄一致は参考のみ（切り詰めのため信頼できない）
        "desc_only_signal": any(
            nm and nm in normalize(e.get("description") or "") for e in entries
        ) and best is None,
    }


def wilson_interval(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """二項比率のWilson信頼区間。標本数が数百なので正規近似より妥当。"""
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - m) / d, (c + m) / d)


def main() -> None:
    ap = argparse.ArgumentParser(description="#1279 supply ceiling S measurement")
    ap.add_argument("--sample-size", type=int, default=DEFAULT_SAMPLE_SIZE)
    ap.add_argument("--depth", type=int, default=DEFAULT_DEPTH)
    ap.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    ap.add_argument("--out", type=Path, default=HERE / "out" / "supply_ceiling.json")
    args = ap.parse_args()

    if not YT_DLP.exists():
        raise SystemExit(f"yt-dlp not found at {YT_DLP}")

    sample, pop = load_and_stratify(args.sample_size)
    print(f"[sample] {len(sample)} restaurants from {pop['population_total']:,} "
          f"(tiers: {pop['population_by_tier']})", file=sys.stderr)

    results: list[dict] = []

    def work(idx_rest: tuple[int, Restaurant]) -> dict:
        i, rest = idx_rest
        query = f"{rest.name} {rest.locality}".strip()
        entries, err = yt_search(query, args.depth)
        verdict = judge(rest, entries)
        if (i + 1) % 25 == 0:
            print(f"  ...{i+1}/{len(sample)}", file=sys.stderr)
        return {"restaurant": asdict(rest), "query": query, "error": err, **verdict}

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        results = list(pool.map(work, enumerate(sample)))

    ok = [r for r in results if r["error"] is None or r["n_results"] > 0]
    errors = [r for r in results if r["error"] is not None and r["n_results"] == 0]
    hits = [r for r in ok if r["hit"]]

    by_tier = {}
    for tier, _ in DENSITY_TIERS:
        t_ok = [r for r in ok if r["restaurant"]["tier"] == tier]
        t_hit = [r for r in t_ok if r["hit"]]
        lo, hi = wilson_interval(len(t_hit), len(t_ok))
        by_tier[tier] = {
            "n_evaluated": len(t_ok),
            "n_hit": len(t_hit),
            "s_hat": len(t_hit) / len(t_ok) if t_ok else None,
            "ci95": [lo, hi],
            "population": pop["population_by_tier"].get(tier, 0),
        }

    # 層化標本なので、全国推定は母集団比で重み付けし直す
    total_pop = sum(v["population"] for v in by_tier.values())
    s_national = sum(
        v["s_hat"] * v["population"] / total_pop for v in by_tier.values() if v["s_hat"] is not None
    ) if total_pop else None

    lo, hi = wilson_interval(len(hits), len(ok))
    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "population": "Overture Places JP food_and_drink (release 2026-07-22.0)",
            "sampling": "SHA-256 deterministic, stratified by 2km-cell density tier",
            "search": f"yt-dlp ytsearch{args.depth}, flat-playlist, query='{{name}} {{locality}}'",
            "judgement": "restaurant name (or core name) appears in video title or channel name",
            "bias": "保守的（タイトル/チャンネル名のみを主根拠にするためSの下限側推定）",
        },
        "population": pop,
        "sample_size": len(sample),
        "n_evaluated": len(ok),
        "n_errors": len(errors),
        "s_hat_unweighted": len(hits) / len(ok) if ok else None,
        "s_hat_ci95_unweighted": [lo, hi],
        "s_hat_national_reweighted": s_national,
        "by_tier": by_tier,
        "evidence_breakdown": dict(
            collections.Counter(r["best_match"]["evidence"] for r in hits if r["best_match"])
        ),
        "results": results,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n=== S (supply ceiling) ===", file=sys.stderr)
    print(f"evaluated {len(ok)} / {len(sample)} (errors {len(errors)})", file=sys.stderr)
    print(f"S_hat (unweighted) = {out['s_hat_unweighted']:.1%} "
          f"[95%CI {lo:.1%}-{hi:.1%}]", file=sys.stderr)
    if s_national is not None:
        print(f"S_hat (national reweighted) = {s_national:.1%}", file=sys.stderr)
    for tier, v in by_tier.items():
        if v["s_hat"] is not None:
            print(f"  {tier:9s} n={v['n_evaluated']:3d} S={v['s_hat']:.1%} "
                  f"[{v['ci95'][0]:.1%}-{v['ci95'][1]:.1%}] pop={v['population']:,}", file=sys.stderr)
    print(f"Saved: {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
