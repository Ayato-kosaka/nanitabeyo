#!/usr/bin/env python3
"""#1273 Round8: 確立手法（スノーボール＋チャンネル逆走査）のスケールアップ実測

アイデア検証ではなく**実行**。400ch までしか回していなかったクロールを
1,200ch に向けて進め、到達点で以下を実測する。

  1. 到達チャンネル数での distinct 店舗 / dish_media pair
  2. 400ch 時点の式で到達点を予測 -> 実測と比較（外挿が当たったか）
  3. 供給上限 S=20.6% で頭打ちさせた飽和モデルとの乖離（飽和が早いか遅いか）
  4. スノーボールのチャンネル発見が枯れていないか（新規ch/ラウンドの推移）

# #1273 【設計】曲線は **発見順（state の挿入順）** で引く。state の先頭400件は
# 400ch 時点の資産そのものなので、「先頭400件だけで引いた式」が当時の外挿式に相当し、
# その式で到達点を予測して実測と比べれば外挿の当否を厳密に検証できる。
# チャンネルIDのソート順で引くと先頭400件が当時の400chと別物になり検証にならない。
"""

from __future__ import annotations

import argparse
import collections
import json
import math
import random
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from measure_channel_traversal import NameMatcher, normalize_ja
from measure_dish_media_yield import load_categories, match_categories

HERE = Path(__file__).resolve().parent
# #1273 【仕様】既知の実測定数。母集団は #843 の3ソース統合（Overture ベースの 789,612 店）。
SUPPLY_CEILING = 0.206          # YouTube 供給上限 S=18〜21% の中央値
POPULATION_TOTAL = 789612
BASELINE_CH = 400               # 400ch 時点の資産
BASELINE_DISTINCT = 7575        # 400ch 実測 distinct 店舗
BASELINE_LAW = (47.7, 0.852)    # 400ch 時点で報告したスケール則 distinct = a * ch^b


def heaps_fit(cum: list[int], lo: int = 0, hi: int | None = None) -> dict | None:
    """累積曲線 cum[i] (=i+1 チャンネル時点の distinct) を log-log 線形回帰する。"""
    hi = len(cum) if hi is None else hi
    pts = [(i + 1, cum[i]) for i in range(lo, min(hi, len(cum))) if cum[i] > 0]
    if len(pts) < 10:
        return None
    xs = [math.log(x) for x, _ in pts]
    ys = [math.log(y) for _, y in pts]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    a = math.exp(my - b * mx)
    # 決定係数
    ss_res = sum((y - (math.log(a) + b * x)) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - my) ** 2 for y in ys)
    return {"a": a, "b": b, "r2": 1 - ss_res / ss_tot if ss_tot else None, "n_points": len(pts)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", type=Path, default=HERE / "out" / "crawl_scaleup_state.json")
    ap.add_argument("--log", type=Path, default=HERE / "out" / "crawl_scaleup_crawl.log")
    ap.add_argument("--out", type=Path, default=HERE / "out" / "crawl-scaleup.json")
    args = ap.parse_args()

    matcher = NameMatcher()
    cats = load_categories()
    state = json.loads(args.state.read_text(encoding="utf-8"))
    channels: dict = state["channels"]
    cids = list(channels.keys())          # 発見順（JSON の挿入順が保たれる）
    n_ch = len(cids)
    print(f"[state] channels={n_ch}", file=sys.stderr)

    def restaurants_of(videos: list[dict]) -> set[str]:
        out: set[str] = set()
        for v in videos:
            out |= matcher.match_corroborated(v.get("title") or "")
        return out

    # --- 累積曲線（発見順） ---
    seen: set[str] = set()
    cum: list[int] = []
    per_ch_new: list[int] = []
    for cid in cids:
        before = len(seen)
        seen |= restaurants_of(channels[cid].get("videos", []))
        cum.append(len(seen))
        per_ch_new.append(len(seen) - before)

    # --- dish_media pair と動画統計 ---
    all_videos: dict[str, dict] = {}
    for cid in cids:
        for v in channels[cid].get("videos", []):
            if v.get("id") and v.get("title"):
                all_videos[v["id"]] = {**v, "channel_id": cid,
                                       "channel": channels[cid].get("channel")}
    pairs: set[tuple[str, str]] = set()
    cat_counter: collections.Counter = collections.Counter()
    matched_videos = 0
    samples: list[dict] = []
    for vid, v in all_videos.items():
        rests = matcher.match_corroborated(v["title"])
        if not rests:
            continue
        matched_videos += 1
        cs = match_categories(cats, v["title"])
        for c in cs:
            for rkey in rests:
                pairs.add((rkey, c["dish_category_id"]))
                cat_counter[c["label_ja"]] += 1
        samples.append({"video_id": vid, "title": v["title"], "channel": v["channel"],
                        "restaurants": [matcher.original.get(r, r) for r in rests],
                        "categories": [c["label_ja"] for c in cs]})

    # --- 400ch 式による外挿の検証 ---
    fit400 = heaps_fit(cum, 0, BASELINE_CH)
    fit_full = heaps_fit(cum)
    fit_new = heaps_fit(cum, BASELINE_CH, None)  # 400ch 以降だけで引いた式（減速の検出）
    pred = {}
    if fit400:
        pred["from_fit400"] = fit400["a"] * n_ch ** fit400["b"]
    pred["from_reported_law"] = BASELINE_LAW[0] * n_ch ** BASELINE_LAW[1]
    actual = cum[-1] if cum else 0
    errs = {k: (actual - v) / v for k, v in pred.items()}

    # --- 飽和モデルとの比較 ---
    # #1273 【設計】供給上限 S で頭打ちする飽和モデル: distinct(ch) = S*N * (1 - exp(-ch/tau))。
    # tau は 400ch 時点の実測 (400, 7575) を通るように解く。べき則より下振れしていれば
    # 「飽和が予測より早い」、上振れしていれば「まだ飽和していない」。
    cap = SUPPLY_CEILING * POPULATION_TOTAL
    frac = BASELINE_DISTINCT / cap
    tau = -BASELINE_CH / math.log(1 - frac) if 0 < frac < 1 else None
    sat_pred = cap * (1 - math.exp(-n_ch / tau)) if tau else None

    # --- チャンネル発見の枯れ具合（ログのラウンド行から実測） ---
    rounds = []
    if args.log.exists():
        prev_ch = None
        for line in args.log.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.search(r"\[round (\d+)\] ch=\s*(\d+) 店=\s*(\d+) \(\+(\d+)ch\)", line)
            if m:
                r, ch, rest, add = (int(x) for x in m.groups())
                rounds.append({"round": r, "channels": ch, "restaurants": rest,
                               "new_channels": add,
                               "delta_restaurants": (rest - prev_ch) if prev_ch is not None else None})
                prev_ch = rest
            elif re.search(r"\[round (\d+)\] 新規チャンネルなし", line):
                r = int(re.search(r"\[round (\d+)\]", line).group(1))
                rounds.append({"round": r, "channels": None, "restaurants": None,
                               "new_channels": 0, "delta_restaurants": 0})

    # --- 600店サンプルでのカバレッジ（鉄則1: 同じサンプルで測る） ---
    sample600 = json.loads((HERE / "out" / "supply_ceiling_2026-08-13.json")
                           .read_text(encoding="utf-8"))["results"]
    in_dict = hit = 0
    for r in sample600:
        key = normalize_ja(r["restaurant"]["name"])
        if key in matcher.original:
            in_dict += 1
            if key in seen:
                hit += 1
    cov = hit / len(sample600)

    # --- 目視精度検証用サンプル（400ch 以降に増えた分から無作為12件） ---
    new_cids = set(cids[BASELINE_CH:])
    new_samples = [s for s in samples
                   if all_videos[s["video_id"]]["channel_id"] in new_cids]
    rng = random.Random(1273)
    audit = rng.sample(new_samples, min(12, len(new_samples))) if new_samples else \
        rng.sample(samples, min(12, len(samples)))

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "channels": n_ch,
        "channels_added_this_round": n_ch - BASELINE_CH,
        "videos": len(all_videos),
        "restaurant_matched_videos": matched_videos,
        "distinct_restaurants": actual,
        "dish_media_pairs": len(pairs),
        "restaurants_per_channel": actual / max(n_ch, 1),
        "category_coverage_rate": (sum(1 for s in samples if s["categories"]) /
                                   max(len(samples), 1)),
        "categories_used": len(cat_counter),
        "top_categories": cat_counter.most_common(12),
        "coverage_600_sample": cov,
        "coverage_600_hits": hit,
        "coverage_600_in_dict": in_dict,
        "fit_first400": fit400,
        "fit_full": fit_full,
        "fit_after400": fit_new,
        "reported_law_400ch": {"a": BASELINE_LAW[0], "b": BASELINE_LAW[1]},
        "predictions_at_reached_ch": pred,
        "relative_error_vs_actual": errs,
        "saturation_model": {"cap_restaurants": cap, "tau_channels": tau,
                             "predicted": sat_pred,
                             "relative_error": (actual - sat_pred) / sat_pred if sat_pred else None},
        "extrapolation_10000ch": {
            "power_law_full": fit_full["a"] * 10000 ** fit_full["b"] if fit_full else None,
            "power_law_after400": fit_new["a"] * 10000 ** fit_new["b"] if fit_new else None,
            "saturation": cap * (1 - math.exp(-10000 / tau)) if tau else None,
            "cap": cap,
        },
        "new_restaurants_per_channel_first400": sum(per_ch_new[:BASELINE_CH]) / BASELINE_CH,
        "new_restaurants_per_channel_after400": (
            sum(per_ch_new[BASELINE_CH:]) / max(n_ch - BASELINE_CH, 1)),
        "rounds": rounds,
        "cumulative_curve": cum,
        "audit_sample": audit,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"ch={n_ch} distinct={actual} pairs={len(pairs)} cov600={cov:.4f}", file=sys.stderr)
    print(f"fit400={fit400} -> pred={pred} err={errs}", file=sys.stderr)
    print(f"fit_full={fit_full} fit_after400={fit_new}", file=sys.stderr)
    print(f"sat_pred={sat_pred}", file=sys.stderr)
    for a in audit:
        print(f"  AUDIT {a['title'][:70]} || {a['restaurants']} || {a['categories']}",
              file=sys.stderr)


if __name__ == "__main__":
    main()
