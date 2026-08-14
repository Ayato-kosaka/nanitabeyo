#!/usr/bin/env python3
"""#1273 厳格版 judge の下振れは「概要欄が見えていないせい」なのかを実測する

## なぜ

`measure_seed_youtube_ceiling.py` の厳格版 judge は **タイトルだけ**で地名の裏取りをする。
`--flat-playlist` / 検索結果は概要欄を返さないからである。
厳格版はリンク層 16.22% / リンク無し層 5.00% と、緩い判定 27.33% / 25.33% を大きく下回る。
この差が**実態**なのか**概要欄が見えていないだけ**なのかを分けないと、実効天井の誤差が残る。

## 測るもの

`out/seed_youtube_ceiling.json` の 300 行のうち、

  - `hit=True` かつ `hit_strict=False` … 地名の手がかりはあるがタイトルに出ていない
    → **概要欄で救えるかもしれない**（本スクリプトの対象）
  - `hit=True` かつ `hit_strict=None` … seed の locality が空で裏取り不能
    → 概要欄では救えない（母集団側の欠損）。件数だけ数える

前者について yt-dlp で1本ずつメタデータを取り、**概要欄に市区町村トークンが出るか**を見る。

## 注意

- `--flat-playlist` を外すと1動画1リクエストになる。#1313 で「概要欄経由は
  店舗特定率 9.0%→13.2% だがコスト496倍」として本番採用は却下済み。
  ここでやるのは**本番導入ではなく、厳格版の下振れ幅を正しく知るための測定**である。
- 本環境では既定の player client が bot 判定で弾かれるため `player_client=android` を使う。
- 1.5秒間隔の直列で叩く。

実行:
    python3 measure_description_corroboration.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_seed_youtube_ceiling import locality_needle, normalize  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
YT_DLP = Path("/tmp/yt-dlp-latest")
SLEEP = 1.5


def fetch_meta(video_id: str) -> tuple[dict | None, str | None]:
    cmd = [sys.executable, str(YT_DLP), "-J", "--no-warnings", "--skip-download",
           "--extractor-args", "youtube:player_client=android",
           f"https://www.youtube.com/watch?v={video_id}"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired:
        return None, "timeout"
    out = proc.stdout.strip()
    if not out:
        return None, (proc.stderr.strip().splitlines()[-1][:120] if proc.stderr.strip()
                      else "empty")
    try:
        return json.loads(out.splitlines()[-1]), None
    except json.JSONDecodeError:
        return None, "json_decode_error"


def main() -> None:
    src = OUT_DIR / "seed_youtube_ceiling.json"
    if not src.exists():
        raise SystemExit(f"厳格版の測定結果が無い: {src}")
    data = json.loads(src.read_text(encoding="utf-8"))

    # #1273 【自戒】最初 row の `locality` を読もうとしたが、
    # `seed_youtube_ceiling.json` の results 行に locality は入っていない。
    # 気付かず回して needle が全件空になり、「概要欄では1件も救えない」という
    # **測定の不備を実態と取り違えかけた**。seed_id で seed キャッシュから引く。
    cache = json.loads((OUT_DIR / "seed_strata_sample.json").read_text(encoding="utf-8"))
    loc_by_seed = {s["seed_id"]: (s.get("locality") or "")
                   for rows in cache["sample"].values() for s in rows}

    targets = []
    n_undecidable = {"with_overture": 0, "without_overture": 0}
    for layer, rows in data["results"].items():
        for r in rows:
            if not r.get("hit"):
                continue
            if r.get("hit_strict") is None:
                n_undecidable[layer] += 1
                continue
            if r.get("hit_strict") is False and r.get("best_match"):
                targets.append({"layer": layer, "name": r["name"],
                                "locality": loc_by_seed.get(r["seed_id"], ""),
                                "video_id": r["best_match"]["video_id"],
                                "title": r["best_match"]["title"]})

    print(f"対象（緩い判定でヒット、厳格版で不ヒット）: {len(targets)} 本", file=sys.stderr)
    print(f"判定不能（seed の locality が空。概要欄では救えない）: "
          f"{n_undecidable}", file=sys.stderr)

    rows_out = []
    n_rescued = n_fetch_fail = 0
    errs: dict[str, int] = {}
    for i, t in enumerate(targets, 1):
        raw_loc = t["locality"]
        needle = normalize(locality_needle(raw_loc))
        meta, err = fetch_meta(t["video_id"])
        time.sleep(SLEEP)
        if meta is None:
            n_fetch_fail += 1
            errs[str(err).split(":")[0][:40]] = errs.get(str(err).split(":")[0][:40], 0) + 1
            rows_out.append({**t, "needle": needle, "error": err, "rescued": None})
            continue
        desc = meta.get("description") or ""
        blob = normalize(t["title"] + " " + desc)
        rescued = bool(needle) and needle in blob and needle not in normalize(t["title"])
        if rescued:
            n_rescued += 1
        rows_out.append({**t, "needle": needle, "error": None,
                         "desc_len": len(desc), "rescued": rescued,
                         "desc_head": desc[:160]})
        print(f"  [{i}/{len(targets)}] {t['name'][:14]:16} needle={needle or '-':8} "
              f"desc {len(desc):>5}字 -> {'救済' if rescued else '不可'}", file=sys.stderr)

    n_ok = len(targets) - n_fetch_fail
    rate = n_rescued / max(n_ok, 1)
    print(f"\n=== 概要欄で厳格版が救えるか ===", file=sys.stderr)
    print(f"  取得できた       : {n_ok}/{len(targets)}", file=sys.stderr)
    if errs:
        print(f"  取得失敗の内訳   : {errs}", file=sys.stderr)
    print(f"  概要欄で裏取りできた: {n_rescued} = **{rate * 100:.1f}%**", file=sys.stderr)
    print(f"\n  → 厳格版の不ヒットのうち {rate * 100:.1f}% は"
          f"「タイトルに地名が無かっただけ」だった。", file=sys.stderr)
    print(f"  ※ locality が空で判定不能な {sum(n_undecidable.values())} 件は"
          f"概要欄では救えない（母集団側の欠損）。", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "description_corroboration.json"
    out_path.write_text(
        json.dumps({"n_targets": len(targets), "n_fetched": n_ok,
                    "n_rescued": n_rescued, "rescue_rate": rate,
                    "n_undecidable_by_layer": n_undecidable,
                    "fetch_errors": errs, "rows": rows_out,
                    "caveat": "本番導入の話ではない。#1313 で概要欄経路はコスト496倍として"
                              "却下済み。ここは厳格版の下振れ幅を知るための測定。"},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
