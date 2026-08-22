#!/usr/bin/env python3
"""#1273 アイデアJ: 発見済み dish_media が「アプリで見せられる品質」かを実測する。

snowball crawl でキャッシュ済みの 400ch / 110,696本から、NameMatcher で
店舗を特定できた動画（restaurant_matched_videos）を母集団とし、決定的サンプリングで
N本を選んで yt-dlp の個別メタデータを取得する。

測るもの:
  - Shorts比率（duration<=60秒 かつ 縦動画 height>width）
  - embeddable率（playable_in_embed）
  - 解像度分布（height）
  - 生存率（取得失敗の割合と理由）
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import io
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
YT_DLP = Path("/tmp/yt-dlp-latest")

from measure_channel_traversal import NameMatcher  # noqa: E402


def build_population(matcher: NameMatcher, state_path: Path) -> list[dict]:
    """店舗特定できた動画の母集団を組み立てる。

    # #1273 【仕様】run_snowball_crawl.py と同じ match_corroborated（地名裏取り必須）で
    # 絞る。ここを緩めると別物の母集団になるので必ず同じ判定を使う。
    """
    state = json.loads(state_path.read_text(encoding="utf-8"))
    all_videos: dict[str, dict] = {}
    for cid, c in state["channels"].items():
        for v in c.get("videos", []):
            if v.get("id") and v.get("title"):
                all_videos[v["id"]] = {"id": v["id"], "title": v["title"],
                                       "channel": c.get("channel", ""), "channel_id": cid}
    pop = []
    for v in all_videos.values():
        rests = matcher.match_corroborated(v["title"])
        if rests:
            pop.append({**v, "restaurants": sorted(rests)})
    return pop


def deterministic_sample(pop: list[dict], n: int) -> list[dict]:
    """SHA-256(video_id) でソートして先頭N件。再実行しても同じ標本になる。"""
    return sorted(pop, key=lambda v: hashlib.sha256(v["id"].encode()).hexdigest())[:n]


def probe_thumb(vid: str, name: str) -> tuple[int, tuple[int, int] | None]:
    """サムネイル1種のHTTPステータスと実寸を返す。

    # #1273 【設計】yt-dlp のどのplayer_clientでも実映像フォーマット（width/height）が
    # 取れない（PO token 必須でこのIPからは formats が空）。代わりに i.ytimg.com の
    # サムネイル実寸を使う:
    #   oardefault.jpg … original aspect ratio 版。16:9 でない動画にだけ生成されるので
    #                    存在＝非16:9、その実寸がそのまま元動画のアスペクト比になる
    #   maxresdefault.jpg / hq720.jpg … 元動画が1280x720相当以上のときだけ生成される
    """
    try:
        r = requests.get(f"https://i.ytimg.com/vi/{vid}/{name}.jpg", timeout=20)
    except Exception:
        return -1, None
    if r.status_code != 200:
        return r.status_code, None
    try:
        return 200, Image.open(io.BytesIO(r.content)).size
    except Exception:
        return 200, None


def fetch_meta(video: dict, timeout: int = 90) -> dict:
    """1本ぶんのメタデータを取る。失敗理由は stderr の最終行を残す。

    # #1273 【バグ】既定の player_client では全件が
    # 「Sign in to confirm you're not a bot」で落ちる（実測 6/6 失敗）。
    # mweb クライアントだけがこのIPからbot判定を回避できるので固定する。
    # #1273 【パフォーマンス】1本2〜5秒かかる。並列は3に抑える。
    """
    url = f"https://www.youtube.com/watch?v={video['id']}"
    cmd = [sys.executable, str(YT_DLP), "-J", "--skip-download", "--no-warnings",
           "--ignore-no-formats-error",
           "--extractor-args", "youtube:player_client=mweb", url]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {**video, "ok": False, "error": "timeout"}
    if not proc.stdout.strip():
        err = (proc.stderr.strip().splitlines() or ["empty"])[-1][:220]
        return {**video, "ok": False, "error": err}
    try:
        d = json.loads(proc.stdout.splitlines()[-1])
    except json.JSONDecodeError:
        return {**video, "ok": False, "error": "json_decode_error"}

    oar_code, oar = probe_thumb(video["id"], "oardefault")
    maxres_code, maxres = probe_thumb(video["id"], "maxresdefault")
    hq720_code, _ = probe_thumb(video["id"], "hq720")
    # 16:9動画は oardefault が404なので、そのときは 16:9 とみなす
    w, h = (oar if oar else (16, 9))
    return {
        **video,
        "ok": True,
        "duration": d.get("duration"),
        "oar_wh": list(oar) if oar else None,
        "width": w,
        "height": h,
        "vertical": h > w,
        "maxres_ok": maxres_code == 200,
        "maxres_wh": list(maxres) if maxres else None,
        "hq720_ok": hq720_code == 200,
        "playable_in_embed": d.get("playable_in_embed"),
        "availability": d.get("availability"),
        "age_limit": d.get("age_limit"),
        "live_status": d.get("live_status"),
        "webpage_url": d.get("webpage_url"),
        "thumbnail": d.get("thumbnail"),
        "view_count": d.get("view_count"),
        "upload_date": d.get("upload_date"),
        "uploader": d.get("uploader"),
        "full_title": d.get("title"),
    }


def classify_error(err: str) -> str:
    """取得失敗の理由を分類する。"""
    e = (err or "").lower()
    if "private" in e:
        return "private"
    if "removed" in e or "unavailable" in e and "account" in e:
        return "removed"
    if "not available" in e or "unavailable" in e:
        return "unavailable"
    if "age" in e or "sign in to confirm your age" in e:
        return "age_restricted"
    if "country" in e or "region" in e or "geo" in e:
        return "geo_blocked"
    if "sign in to confirm" in e or "bot" in e:
        return "bot_check"
    if "timeout" in e:
        return "timeout"
    return "other"


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 idea J: dish_media の表示品質実測")
    ap.add_argument("--sample", type=int, default=250)
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--state", type=Path, default=HERE / "out" / "snowball_crawl_state.json")
    ap.add_argument("--out", type=Path, default=HERE / "out" / "youtube-shorts-quality.json")
    args = ap.parse_args()

    matcher = NameMatcher()
    pop = build_population(matcher, args.state)
    print(f"[pop] 店舗特定済み動画 {len(pop):,}", file=sys.stderr)
    sample = deterministic_sample(pop, args.sample)
    print(f"[sample] {len(sample)} 本を取得開始", file=sys.stderr)

    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        for i, r in enumerate(pool.map(fetch_meta, sample), 1):
            results.append(r)
            if i % 20 == 0:
                ok = sum(1 for x in results if x["ok"])
                print(f"[fetch] {i}/{len(sample)} ok={ok}", file=sys.stderr)
                args.out.parent.mkdir(parents=True, exist_ok=True)
                args.out.write_text(json.dumps({"partial": results}, ensure_ascii=False),
                                    encoding="utf-8")

    ok = [r for r in results if r["ok"]]
    ng = [r for r in results if not r["ok"]]

    def is_short(r: dict) -> bool:
        d, w, h = r.get("duration"), r.get("width"), r.get("height")
        return bool(d is not None and d <= 60 and w and h and h > w)

    shorts = [r for r in ok if is_short(r)]
    embeddable = [r for r in ok if r.get("playable_in_embed") is True]
    shorts_embed = [r for r in shorts if r.get("playable_in_embed") is True]

    heights = collections.Counter(tuple(r.get("maxres_wh") or []) for r in ok)
    dur_buckets: collections.Counter = collections.Counter()
    for r in ok:
        d = r.get("duration")
        if d is None:
            dur_buckets["unknown"] += 1
        elif d <= 60:
            dur_buckets["<=60s"] += 1
        elif d <= 180:
            dur_buckets["61-180s"] += 1
        elif d <= 600:
            dur_buckets["181-600s"] += 1
        else:
            dur_buckets[">600s"] += 1

    err_kinds = collections.Counter(classify_error(r.get("error", "")) for r in ng)

    # 目視検証用の無作為15件（決定的順序の中から等間隔）
    step = max(len(ok) // 15, 1)
    eyeball = [{"id": r["id"], "title": r["title"], "channel": r["channel"],
                "duration": r.get("duration"), "wxh": f"{r.get('width')}x{r.get('height')}",
                "vertical": bool(r.get("width") and r.get("height") and
                                 r["height"] > r["width"]),
                "embed": r.get("playable_in_embed"), "availability": r.get("availability"),
                "thumbnail": r.get("thumbnail"),
                "restaurants": r["restaurants"],
                "url": f"https://www.youtube.com/watch?v={r['id']}"}
               for r in ok[::step][:15]]

    n_ok = len(ok)
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "population_matched_videos": len(pop),
        "sample_requested": args.sample,
        "sample_fetched": len(results),
        "ok": n_ok,
        "failed": len(ng),
        "alive_pct": round(100 * n_ok / max(len(results), 1), 1),
        "error_kinds": err_kinds.most_common(),
        "error_examples": [{"id": r["id"], "error": r.get("error")} for r in ng[:12]],
        "shorts_n": len(shorts),
        "shorts_pct_of_ok": round(100 * len(shorts) / max(n_ok, 1), 1),
        "embeddable_n": len(embeddable),
        "embeddable_pct_of_ok": round(100 * len(embeddable) / max(n_ok, 1), 1),
        "shorts_and_embeddable_n": len(shorts_embed),
        "shorts_and_embeddable_pct_of_ok": round(100 * len(shorts_embed) / max(n_ok, 1), 1),
        "shorts_and_embeddable_pct_of_sample": round(100 * len(shorts_embed) /
                                                     max(len(results), 1), 1),
        "duration_buckets": dur_buckets.most_common(),
        "maxres_wh_hist": [[list(k), c] for k, c in heights.most_common()],
        "res_ge_720_n": sum(1 for r in ok if r.get("hq720_ok")),
        "res_lt_720_n": sum(1 for r in ok if not r.get("hq720_ok")),
        "oar_present_n": sum(1 for r in ok if r.get("oar_wh")),
        "vertical_n": sum(1 for r in ok if r.get("vertical")),
        "availability": collections.Counter(r.get("availability") for r in ok).most_common(),
        "eyeball_15": eyeball,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"summary": summary, "results": results},
                                   ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=1)[:4000])


if __name__ == "__main__":
    main()
