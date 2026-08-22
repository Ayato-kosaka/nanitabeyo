#!/usr/bin/env python3
"""#1273 アイデア: YouTube Shorts の供給量そのものを実測する。

背景:
  既存の snowball crawl は「グルメ系チャンネルの /videos タブ」由来なので、
  Shorts が構造的に混ざりにくい。実際 250本サンプルで Shorts は 0/250 = 0.0% だった。
  しかし縦Shorts（例 PrGT-wEzMfU）は実在する。つまり
  「Shorts が無い」のではなく「/videos タブから拾えていない」だけの可能性がある。

  そこで Shorts を **直接** 探しに行き、
    (a) 列挙手段として何が実際に動くか
    (b) どれだけの量が集まるか
    (c) 集めた Shorts のうち実在店舗を特定できる割合（= 主要指標）
  を実測する。

段階:
  probe    … 列挙手段3種（hashtag/shorts, channel/shorts, ytsearch）の生死を実測
  collect  … 動いた手段で Shorts を大量収集
  identify … 収集した Shorts の店舗特定率を測る（タイトルのみ vs タイトル+概要欄）
  verify   … 目視精度検証用に無作為15件を人が読める形で出す
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
OUT = HERE / "out"
YT_DLP = "/tmp/yt-dlp-latest"
SLUG = "shorts-supply-scan"

from measure_channel_traversal import NameMatcher  # noqa: E402
from measure_dish_media_yield import load_categories, match_categories  # noqa: E402

# #1273 【仕様】既定の player_client は bot 判定される。列挙(flat-playlist)は mweb で通る。
CLIENT_LIST = "youtube:player_client=mweb"
# #1273 【バグ】個別動画のメタデータ取得は mweb/tv/ios/web_safari すべて
# "Sign in to confirm you're not a bot" または 429 で落ちる。android_vr だけが通る。
# 姉妹タスク(youtube-shorts-quality)が alive 0/6 になったのはこれが原因。
CLIENT_META = "youtube:player_client=android_vr"

# 料理系ハッシュタグ。#1273 の 134カテゴリと日本の飯テロ系タグから選定。
HASHTAGS = [
    "ラーメン", "飯テロ", "グルメ", "寿司", "焼肉", "カレー", "居酒屋",
    "うどん", "そば", "とんかつ", "天ぷら", "餃子", "牛丼", "パスタ",
    "ハンバーグ", "ステーキ", "スイーツ", "パンケーキ", "唐揚げ", "お好み焼き",
    "東京グルメ", "大阪グルメ", "名古屋グルメ", "福岡グルメ", "札幌グルメ",
]


def run_yt(args: list[str], timeout: int = 180) -> subprocess.CompletedProcess:
    return subprocess.run(["python3", YT_DLP, *args], capture_output=True,
                          text=True, timeout=timeout)


def flat_list(url: str, limit: int, timeout: int = 180) -> tuple[list[dict], str]:
    """flat-playlist で列挙する。戻り値は (エントリ列, エラー文字列)。

    # #1273 【設計】flat-playlist は 1リクエストで数十件返るので、個別取得より
    # 圧倒的に安全かつ速い。ここで得られるのは id/title/view_count/thumbnails のみ。
    """
    try:
        p = run_yt(["--extractor-args", CLIENT_LIST, "--flat-playlist", "--dump-json",
                    "--playlist-end", str(limit), url], timeout=timeout)
    except subprocess.TimeoutExpired:
        return [], "timeout"
    out = []
    for line in p.stdout.splitlines():
        if not line.startswith("{"):
            continue
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        th = d.get("thumbnails") or []
        # #1273 【仕様】Shorts のサムネは oardefault で縦(405x720)。
        # 縦判定はここで確定できるので、個別メタデータ取得なしに Shorts と断定できる。
        vertical = any((t.get("height") or 0) > (t.get("width") or 0) for t in th)
        out.append({
            "id": d.get("id"), "title": d.get("title") or "",
            "view_count": d.get("view_count"), "vertical": vertical,
            "url": d.get("url") or "",
        })
    err = "" if out else (p.stderr.strip().splitlines()[-1][:200] if p.stderr.strip() else "empty")
    return out, err


def fetch_meta(vid: str, timeout: int = 90) -> dict:
    """個別動画のフルメタデータ（概要欄つき）。android_vr のみ通る。"""
    try:
        p = run_yt(["--extractor-args", CLIENT_META, "--dump-json", "--no-playlist",
                    f"https://www.youtube.com/watch?v={vid}"], timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"id": vid, "ok": False, "error": "timeout"}
    line = next((l for l in p.stdout.splitlines() if l.startswith("{")), None)
    if not line:
        tail = p.stderr.strip().splitlines()
        return {"id": vid, "ok": False, "error": (tail[-1][:200] if tail else "no output")}
    d = json.loads(line)
    return {
        "id": vid, "ok": True, "title": d.get("title") or "",
        "description": d.get("description") or "",
        "duration": d.get("duration"), "height": d.get("height"), "width": d.get("width"),
        "channel": d.get("channel") or "", "channel_id": d.get("channel_id") or "",
        "tags": d.get("tags") or [], "view_count": d.get("view_count"),
    }


def dsample(items: list[dict], n: int, key: str = "id") -> list[dict]:
    """SHA-256(id) 昇順で先頭N件。再実行しても同じ標本になる（鉄則1）。"""
    return sorted(items, key=lambda x: hashlib.sha256(str(x[key]).encode()).hexdigest())[:n]


# ---------------------------------------------------------------- probe

def cmd_probe(args) -> dict:
    """列挙手段3種の生死を実測する。推測ではなく実際に叩く（鉄則2）。"""
    state = json.loads((OUT / "snowball_crawl_state.json").read_text(encoding="utf-8"))
    cids = list(state["channels"].keys())
    results = {}

    # 手段1: ハッシュタグの /shorts タブ
    hres = []
    for tag in HASHTAGS[:6]:
        ents, err = flat_list(f"https://www.youtube.com/hashtag/{tag}/shorts", 300)
        hres.append({"tag": tag, "n": len(ents), "vertical": sum(e["vertical"] for e in ents),
                     "err": err})
    results["hashtag_shorts"] = {
        "works": any(h["n"] > 0 for h in hres), "detail": hres,
        "max_depth": max((h["n"] for h in hres), default=0),
    }

    # 手段2: チャンネルの /shorts タブ  ← #1273 的にはこれが最重要
    cres = []
    for c in dsample([{"id": c} for c in cids], 12):
        ents, err = flat_list(f"https://www.youtube.com/channel/{c['id']}/shorts", 60)
        cres.append({"channel_id": c["id"], "n": len(ents),
                     "vertical": sum(e["vertical"] for e in ents), "err": err})
    results["channel_shorts"] = {
        "works": any(c["n"] > 0 for c in cres),
        "channels_with_tab": sum(1 for c in cres if c["n"] > 0), "channels_tried": len(cres),
        "detail": cres,
    }

    # 手段3: ytsearch の結果から縦サムネを拾う
    sres = []
    for q in ["ラーメン 二郎系", "東京 焼肉 うまい"]:
        ents, err = flat_list(f"ytsearch40:{q}", 40)
        sres.append({"query": q, "n": len(ents),
                     "vertical": sum(e["vertical"] for e in ents), "err": err})
    results["ytsearch_vertical"] = {
        "works": any(s["vertical"] > 0 for s in sres), "detail": sres,
    }
    return results


# ---------------------------------------------------------------- collect

def cmd_collect(args) -> dict:
    """動いた手段で Shorts を大量収集する。"""
    state = json.loads((OUT / "snowball_crawl_state.json").read_text(encoding="utf-8"))
    chans = state["channels"]
    cids = list(chans.keys())[: args.channels]

    def one(c: str) -> tuple[str, list[dict], str]:
        ents, err = flat_list(f"https://www.youtube.com/channel/{c}/shorts", args.per_channel)
        for e in ents:
            e["channel_id"] = c
            e["channel"] = chans[c].get("channel", "")
        return c, ents, err

    by_channel: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for c, ents, err in ex.map(one, cids):
            by_channel[c] = {"n": len(ents), "err": err, "shorts": ents}

    # ハッシュタグ経由も集める（重複がどれだけ出るかを見る）
    by_tag: dict[str, dict] = {}
    def one_tag(t: str):
        ents, err = flat_list(f"https://www.youtube.com/hashtag/{t}/shorts", 300)
        return t, ents, err
    with ThreadPoolExecutor(max_workers=8) as ex:
        for t, ents, err in ex.map(one_tag, HASHTAGS):
            by_tag[t] = {"n": len(ents), "err": err, "shorts": ents}

    return {"by_channel": by_channel, "by_tag": by_tag}


# ---------------------------------------------------------------- identify

def cmd_identify(args) -> dict:
    """収集した Shorts の店舗特定率を測る（主要指標）。"""
    raw = json.loads(Path(args.collected).read_text(encoding="utf-8"))
    matcher = NameMatcher()
    cats = load_categories()

    # 全 Shorts をユニーク化
    uniq: dict[str, dict] = {}
    for c, v in raw["by_channel"].items():
        for s in v["shorts"]:
            if s.get("id"):
                uniq[s["id"]] = s
    tag_uniq: dict[str, dict] = {}
    for t, v in raw.get("by_tag", {}).items():
        for s in v["shorts"]:
            if s.get("id"):
                tag_uniq[s["id"]] = {**s, "tag": t}

    all_shorts = list(uniq.values())
    vertical = [s for s in all_shorts if s.get("vertical")]

    # --- 段1: タイトルのみで店舗特定
    title_hits = []
    for s in vertical:
        r = matcher.match_corroborated(s["title"])
        if r:
            title_hits.append({**s, "restaurants": sorted(r), "via": "title"})

    # --- 段2: 概要欄を取ってから店舗特定（決定的サンプル）
    sample = dsample(vertical, args.meta_sample)
    metas: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for m in ex.map(fetch_meta, [s["id"] for s in sample]):
            metas[m["id"]] = m

    ok = [m for m in metas.values() if m.get("ok")]
    desc_hits, both_hits = [], []
    for m in ok:
        # #1273 【仕様】タイトル+概要欄+タグを連結して match_corroborated にかける。
        # 概要欄には店名/住所が書かれていることが多く、Shorts はタイトルが短いので
        # ここが効くかどうかが本タスクの核心。
        blob = "\n".join([m["title"], m["description"], " ".join(m.get("tags") or [])])
        r_title = matcher.match_corroborated(m["title"])
        r_all = matcher.match_corroborated(blob)
        if r_all:
            both_hits.append({"id": m["id"], "title": m["title"],
                              "restaurants": sorted(r_all),
                              "via": "title" if r_title else "description",
                              "desc_head": m["description"][:300],
                              "categories": [c["label_ja"] for c in match_categories(cats, blob)]})
        if r_all and not r_title:
            desc_hits.append(m["id"])

    n_ok = len(ok)
    ident = len(both_hits)
    # Shorts の実体確認（duration<=60 かつ 縦）
    real_shorts = [m for m in ok if (m.get("duration") or 999) <= 60
                   and (m.get("height") or 0) > (m.get("width") or 0)]

    return {
        "population": {
            "channels_scanned": len(raw["by_channel"]),
            "channels_with_shorts": sum(1 for v in raw["by_channel"].values() if v["n"] > 0),
            "unique_shorts_from_channels": len(uniq),
            "unique_shorts_from_hashtags": len(tag_uniq),
            "overlap_channel_vs_hashtag": len(set(uniq) & set(tag_uniq)),
            "vertical_confirmed": len(vertical),
        },
        "title_only": {
            "n": len(vertical), "hits": len(title_hits),
            "pct": round(100.0 * len(title_hits) / len(vertical), 2) if vertical else 0.0,
        },
        "with_description": {
            "sampled": len(sample), "meta_ok": n_ok,
            "meta_fail": len(sample) - n_ok,
            "identified": ident,
            "pct": round(100.0 * ident / n_ok, 2) if n_ok else 0.0,
            "uplift_from_description": len(desc_hits),
            "真Shorts_confirmed": len(real_shorts),
            "真Shorts_pct": round(100.0 * len(real_shorts) / n_ok, 2) if n_ok else 0.0,
        },
        "hits_detail": both_hits,
        "verify_sample": dsample(both_hits, 15) if both_hits else [],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["probe", "collect", "identify"])
    ap.add_argument("--channels", type=int, default=200)
    ap.add_argument("--per-channel", type=int, default=60)
    ap.add_argument("--meta-sample", type=int, default=150)
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--collected", default=str(OUT / f"{SLUG}_collected.json"))
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    fn = {"probe": cmd_probe, "collect": cmd_collect, "identify": cmd_identify}[args.cmd]
    res = fn(args)
    res_wrapped = {"generated_at": datetime.now(timezone.utc).isoformat(),
                   "cmd": args.cmd, "result": res}
    dest = Path(args.out) if args.out else OUT / f"{SLUG}_{args.cmd}.json"
    dest.write_text(json.dumps(res_wrapped, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {dest}")


if __name__ == "__main__":
    main()
