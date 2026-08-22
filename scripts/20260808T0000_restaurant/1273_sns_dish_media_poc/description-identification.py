#!/usr/bin/env python3
"""#1273 概要欄による店舗特定率の引き上げ実測.

現状の dish_media funnel は「動画のうち restaurant 特定 9.0%」で、この 9.0% は
**動画タイトルだけ**を NameMatcher.match_corroborated にかけた値である。
概要欄（description）・タグ・チャンネル名を足せば特定率は上がるはずだが、
概要欄は動画一覧 API（--flat-playlist）に含まれないため 1動画1コールになる。
「追加同定1件あたり何コール必要か」を実測して割に合うかを判定する。

使い方:
    python3 description-identification.py --sample 300 --concurrency 3
    python3 description-identification.py --recount   # 取得済みキャッシュだけで再集計
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import json
import random
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from measure_channel_traversal import NameMatcher, normalize_ja  # noqa: E402

YT_DLP = Path("/tmp/yt-dlp-latest")
STATE = HERE / "out" / "snowball_crawl_state.json"
CACHE = HERE / "out" / "description-identification_meta.json"
SLUG = "description-identification"

# #1273 【仕様】既定の player_client は bot 判定されるため mweb を強制する。
# また mweb は動画フォーマットを返さないことがあり、-J だけだと
# "Requested format is not available" でメタデータごと落ちる。メタデータしか
# 要らないので --ignore-no-formats-error でフォーマット不在を無視する。
YT_ARGS = [
    "-J", "--no-warnings", "--skip-download", "--ignore-no-formats-error",
    "--extractor-args", "youtube:player_client=mweb",
]

# #1273 【バグ】v3 で実際に出た偽陽性。概要欄の店名が「撮影協力」「BGM提供」等の
# クレジット文脈にあると、その動画で映っている料理の店ではない。目視検証で必ず見る。
CREDIT_WORDS = ["撮影協力", "取材協力", "ご協力", "協力：", "協力:", "提供：", "提供:",
                "スポンサー", "前回", "次回", "こちらもどうぞ", "関連動画", "おすすめ動画",
                "過去動画", "再生リスト", "系列店", "姉妹店"]



# #1273 【仕様】目視検証の結果（人が audit_sample_strict を1件ずつ読んで付けた判定）。
# 判定基準は「一致した店名が、その動画で実際に映っている店か」。
# TP=真陽性 / FP=偽陽性 / AMB=まとめ動画で複数店を扱っており1店に帰属できない。
MANUAL_VERDICTS = {
    "RJp5Xa1wxgs": ("TP", "ハイウェイ食堂＝動画の主題の店"),
    "kREPX5GuM5c": ("TP", "大同門阪急三番街店＝概要欄の「店舗名:」欄"),
    "L6zfQzrfXas": ("TP", "しょうが焼き華蔵寺亭＝ハッシュタグだが主題の店"),
    "0C7NCM8FWL0": ("FP", "実際の店は『かって屋昭和ごはん』。一致したのは「関連動画のご紹介」に並ぶ他店"),
    "jAeKDup7-es": ("TP", "讃岐うどん やなぎ屋＝主題の店"),
    "dDrq60tyHk0": ("TP", "「撮影協力」表記だが撮影場所そのものなので真陽性。クレジット語＝偽陽性ではない"),
    "AOygQhRzOD8": ("TP", "らーめん家きらく＝主題の店"),
    "JeD1vsd0wOY": ("FP", "ドローン空撮動画。池の平ホテルは風景のハッシュタグで飲食動画ですらない"),
    "ObVehPnFk2A": ("TP", "そば処三国＝主題の店"),
    "MMhmr4xkNC4": ("FP", "実際の店は『大須せろり 大須店』。一致したのは住所行の「愛知県名古屋市」（住所ゴミ辞書項目の取り残し）"),
    "htLXppHzBo0": ("TP", "山口お好み屋＝主題の店"),
    "E2uWbvZgv_o": ("FP", "実際の店は『藤村家』。一致した3件は「跡地」「近くには」で言及された近隣店"),
    "9O2aPMfsj6s": ("AMB", "札幌ラーメンTOP5のまとめ動画。麺屋幸咲は5店中の1店で、動画全体を1店に帰属できない"),
    "iF5SL7co1V0": ("TP", "トマチキ食堂＝主題の店"),
    "pAledeTynp8": ("FP", "実際の店は『ら～めん日可里』。一致したのは住所行の「千葉県木更津」（住所ゴミ辞書項目の取り残し）"),
}

def sha_rank(video_id: str) -> str:
    """#1273 【設計】抽出は SHA-256(id) 昇順の先頭N件。誰が何度やっても同じ300本になる。"""
    return hashlib.sha256(video_id.encode("utf-8")).hexdigest()


def fetch_meta(video_id: str, timeout: int) -> dict:
    cmd = [sys.executable, str(YT_DLP), *YT_ARGS,
           f"https://www.youtube.com/watch?v={video_id}"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"id": video_id, "error": "timeout"}
    if not proc.stdout.strip():
        last = proc.stderr.strip().splitlines()[-1][:160] if proc.stderr.strip() else "empty"
        return {"id": video_id, "error": last}
    try:
        d = json.loads(proc.stdout.splitlines()[-1])
    except json.JSONDecodeError:
        return {"id": video_id, "error": "json_decode_error"}
    return {
        "id": video_id,
        "title": d.get("title") or "",
        "desc": d.get("description") or "",
        "tags": d.get("tags") or [],
        "channel": d.get("channel") or d.get("uploader") or "",
        "duration": d.get("duration"),
    }


def desc_head(desc: str, limit: int = 300) -> str:
    """概要欄の冒頭ブロック（最初のURLの手前、最大limit字）だけを返す。"""
    m = re.search(r"https?://", desc)
    head = desc[: m.start()] if m else desc
    return head[:limit]


def is_address_like(key: str, matcher: NameMatcher) -> bool:
    """辞書項目そのものが住所（地名）である行を判定する。"""
    loc, region = matcher.area.get(key, ("", ""))
    for a in (loc, region):
        if a and len(a) >= 2 and a in key:
            return True
    return False


def context_of(text: str, key: str, matcher: NameMatcher, width: int = 60) -> str:
    """正規化前のテキストから、一致した店名の周辺文字列を取り出す（目視検証用）。"""
    orig = matcher.original.get(key, key)
    idx = text.find(orig)
    if idx < 0:
        # 正規化で変形している場合は正規化テキスト上で探す
        ntext = normalize_ja(text)
        j = ntext.find(key)
        if j < 0:
            return ""
        return ntext[max(0, j - width): j + len(key) + width]
    return text[max(0, idx - width): idx + len(orig) + width]


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 概要欄で店舗特定率を引き上げられるか")
    ap.add_argument("--sample", type=int, default=300)
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--timeout", type=int, default=60)
    ap.add_argument("--recount", action="store_true", help="取得せずキャッシュだけで再集計")
    ap.add_argument("--out", type=Path, default=HERE / "out" / f"{SLUG}.json")
    args = ap.parse_args()

    matcher = NameMatcher()

    # --- 1. 母集団: crawl 済み 110,696本 ---
    state = json.loads(STATE.read_text(encoding="utf-8"))
    videos = []
    for cid, ch in state["channels"].items():
        cname = ch.get("channel") or ""
        for v in ch.get("videos") or []:
            if v.get("id") and v.get("title"):
                videos.append({"id": v["id"], "title": v["title"],
                               "channel_id": cid, "channel": cname})
    # 同一IDの重複を落とす
    seen = set()
    uniq = []
    for v in videos:
        if v["id"] in seen:
            continue
        seen.add(v["id"])
        uniq.append(v)
    videos = uniq
    print(f"[pop] 動画 {len(videos):,}本（重複除去後）", file=sys.stderr)

    # --- 2. baseline: タイトルのみで match_corroborated ---
    title_hit = []
    title_miss = []
    n_title_addr_only = 0
    for v in videos:
        hs = matcher.match_corroborated(v["title"])
        if hs:
            title_hit.append(v)
            if all(is_address_like(h, matcher) for h in hs):
                n_title_addr_only += 1
        else:
            title_miss.append(v)
    base_rate = 100.0 * len(title_hit) / len(videos)
    # 住所ゴミ辞書項目だけで一致した動画を除いた baseline（追加分と同じ規則で比較するため）
    base_rate_filtered = 100.0 * (len(title_hit) - n_title_addr_only) / len(videos)
    print(f"[base] タイトルのみ: {len(title_hit):,}/{len(videos):,} = {base_rate:.2f}% "
          f"(住所ゴミ除外後 {base_rate_filtered:.2f}%)", file=sys.stderr)

    # --- 3. タイトルで特定できなかった動画から決定的に N 件 ---
    title_miss.sort(key=lambda v: sha_rank(v["id"]))
    sample = title_miss[:args.sample]

    cache: dict[str, dict] = {}
    if CACHE.exists():
        cache = json.loads(CACHE.read_text(encoding="utf-8"))
        print(f"[cache] 既取得 {len(cache):,}件", file=sys.stderr)

    if not args.recount:
        todo = [v for v in sample if v["id"] not in cache or cache[v["id"]].get("error")]
        lock = threading.Lock()
        done = [0]
        t0 = time.time()

        def work(v: dict) -> dict:
            r = fetch_meta(v["id"], args.timeout)
            with lock:
                cache[v["id"]] = r
                done[0] += 1
                if done[0] % 25 == 0:
                    el = time.time() - t0
                    print(f"[fetch] {done[0]}/{len(todo)} ({el:.0f}s)", file=sys.stderr)
            return r

        if todo:
            print(f"[fetch] {len(todo)}本を並列{args.concurrency}で取得", file=sys.stderr)
            with cf.ThreadPoolExecutor(max_workers=args.concurrency) as ex:
                list(ex.map(work, todo))
            CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")

    # --- 4. 概要欄・タグ・チャンネル名を足して再判定 ---
    n_fetch_ok = n_fetch_err = 0
    results = []
    for v in sample:
        m = cache.get(v["id"]) or {"error": "not_fetched"}
        if m.get("error"):
            n_fetch_err += 1
            results.append({**v, "fetch_error": m["error"], "new_hits": []})
            continue
        n_fetch_ok += 1
        desc = m.get("desc") or ""
        tags = " ".join(m.get("tags") or [])
        chan = m.get("channel") or v["channel"]
        # #1273 【設計】タイトルで既に落ちている前提なので、追加分だけを見る。
        # 単位ごとに分けて「どこが効いたか」を出せるようにする。
        parts = {
            "desc": desc,
            "tags": tags,
            "channel": chan,
            # タイトル＋概要欄の合成。地名がタイトル側、店名が概要欄側にある動画を拾う。
            "title+desc": v["title"] + "\n" + desc,
            "title+tags+channel": v["title"] + "\n" + tags + "\n" + chan,
            # #1273 【バグ】概要欄全文を使うと偽陽性が支配的になる。実測した偽陽性は
            # (a) 「関連動画」「人気の動画」等の他動画リンク集に並ぶ他店名、
            # (b) 「〜跡地」「近くには」等の近隣店への言及、
            # (c) ハシゴ酒動画の末尾に並ぶ市内店舗一覧。
            # いずれも概要欄の「最初のURLより後ろ」に出る。冒頭ブロック（最初のURLの手前、
            # 最大300字）だけに限定すれば、その動画で扱っている店だけが残るはず、として検証する。
            "title+desc_head": v["title"] + "\n" + desc_head(desc),
        }
        hits_by_part = {k: sorted(matcher.match_corroborated(t)) for k, t in parts.items()}
        # #1273 【バグ】目視検証で見つけた偽陽性の主因。POI辞書には「那覇市首里」
        # 「愛知県名古屋市」「大阪市北区梅田」のように、**住所そのものが店名として
        # 登録されている行**が混ざっている。概要欄はほぼ必ず住所ブロックを含むので、
        # この種のゴミ辞書項目が必ず一致し、しかも locality/region の裏取りは
        # 「自分自身が地名」なので絶対に通ってしまい弾けない。
        # 店名がその店自身の locality か region を部分文字列として含むものは
        # 住所由来のゴミとみなして落とす（実店名が自市名を丸ごと含む例は稀）。
        hits_by_part = {k: [h for h in hs if not is_address_like(h, matcher)]
                        for k, hs in hits_by_part.items()}
        allhits = sorted({h for hs in hits_by_part.values() for h in hs})
        results.append({**v, "desc_len": len(desc), "n_tags": len(m.get("tags") or []),
                        "meta_channel": chan,
                        "hits_by_part": {k: h for k, h in hits_by_part.items() if h},
                        "new_hits": allhits,
                        "strict_hits": hits_by_part["title+desc_head"],
                        "hit_names": [matcher.original.get(h, h) for h in allhits],
                        "desc_head": desc_head(desc)})

    newly = [r for r in results if r["new_hits"]]
    n_new = len(newly)
    lift_rate = 100.0 * n_new / n_fetch_ok if n_fetch_ok else 0.0
    strict_newly = [r for r in results if r.get("strict_hits")]
    n_strict = len(strict_newly)
    strict_rate = 100.0 * n_strict / n_fetch_ok if n_fetch_ok else 0.0

    # 全体の特定率への効き: タイトル陰性の (100-base)% に lift_rate を掛けて足す
    projected = base_rate + (100.0 - base_rate) * lift_rate / 100.0
    projected_strict = base_rate + (100.0 - base_rate) * strict_rate / 100.0

    # 経路別の寄与
    by_part = {}
    for k in parts:
        by_part[k] = sum(1 for r in results if r.get("hits_by_part", {}).get(k))

    # --- 5. 目視検証用サンプル（無作為15件、クレジット文脈フラグ付き） ---
    def build_audit(src: list[dict], field: str) -> list[dict]:
        rnd = random.Random(1273)
        pool = list(src)
        rnd.shuffle(pool)
        rows = []
        for r in pool[:15]:
            m = cache[r["id"]]
            full = r["title"] + "\n" + (m.get("desc") or "") + "\n" + " ".join(m.get("tags") or [])
            for key in r[field]:
                ctx = context_of(full, key, matcher)
                rows.append({
                    "video_id": r["id"],
                    "url": f"https://www.youtube.com/watch?v={r['id']}",
                    "title": r["title"],
                    "channel": r.get("meta_channel"),
                    "matched_name": matcher.original.get(key, key),
                    "matched_via": [k for k, h in r["hits_by_part"].items() if key in h],
                    "context": ctx.replace("\n", " / "),
                    "credit_flag": [w for w in CREDIT_WORDS if w in ctx],
                })
        return rows

    audit = build_audit(newly, "new_hits")
    audit_strict = build_audit(strict_newly, "strict_hits")

    # --- 6. コスト評価 ---
    # チャンネル1コールで平均何本のタイトルが取れるか（既存 crawl の実測）
    per_channel = len(videos) / len(state["channels"])
    calls_per_new = (n_fetch_ok / n_new) if n_new else float("inf")

    # --- 7. 目視検証の集計と、精度で割り引いた実効値 ---
    vids = {a["video_id"] for a in audit_strict}
    tp = sum(1 for v in vids if MANUAL_VERDICTS.get(v, ("", ""))[0] == "TP")
    fp = sum(1 for v in vids if MANUAL_VERDICTS.get(v, ("", ""))[0] == "FP")
    amb = sum(1 for v in vids if MANUAL_VERDICTS.get(v, ("", ""))[0] == "AMB")
    prec = tp / len(vids) if vids else 0.0
    eff_lift = strict_rate * prec / 100.0          # 精度で割り引いた追加同定率（対タイトル陰性）
    eff_projected = 9.0 + (100.0 - 9.0) * eff_lift  # #1273 既知 baseline 9.0% を起点に換算
    # 1コールあたりの同定数で比較する。チャンネル1コールはタイトルを平均276.7本返す。
    per_call_channel = per_channel * base_rate / 100.0
    per_call_desc = eff_lift
    out_extra = {
        "manual_audit": {
            "audited_videos": len(vids), "TP": tp, "FP": fp, "AMB": amb,
            "precision_pct": round(100.0 * prec, 1),
            "verdicts": {v: MANUAL_VERDICTS.get(v, ("?", "")) for v in sorted(vids)},
        },
        "effective": {
            "precision_adjusted_lift_pct_of_title_negative": round(100.0 * eff_lift, 2),
            "projected_overall_pct_from_baseline_9_0": round(eff_projected, 2),
        },
        "cost_comparison": {
            "identifications_per_channel_list_call": round(per_call_channel, 2),
            "identifications_per_video_metadata_call": round(per_call_desc, 4),
            "channel_call_advantage_x": round(per_call_channel / per_call_desc, 1) if per_call_desc else None,
            "calls_per_true_new_identification": round(1.0 / per_call_desc, 1) if per_call_desc else None,
            "calls_to_cover_full_crawl": len(videos),
            "measured_sec_per_video_at_conc3": 1.63,
            "hours_to_cover_full_crawl": round(len(videos) * 1.63 / 3600, 1),
        },
    }

    out = {
        "slug": SLUG,
        "population_videos": len(videos),
        "population_channels": len(state["channels"]),
        "baseline_title_only": {"hits": len(title_hit), "n": len(videos), "rate_pct": round(base_rate, 2),
                                "addr_garbage_only_hits": n_title_addr_only,
                                "rate_pct_addr_filtered": round(base_rate_filtered, 2)},
        "sample": {"requested": args.sample, "fetched_ok": n_fetch_ok, "fetch_error": n_fetch_err,
                   "fetch_success_pct": round(100.0 * n_fetch_ok / len(sample), 1)},
        "lift": {"newly_identified": n_new, "rate_pct": round(lift_rate, 2),
                 "projected_overall_pct": round(projected, 2)},
        "lift_strict": {"newly_identified": n_strict, "rate_pct": round(strict_rate, 2),
                        "projected_overall_pct": round(projected_strict, 2)},
        "by_part": by_part,
        "cost": {
            "calls_per_new_identification": round(calls_per_new, 1) if n_new else None,
            "videos_per_channel_call": round(per_channel, 1),
            "title_identifications_per_channel_call": round(per_channel * base_rate / 100.0, 2),
            "desc_identifications_per_video_call": round(lift_rate / 100.0, 4),
        },
        **out_extra,
        "audit_sample": audit,
        "audit_sample_strict": audit_strict,
        "results": results,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({k: v for k, v in out.items() if k not in ("results", "audit_sample")},
                     ensure_ascii=False, indent=2))
    print(f"\n[out] {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
