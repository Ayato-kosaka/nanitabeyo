#!/usr/bin/env python3
"""#1273 Round3 アイデアA: チャンネル逆走査の検証

measure_sweep_saturation.py で「1市区町村に134カテゴリを全部投げても45店しか出ない、
1クエリあたり初出は0.91→0.06まで落ちる」という飽和を実測した。ただしこれが意味するのは
**YouTubeの供給が尽きた**ことではなく、**検索ランキングが尽きた**ことかもしれない。
同じ動画でも「その動画を作ったチャンネルの過去動画を全部列挙する」経路なら、
検索順位に一切縛られずに到達できる。

本スクリプトはその仮説を検証する:
  1. 少数のカテゴリ×エリア検索で「実在店舗を名指しした動画」を出したチャンネルを種として集める
  2. そのチャンネルの過去動画を全列挙する（yt-dlp 1コールで数百件）
  3. 全動画タイトルを全国店名辞書に逆引きし、distinct店舗数を数える
  4. 検索経路（134クエリ/市区町村）とのクエリ効率を比較する

実行:
    python3 measure_channel_traversal.py --seed-queries 40 --max-channels 25
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import re
import subprocess
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import ahocorasick  # type: ignore

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
YT_DLP = Path("/tmp/yt-dlp-latest")

# #1279 【仕様】全国辞書は誤マッチが命取りなので、短い名前とチェーン名を落とす。
# 検索経路の検証(MIN_NAME_LEN=3, locality内)より厳しくしているのは、
# 全国789k件を相手にすると3文字では偶然一致が支配的になるため。
MIN_NAME_LEN_NATIONAL = 4
STOPWORD_NAMES = {
    "食堂", "カフェ", "レストラン", "居酒屋", "喫茶店", "ラーメン", "そば", "うどん",
    "寿司", "すし", "焼肉", "定食", "パン屋", "弁当", "cafe", "bar", "restaurant",
    "コーヒー", "ダイニング", "キッチン", "ビストロ", "食事処", "お食事処",
}

MAX_VIDEOS_PER_CHANNEL = 400  # 巨大チャンネルで時間が爆発しないよう上限を置く


# #1273 【バグ】初版は空白を除去してから全国辞書に部分一致させていたため、ラテン文字の
# 店名が英単語の内部に一致する偽陽性が支配的だった（"form"→perform、"ATER"→water、
# "TOBE"→October、"JA・PAN"→japan 等）。日本語名とラテン名で正規化とマッチ規則を分ける。
CJK_RE = re.compile(r"[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]")
MIN_NAME_LEN_LATIN = 5  # ラテン名は語境界を課した上でさらに長さを要求する


def has_cjk(text: str) -> bool:
    return bool(CJK_RE.search(text))


def normalize_ja(text: str) -> str:
    """日本語向け: 語境界が存在しないので空白と記号を全部落とす。"""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).lower()
    return re.sub(r"[\s　\-‐－—–_,.、。・/／\\|｜!！?？\"'“”'']+", "", text)


def normalize_latin(text: str) -> str:
    """ラテン文字向け: 語境界を残すため、英数字以外は単一の空白に潰す。"""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).lower()
    return " " + re.sub(r"[^0-9a-z]+", " ", text).strip() + " "


def normalize(text: str) -> str:
    """後方互換用（既存の呼び出し元が使う日本語向け正規化）。"""
    return normalize_ja(text)


class NameMatcher:
    """全国店名の逆引き。日本語名とラテン名で別のオートマトンと別の一致規則を持つ。

    #1273 §23 に従い、同名が2件以上ある名前（チェーン）は支店を確定できないため除外する。
    ラテン名は語境界を要求するため、英単語の内部に一致する偽陽性が出ない。
    """

    def __init__(self) -> None:
        csv.field_size_limit(10**7)
        freq_ja: collections.Counter = collections.Counter()
        freq_la: collections.Counter = collections.Counter()
        self.original: dict[str, str] = {}
        # #1273 §22 【設計】地名の裏取りに使う。名前が一意な行しか辞書に残さないので1対1で持てる。
        self.area: dict[str, tuple[str, str]] = {}
        rows = 0
        with (FIXTURES / "overture_jp_food.csv").open(encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                name = (r.get("name") or "").strip()
                if not name:
                    continue
                rows += 1
                if has_cjk(name):
                    key = normalize_ja(name)
                    freq_ja[key] += 1
                else:
                    key = normalize_latin(name).strip()
                    freq_la[key] += 1
                self.original.setdefault(key, name)
                self.area.setdefault(key, (normalize_ja(r.get("locality") or ""),
                                           normalize_ja(r.get("region") or "")))

        stop_ja = {normalize_ja(s) for s in STOPWORD_NAMES}
        stop_la = {normalize_latin(s).strip() for s in STOPWORD_NAMES}
        self.auto_ja = ahocorasick.Automaton()
        self.auto_la = ahocorasick.Automaton()
        self.n_ja = self.n_la = 0
        for key, count in freq_ja.items():
            if len(key) < MIN_NAME_LEN_NATIONAL or count > 1 or key in stop_ja:
                continue
            self.auto_ja.add_word(key, key)
            self.n_ja += 1
        for key, count in freq_la.items():
            if len(key) < MIN_NAME_LEN_LATIN or count > 1 or key in stop_la:
                continue
            self.auto_la.add_word(key, key)
            self.n_la += 1
        self.auto_ja.make_automaton()
        self.auto_la.make_automaton()
        self.rows = rows
        print(f"[dict] {rows:,} rows -> 日本語名 {self.n_ja:,} (>={MIN_NAME_LEN_NATIONAL}字) + "
              f"ラテン名 {self.n_la:,} (>={MIN_NAME_LEN_LATIN}字, 語境界必須)", file=sys.stderr)

    def match(self, text: str) -> set[str]:
        """店名の生一致だけを返す（地名の裏取りは match_corroborated で課す）。"""
        hits: set[str] = set()
        tja = normalize_ja(text)
        if tja:
            hits |= {found for _, found in self.auto_ja.iter(tja)}
            # 「麺屋武蔵」と「麺屋武」が両方辞書にある場合、包含される短い方を落とす
            hits = {h for h in hits if not any(h != o and h in o for o in hits)}
        # #1273 【バグ】複数語のラテン名が句読点をまたいで一致してしまう
        # （"Mother Coffee" が "mother!? [Coffee shops" に一致）。句読点で区切った
        # セグメント単位でしか一致させないことで防ぐ。
        for segment in re.split(r"[^0-9a-z]{2,}|[\[\]()（）【】!！?？,、。:：]", normalize_latin(text)):
            seg = " " + segment.strip() + " "
            if len(seg) <= 2:
                continue
            for end, found in self.auto_la.iter(seg):
                start = end - len(found) + 1
                if seg[start - 1] == " " and seg[end + 1] == " ":
                    hits.add(found)
        return hits

    def match_corroborated(self, text: str) -> set[str]:
        """店名一致に加えて、その店の locality か region が同じテキストに出ることを要求する。

        # #1273 §22 【設計】店名だけの一致は「Value」「Bento」「ブレンド」「四天王寺」のような
        # 一般語・地名が店名になっている場合に偽陽性を量産する（実測 precision 30〜40%）。
        # S の実測が信頼できたのは地名の裏取りを課していたためで、同じ規律をここでも課す。
        # 取りこぼし（地名を書かない動画）は出るが、そちらは下限側に倒れるので許容する。
        """
        tja = normalize_ja(text)
        out = set()
        for key in self.match(text):
            loc, region = self.area.get(key, ("", ""))
            if (loc and loc in tja) or (region and region in tja):
                out.add(key)
        return out


def yt_json(target: str, extra: list[str], timeout: int) -> tuple[dict | None, str | None]:
    cmd = [sys.executable, str(YT_DLP), "--flat-playlist", "-J", "--no-warnings", *extra, target]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None, "timeout"
    if not proc.stdout.strip():
        return None, (proc.stderr.strip().splitlines()[-1][:160] if proc.stderr.strip() else "empty")
    try:
        return json.loads(proc.stdout.splitlines()[-1]), None
    except json.JSONDecodeError:
        return None, "json_decode_error"


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 Round3 idea A: channel traversal")
    ap.add_argument("--seed-queries", type=int, default=40)
    ap.add_argument("--max-channels", type=int, default=25)
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--out", type=Path, default=HERE / "out" / "channel_traversal.json")
    ap.add_argument("--cache", type=Path, default=HERE / "out" / "channel_titles_cache.json",
                    help="列挙した動画タイトルのキャッシュ。あればYouTubeを再度叩かずに再集計する")
    args = ap.parse_args()

    matcher = NameMatcher()

    # #1273 【設計】マッチャの判定規則は繰り返し直すことになるので、YouTubeから取った
    # 生タイトルをキャッシュして、再集計時にネットワークを一切使わないようにする。
    cache: dict = {}
    if args.cache.exists():
        cache = json.loads(args.cache.read_text(encoding="utf-8"))
        print(f"[cache] {args.cache.name} を使用（YouTubeへの再アクセスなし）", file=sys.stderr)

    # --- 1. 種取り: カテゴリ×エリア検索で、店名を名指しした動画のチャンネルを集める ---
    cats = list(csv.DictReader((FIXTURES / "public_dish_categories_134_gate.csv").open(encoding="utf-8")))
    cats.sort(key=lambda c: -float(c.get("market_salience_jp") or 0))
    localities = ["大阪市平野区", "さくら市", "札幌市中央区", "松山市"]
    seeds = [
        {"query": f"{cats[i % len(cats)]['label_ja']} {localities[i % len(localities)]}"}
        for i in range(args.seed_queries)
    ]

    def seed_work(s: dict) -> dict:
        data, err = yt_json(f"ytsearch10:{s['query']}", [], 120)
        entries = [e for e in ((data or {}).get("entries") or []) if e]
        return {**s, "error": err,
                "entries": [{"title": e.get("title"), "channel_id": e.get("channel_id"),
                             "channel": e.get("channel") or e.get("uploader")} for e in entries]}

    if "seeds" in cache:
        seed_rows = cache["seeds"]
    else:
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            seed_rows = list(pool.map(seed_work, seeds))
        cache["seeds"] = seed_rows

    for row in seed_rows:
        row["found"] = [
            {"channel_id": e["channel_id"], "channel": e["channel"], "names": sorted(names)}
            for e in row["entries"]
            if e.get("channel_id") and (names := matcher.match_corroborated(e.get("title") or ""))
        ]

    channels: dict[str, dict] = {}
    for row in seed_rows:
        for f in row["found"]:
            ch = channels.setdefault(f["channel_id"], {"channel": f["channel"], "seed_hits": 0})
            ch["seed_hits"] += 1
    ranked = sorted(channels.items(), key=lambda kv: -kv[1]["seed_hits"])[: args.max_channels]
    seed_queries_used = len([r for r in seed_rows if r["error"] is None])
    seed_distinct = {n for row in seed_rows for f in row["found"] for n in f["names"]}
    print(f"[seed] {seed_queries_used} queries -> {len(channels)} channels, "
          f"{len(seed_distinct)} distinct restaurants", file=sys.stderr)

    # --- 2. 各チャンネルの過去動画を全列挙して逆引き ---
    def channel_fetch(item: tuple[str, dict]) -> dict:
        cid, meta = item
        url = f"https://www.youtube.com/channel/{cid}/videos"
        data, err = yt_json(url, ["--playlist-end", str(MAX_VIDEOS_PER_CHANNEL)], 300)
        entries = [e for e in ((data or {}).get("entries") or []) if e]
        return {"channel_id": cid, "channel": meta["channel"], "seed_hits": meta["seed_hits"],
                "error": err,
                "videos": [{"id": e.get("id"), "title": e.get("title")} for e in entries]}

    if "channels" in cache:
        raw_channels = cache["channels"]
    else:
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            raw_channels = list(pool.map(channel_fetch, ranked))
        cache["channels"] = raw_channels
        args.cache.parent.mkdir(parents=True, exist_ok=True)
        args.cache.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")

    ch_rows = []
    for c in raw_channels:
        found: dict[str, list[str]] = {}
        for v in c["videos"]:
            for n in matcher.match_corroborated(v.get("title") or ""):
                found.setdefault(n, []).append(v.get("id"))
        ch_rows.append({
            "channel_id": c["channel_id"], "channel": c["channel"],
            "seed_hits": c["seed_hits"], "error": c["error"],
            "n_videos": len(c["videos"]), "n_distinct_restaurants": len(found),
            "restaurants": {matcher.original.get(k, k): v[:3] for k, v in found.items()},
        })

    ok = [c for c in ch_rows if c["error"] is None and c["n_videos"] > 0]
    all_found: set[str] = set()
    for c in ok:
        all_found.update(c["restaurants"].keys())
    total_videos = sum(c["n_videos"] for c in ok)

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "hypothesis": "飽和は検索ランキングの枯渇であって供給の枯渇ではない",
            "dictionary": f"Overture全国、同名2件以上(チェーン)と{MIN_NAME_LEN_NATIONAL}文字未満を除外",
            "seed": f"ytsearch10 x {args.seed_queries}",
            "traversal": f"channel/videos flat-playlist, 上限{MAX_VIDEOS_PER_CHANNEL}本/ch",
        },
        "seed": {
            "queries": seed_queries_used,
            "channels_discovered": len(channels),
            "distinct_restaurants": len(seed_distinct),
        },
        "traversal": {
            "channels_attempted": len(ranked),
            "channels_ok": len(ok),
            "total_videos_enumerated": total_videos,
            "distinct_restaurants": len(all_found),
            "restaurants_per_channel_call": len(all_found) / len(ok) if ok else 0,
        },
        "channels": ch_rows,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n=== チャンネル逆走査 ===", file=sys.stderr)
    print(f"種取り : {seed_queries_used} クエリ -> {len(seed_distinct)} 店 "
          f"({len(seed_distinct)/max(seed_queries_used,1):.2f} 店/クエリ)", file=sys.stderr)
    print(f"逆走査 : {len(ok)} チャンネル呼び出し -> {total_videos:,} 動画列挙 "
          f"-> {len(all_found):,} 店", file=sys.stderr)
    print(f"         = {len(all_found)/max(len(ok),1):.1f} 店 / チャンネル呼び出し", file=sys.stderr)
    print(f"\n上位チャンネル:", file=sys.stderr)
    for c in sorted(ok, key=lambda x: -x["n_distinct_restaurants"])[:10]:
        print(f"  {c['n_distinct_restaurants']:4d}店 / {c['n_videos']:4d}本  {c['channel']}", file=sys.stderr)
    print(f"Saved: {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
