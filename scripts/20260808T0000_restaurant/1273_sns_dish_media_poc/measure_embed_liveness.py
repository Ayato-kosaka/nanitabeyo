#!/usr/bin/env python3
"""#1273 §39 埋め込みの死活監視（embed_survival）を、無料の公式エンドポイントだけで実装・実測する

## なにが必要か

`dish_media_external_embeddings` には既に availability_status
('available'/'unavailable'/'deleted'/'private'/'ineligible') と
last_verified_at があり、index も `(availability_status, last_verified_at DESC)` が
張ってある（20260812T0100:73）。**入れ物はある。中身を更新する手段が無い。**
①が生む dish_media は自社GCSに実体を持たないので、元動画が消えたら404の穴になる。

## 判定手段

YouTube の公式 oEmbed エンドポイントを使う。

    https://www.youtube.com/oembed?url=...&format=json

- APIキー不要・無料・レート制限の明示なし
- rights_basis='official_oembed' と同じ公式経路なので、監視のために
  非公式なスクレイピングを増やさずに済む（#1313/#1318 の ToS 論点を悪化させない）

実測した戻り値の対応は下の PROBE_CODE_MAP を参照。

## 「7日後・30日後の生存率」をどう測るか

クロールは本セッション中に行ったので、経過時間で 7d/30d を測ることはできない。
代わりに **チャンネル内での新しい順の順位（rank）を年代の代理変数**として使う。
yt-dlp の /videos タブ列挙は新しい順に返るため、rank が大きいほど古い動画になる。
古い動画ほど死んでいるなら、それが hazard（時間経過で死ぬ率）の証拠になる。

代理変数が本当に年代を表しているかは、生存している動画の upload_date を
デシルごとに取得して単調性を確認する（--validate-age）。これをやらずに
rank を年代だと言い張るのは、以前 #1319 でやった外挿の誤りと同じ轍になる。

実行:
    python3 measure_embed_liveness.py --per-decile 40
    python3 measure_embed_liveness.py --per-decile 40 --validate-age 4
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

OEMBED = "https://www.youtube.com/oembed"

# #1273 §39 【仕様】oEmbed の HTTP status を availability_status へ写す。
# 401/403 は「動画は在るが公開されていない」= private。
# 404 は削除済み。400 は ID そのものが不正（クロール側の壊れたIDなので ineligible 扱い）。
# それ以外の 5xx / タイムアウトは **判定不能** であって「消えた」ではない。
# ここを取り違えて 5xx を deleted に落とすと、YouTube 側の一時障害で
# 生きている dish_media を一斉に消すことになる。unknown は状態を変えない。
PROBE_CODE_MAP = {
    200: "available",
    400: "ineligible",
    401: "private",
    403: "private",
    404: "deleted",
}

DECILES = 10


@dataclass
class Probe:
    video_id: str
    channel_id: str
    rank: int
    rank_pct: float
    decile: int
    title: str
    status: str = "unknown"
    http_code: int | None = None
    upload_date: str | None = None


@dataclass
class Decile:
    index: int
    probes: list[Probe] = field(default_factory=list)

    @property
    def alive(self) -> int:
        return sum(1 for p in self.probes if p.status == "available")

    @property
    def decided(self) -> int:
        return sum(1 for p in self.probes if p.status != "unknown")

    @property
    def survival(self) -> float | None:
        return self.alive / self.decided if self.decided else None


def load_population() -> list[Probe]:
    """クロール結果を (channel, rank) 付きで平坦化する。

    rank はチャンネル内の列挙順そのもの。yt-dlp の /videos タブは新しい順に返すので、
    rank が大きいほど古い。rank_pct はチャンネルの動画本数で正規化した位置。
    """
    state_path = OUT_DIR / "snowball_crawl_state.json"
    if not state_path.exists():
        raise SystemExit(f"①のクロール結果が無い: {state_path}")
    state = json.loads(state_path.read_text(encoding="utf-8"))

    population: list[Probe] = []
    for channel_id, channel in state["channels"].items():
        videos = channel.get("videos") or []
        total = len(videos)
        if total < DECILES:
            # 本数が少ないチャンネルはデシルが潰れるので母集団から外す。
            continue
        for rank, video in enumerate(videos):
            vid = video.get("id")
            if not vid:
                continue
            rank_pct = rank / (total - 1)
            population.append(
                Probe(
                    video_id=vid,
                    channel_id=channel_id,
                    rank=rank,
                    rank_pct=rank_pct,
                    decile=min(int(rank_pct * DECILES), DECILES - 1),
                    title=video.get("title") or "",
                )
            )
    return population


def probe_one(probe: Probe, timeout: float) -> Probe:
    url = f"{OEMBED}?" + urllib.parse.urlencode(
        {"url": f"https://www.youtube.com/watch?v={probe.video_id}", "format": "json"}
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            probe.http_code = resp.status
            probe.status = PROBE_CODE_MAP.get(resp.status, "unknown")
    except urllib.error.HTTPError as exc:
        probe.http_code = exc.code
        # 未知のコードを勝手に deleted にしない。unknown のままにする。
        probe.status = PROBE_CODE_MAP.get(exc.code, "unknown")
    except Exception:
        probe.status = "unknown"
    return probe


def fetch_upload_date(video_id: str) -> str | None:
    """rank が年代の代理として妥当かを確かめるためだけに使う（本番監視では呼ばない）。"""
    try:
        out = subprocess.run(
            [
                "yt-dlp",
                "--skip-download",
                "--print",
                "%(upload_date)s",
                "--extractor-args",
                "youtube:player_client=android_vr",
                "--ignore-no-formats-error",
                f"https://www.youtube.com/watch?v={video_id}",
            ],
            capture_output=True,
            text=True,
            timeout=90,
        )
    except subprocess.TimeoutExpired:
        return None
    value = out.stdout.strip().splitlines()
    if not value or not value[-1].isdigit():
        return None
    return value[-1]


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 §39 埋め込み死活監視の実測")
    ap.add_argument("--per-decile", type=int, default=40)
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--timeout", type=float, default=15.0)
    ap.add_argument(
        "--validate-age",
        type=int,
        default=0,
        help="デシルごとに何件 upload_date を取って rank↔年代の相関を確かめるか",
    )
    ap.add_argument("--seed", type=int, default=1273)
    args = ap.parse_args()

    population = load_population()
    by_decile: dict[int, list[Probe]] = {i: [] for i in range(DECILES)}
    for probe in population:
        by_decile[probe.decile].append(probe)

    rng = random.Random(args.seed)
    sample: list[Probe] = []
    for index in range(DECILES):
        bucket = by_decile[index]
        sample.extend(rng.sample(bucket, min(args.per_decile, len(bucket))))

    print(
        f"母集団 {len(population):,} 本 / 抽出 {len(sample):,} 本"
        f"（デシル {DECILES} × {args.per_decile}）",
        file=sys.stderr,
    )

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        sample = list(pool.map(lambda p: probe_one(p, args.timeout), sample))

    deciles = [Decile(i) for i in range(DECILES)]
    for probe in sample:
        deciles[probe.decile].probes.append(probe)

    if args.validate_age:
        targets = []
        for decile in deciles:
            alive = [p for p in decile.probes if p.status == "available"]
            targets.extend(rng.sample(alive, min(args.validate_age, len(alive))))
        with ThreadPoolExecutor(max_workers=6) as pool:
            dates = list(pool.map(lambda p: fetch_upload_date(p.video_id), targets))
        for probe, date in zip(targets, dates):
            probe.upload_date = date

    print("\n=== #1273 §39 埋め込み生存率（YouTube公式oEmbed / 無料） ===", file=sys.stderr)
    print("decile  新→古   判定  生存  生存率   upload_date中央値", file=sys.stderr)
    medians: list[tuple[int, float]] = []
    for decile in deciles:
        dated = sorted(p.upload_date for p in decile.probes if p.upload_date)
        median = statistics.median_low(dated) if dated else None
        if median:
            medians.append((decile.index, float(median)))
        survival = decile.survival
        rate = f"{survival * 100:.1f}%" if survival is not None else "n/a"
        print(
            f"  {decile.index:>2}   {decile.index * 10:>3}-{decile.index * 10 + 10:>3}%"
            f"  {decile.decided:>4}  {decile.alive:>4}  {rate:>6}"
            f"   {median or '-'}",
            file=sys.stderr,
        )

    decided = sum(d.decided for d in deciles)
    alive = sum(d.alive for d in deciles)
    unknown = len(sample) - decided
    print(
        f"\n合計: 判定 {decided:,} / 生存 {alive:,} "
        f"({alive / decided * 100:.2f}%) / 判定不能 {unknown:,}",
        file=sys.stderr,
    )

    breakdown: dict[str, int] = {}
    codes: dict[int | None, int] = {}
    for probe in sample:
        breakdown[probe.status] = breakdown.get(probe.status, 0) + 1
        codes[probe.http_code] = codes.get(probe.http_code, 0) + 1
    print(f"内訳: {breakdown}", file=sys.stderr)
    print(f"HTTP: {codes}", file=sys.stderr)

    if len(medians) >= 3:
        # rank が古さの代理になっているか。デシル順と upload_date 順が
        # 逆相関（rankが大きいほど日付が小さい）していれば妥当。
        xs = [m[0] for m in medians]
        ys = [m[1] for m in medians]
        mx, my = statistics.fmean(xs), statistics.fmean(ys)
        num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        den = (
            sum((x - mx) ** 2 for x in xs) ** 0.5
            * sum((y - my) ** 2 for y in ys) ** 0.5
        )
        corr = num / den if den else 0.0
        print(
            f"\nrank↔upload_date の相関: r={corr:+.3f}"
            f"（負なら rank が大きいほど古い＝代理変数として妥当）",
            file=sys.stderr,
        )

    out_path = OUT_DIR / "embed_liveness.json"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(
            {
                "population": len(population),
                "sample": len(sample),
                "decided": decided,
                "alive": alive,
                "unknown": unknown,
                "breakdown": breakdown,
                "http_codes": {str(k): v for k, v in codes.items()},
                "deciles": [
                    {
                        "decile": d.index,
                        "decided": d.decided,
                        "alive": d.alive,
                        "survival": d.survival,
                    }
                    for d in deciles
                ],
                "probes": [
                    {
                        "video_id": p.video_id,
                        "decile": p.decile,
                        "status": p.status,
                        "http_code": p.http_code,
                        "upload_date": p.upload_date,
                    }
                    for p in sample
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
