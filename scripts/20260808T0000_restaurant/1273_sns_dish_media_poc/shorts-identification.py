#!/usr/bin/env python3
"""#1273 軸1: Shorts をタイトル以外の手掛かりで同定できるかを実測する。

#1307 で「発見済み dish_media に Shorts が 0/250 = 0.0%」と出たが、原因は
Shorts が存在しないことではなく、Shorts がタイトルに店名・地名を書かないため
NameMatcher の裏取り（match_corroborated）を通らないことだった。

本スクリプトは2段構成:

  scan  … out/snowball_crawl_state.json の110,696本から Shorts候補を特定する。
          i.ytimg.com/vi/<id>/oardefault.jpg は「元動画が16:9でない」場合にだけ
          200を返す（実測: 縦Shorts PrGT-wEzMfU は200かつ720x1280、
          横動画 oUA0AfxFjq8 / ihz4limMdRE は404）。HEADだけで判定できるので安価。

  probe … Shorts候補と横長対照群それぞれに yt-dlp で個別メタデータを取り、
          タイトル / 概要欄 / ハッシュタグ / チャンネル名 の各手掛かりでの
          店舗同定率を出す。横長対照群を同じ手掛かりで測ることで
          「Shorts特有の難しさ」を分離する。
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import io
import json
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
OUT = HERE / "out"
YT_DLP = Path("/tmp/yt-dlp-latest")
STATE = OUT / "snowball_crawl_state.json"
SLUG = "shorts-identification"

from measure_channel_traversal import NameMatcher, normalize_ja  # noqa: E402


def load_videos() -> list[dict]:
    """crawl 済み全動画を (id,title,channel,channel_id) で平坦化する。"""
    state = json.loads(STATE.read_text(encoding="utf-8"))
    seen: dict[str, dict] = {}
    for cid, c in state["channels"].items():
        for v in c.get("videos", []):
            if v.get("id") and v.get("title"):
                seen.setdefault(v["id"], {
                    "id": v["id"], "title": v["title"],
                    "channel": c.get("channel", ""), "channel_id": cid,
                })
    return list(seen.values())


def det_sort(items: list[dict], key: str = "id") -> list[dict]:
    """SHA-256(id) 昇順。再実行しても同じ標本になるよう決定的に並べる。"""
    return sorted(items, key=lambda v: hashlib.sha256(v[key].encode()).hexdigest())


# ---------------------------------------------------------------- scan


def scan(args: argparse.Namespace) -> None:
    """oardefault.jpg の有無で Shorts候補（非16:9）を数える。"""
    videos = det_sort(load_videos())
    sample = videos[: args.n] if args.n > 0 else videos
    sess = requests.Session()
    adapter = requests.adapters.HTTPAdapter(pool_connections=args.workers,
                                            pool_maxsize=args.workers)
    sess.mount("https://", adapter)
    lock = threading.Lock()
    done = [0]

    def probe(v: dict) -> dict:
        url = f"https://i.ytimg.com/vi/{v['id']}/oardefault.jpg"
        status = -1
        for _ in range(3):
            try:
                r = sess.head(url, timeout=12, allow_redirects=True)
                status = r.status_code
                break
            except Exception:
                time.sleep(0.4)
        with lock:
            done[0] += 1
            if done[0] % 2000 == 0:
                print(f"[scan] {done[0]}/{len(sample)}", file=sys.stderr, flush=True)
        return {**v, "oar": status}

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        rows = list(ex.map(probe, sample))

    cand = [r for r in rows if r["oar"] == 200]
    print(f"[scan] sample={len(rows)} oar200={len(cand)} "
          f"rate={100*len(cand)/max(1,len(rows)):.2f}%", file=sys.stderr)
    OUT.joinpath(f"{SLUG}_scan.json").write_text(json.dumps({
        "sampled": len(rows), "oar200": len(cand),
        "rate_pct": round(100 * len(cand) / max(1, len(rows)), 3),
        "status_hist": dict(collections.Counter(r["oar"] for r in rows)),
        "candidates": cand,
        "non_candidates": [r for r in rows if r["oar"] != 200],
    }, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------- probe


def yt_meta(vid: str, timeout: int) -> tuple[dict | None, str | None]:
    """個別動画のメタデータ。mweb player_client 必須（既定はbot判定される）。"""
    # #1273 【バグ】mweb player_client では format 情報が返らず
    # "Requested format is not available" で JSON ごと null になる。
    # メタデータしか要らないので --ignore-no-formats-error を付ける。
    cmd = [sys.executable, str(YT_DLP), "-J", "--no-warnings", "--no-playlist",
           "--ignore-no-formats-error",
           "--extractor-args", "youtube:player_client=mweb",
           f"https://www.youtube.com/watch?v={vid}"]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None, "timeout"
    if not p.stdout.strip():
        err = p.stderr.strip().splitlines()[-1][:160] if p.stderr.strip() else "empty"
        return None, err
    try:
        data = json.loads(p.stdout)
        if not isinstance(data, dict):
            return None, "null"
        return data, None
    except Exception as e:  # noqa: BLE001
        return None, f"json:{e}"


HASHTAG_RE = re.compile(r"[#＃]([^\s#＃、,。／/|｜\[\]【】()（）]{1,30})")


def cues(meta: dict) -> dict[str, str]:
    """手掛かりごとのテキストを組み立てる。

    # #1273 【設計】match_corroborated は「店名 + その店の locality/region が
    # 同一テキストに出る」ことを要求する。よって手掛かりは店名側だけでなく
    # 地名側も供給しうる（チャンネル名『鹿児島ラーメンナビTV』が地名を供給する等）。
    # 各手掛かりを単独ではなく「タイトルに足したとき何が増えるか」で測る。
    """
    title = meta.get("title") or ""
    desc = meta.get("description") or ""
    chan = meta.get("uploader") or meta.get("channel") or ""
    tags = " ".join(meta.get("tags") or [])
    hashtags = " ".join(HASHTAG_RE.findall(title + "\n" + desc))
    return {
        "title": title,
        "desc": desc,
        "channel": chan,
        "tags": tags,
        "hashtags": hashtags,
    }


CUE_SETS = {
    "T_title": ("title",),
    "T+C_channel": ("title", "channel"),
    "T+H_hashtag": ("title", "hashtags"),
    "T+D_desc": ("title", "desc"),
    "T+D+C": ("title", "desc", "channel"),
    "ALL": ("title", "desc", "channel", "tags", "hashtags"),
}


def evaluate(matcher: NameMatcher, meta: dict) -> dict:
    c = cues(meta)
    res = {}
    for label, keys in CUE_SETS.items():
        text = "\n".join(c[k] for k in keys)
        raw = matcher.match(text)
        corr = matcher.match_corroborated(text)
        res[label] = {"raw": sorted(raw), "corroborated": sorted(corr)}
    return res


def shortstab(args: argparse.Namespace) -> None:
    """400chの /shorts タブを列挙する。

    # #1273 【バグ】snowball crawl は channel の /videos タブしか列挙していないため、
    # Shorts はそもそも 110,696本のプールに入っていなかった（実測 oardefault200 = 3/20,000）。
    # 「Shortsがタイトルに店名を書かないから落ちている」という #1307 の解釈は誤りで、
    # 正しくは「Shortsが母集団に存在しない」。よって /shorts タブを別途列挙する。
    """
    state = json.loads(STATE.read_text(encoding="utf-8"))
    chans = [{"id": cid, "name": c.get("channel", "")}
             for cid, c in state["channels"].items()]
    chans = det_sort(chans)[: args.n]
    lock = threading.Lock()
    done = [0]

    def work(c: dict) -> dict:
        cmd = [sys.executable, str(YT_DLP), "--flat-playlist", "-J", "--no-warnings",
               "--extractor-args", "youtube:player_client=mweb",
               "--playlist-end", str(args.per_channel),
               f"https://www.youtube.com/channel/{c['id']}/shorts"]
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=args.timeout)
            # #1273 【バグ】Shortsタブが空のチャンネルは yt-dlp が "null" を返すので
            # json.loads の結果が None になる。dict でなければ空扱いにする。
            data = json.loads(p.stdout) if p.stdout.strip() else {}
            if not isinstance(data, dict):
                data = {}
        except Exception as e:  # noqa: BLE001
            data = {}
            with lock:
                done[0] += 1
            return {**c, "ok": False, "error": str(e)[:120], "videos": []}
        vids = [{"id": e.get("id"), "title": e.get("title") or ""}
                for e in (data.get("entries") or []) if e.get("id")]
        with lock:
            done[0] += 1
            if done[0] % 20 == 0:
                print(f"[shortstab] {done[0]}/{len(chans)}", file=sys.stderr, flush=True)
        return {**c, "ok": True, "videos": vids}

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        rows = list(ex.map(work, chans))

    total = sum(len(r["videos"]) for r in rows)
    with_any = sum(1 for r in rows if r["videos"])
    print(f"[shortstab] channels={len(rows)} with_shorts={with_any} shorts={total}",
          file=sys.stderr)
    OUT.joinpath(f"{SLUG}_shortstab.json").write_text(json.dumps({
        "channels": len(rows), "channels_with_shorts": with_any, "shorts_total": total,
        "rows": rows}, ensure_ascii=False), encoding="utf-8")


def probe(args: argparse.Namespace) -> None:
    scan_path = OUT / f"{SLUG}_scan.json"
    sc = json.loads(scan_path.read_text(encoding="utf-8"))
    matcher = NameMatcher()

    shorts = det_sort(sc["candidates"])[: args.n]
    control = det_sort(sc["non_candidates"])[: args.n]
    targets = [{**v, "group": "shorts"} for v in shorts] + \
              [{**v, "group": "control_wide"} for v in control]

    lock = threading.Lock()
    done = [0]

    def work(v: dict) -> dict:
        meta, err = yt_meta(v["id"], args.timeout)
        with lock:
            done[0] += 1
            if done[0] % 25 == 0:
                print(f"[probe] {done[0]}/{len(targets)}", file=sys.stderr, flush=True)
        if meta is None:
            return {**v, "ok": False, "error": err}
        c = cues(meta)
        w, h = meta.get("width") or 0, meta.get("height") or 0
        return {
            **v, "ok": True,
            "duration": meta.get("duration"),
            "width": w, "height": h,
            "vertical": bool(h and w and h > w),
            "is_short": bool(h and w and h > w and (meta.get("duration") or 999) <= 180),
            "uploader": c["channel"],
            "desc_len": len(c["desc"]),
            "desc": c["desc"][:1200],
            "hashtags": c["hashtags"][:400],
            "tags": (meta.get("tags") or [])[:20],
            "title_full": c["title"],
            "cues": evaluate(matcher, meta),
        }

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        rows = list(ex.map(work, targets))

    OUT.joinpath(f"{SLUG}_probe.json").write_text(
        json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    summarize(rows, sc)


def summarize(rows: list[dict], sc: dict) -> None:
    out: dict = {
        "slug": SLUG,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scan": {k: sc[k] for k in ("sampled", "oar200", "rate_pct", "status_hist")},
        "groups": {},
    }
    for grp in ("shorts", "control_wide"):
        g = [r for r in rows if r["group"] == grp]
        ok = [r for r in g if r["ok"]]
        block = {
            "requested": len(g), "fetched": len(ok),
            "fetch_errors": dict(collections.Counter(
                r.get("error", "?") for r in g if not r["ok"])),
            "vertical": sum(1 for r in ok if r["vertical"]),
            "is_short_le180s": sum(1 for r in ok if r["is_short"]),
            "median_duration": sorted(r["duration"] or 0 for r in ok)[len(ok) // 2] if ok else None,
            "desc_nonempty": sum(1 for r in ok if r["desc_len"] > 0),
            "median_desc_len": sorted(r["desc_len"] for r in ok)[len(ok) // 2] if ok else None,
            "has_hashtag": sum(1 for r in ok if r["hashtags"].strip()),
            "cues": {},
        }
        for label in CUE_SETS:
            corr = [r for r in ok if r["cues"][label]["corroborated"]]
            raw = [r for r in ok if r["cues"][label]["raw"]]
            block["cues"][label] = {
                "corroborated_n": len(corr),
                "corroborated_pct": round(100 * len(corr) / max(1, len(ok)), 2),
                "raw_n": len(raw),
                "raw_pct": round(100 * len(raw) / max(1, len(ok)), 2),
            }
        out["groups"][grp] = block

    OUT.joinpath(f"{SLUG}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1),
                                            encoding="utf-8")
    print(json.dumps(out["groups"], ensure_ascii=False, indent=1))


def resummarize(args: argparse.Namespace) -> None:
    rows = json.loads((OUT / f"{SLUG}_probe.json").read_text(encoding="utf-8"))
    sc = json.loads((OUT / f"{SLUG}_scan.json").read_text(encoding="utf-8"))
    summarize(rows, sc)


def eyeball(args: argparse.Namespace) -> None:
    """目視精度検証用に、同定できた件を人が読める形で出す。"""
    rows = json.loads((OUT / f"{SLUG}_probe.json").read_text(encoding="utf-8"))
    hits = [r for r in rows if r["ok"] and r["group"] == args.group
            and r["cues"][args.cue]["corroborated"]]
    hits = det_sort(hits)[: args.n]
    for i, r in enumerate(hits, 1):
        print(f"--- [{i}] {r['id']}  https://www.youtube.com/watch?v={r['id']}")
        print(f"  chan : {r['uploader']}")
        print(f"  title: {r['title_full']}")
        print(f"  dur  : {r['duration']}s  {r['width']}x{r['height']}")
        print(f"  hit  : {r['cues'][args.cue]['corroborated']}")
        print(f"  tags : {r['hashtags'][:200]}")
        print(f"  desc : {r['desc'][:500]}".replace("\n", " / "))
        print()


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("scan"); s.add_argument("--n", type=int, default=20000)
    s.add_argument("--workers", type=int, default=64); s.set_defaults(fn=scan)
    p = sub.add_parser("probe"); p.add_argument("--n", type=int, default=150)
    p.add_argument("--workers", type=int, default=12)
    p.add_argument("--timeout", type=int, default=90); p.set_defaults(fn=probe)
    t = sub.add_parser("shortstab"); t.add_argument("--n", type=int, default=120)
    t.add_argument("--per-channel", type=int, default=60)
    t.add_argument("--workers", type=int, default=16)
    t.add_argument("--timeout", type=int, default=120); t.set_defaults(fn=shortstab)
    r = sub.add_parser("resummarize"); r.set_defaults(fn=resummarize)
    e = sub.add_parser("eyeball"); e.add_argument("--group", default="shorts")
    e.add_argument("--cue", default="ALL"); e.add_argument("--n", type=int, default=15)
    e.set_defaults(fn=eyeball)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
