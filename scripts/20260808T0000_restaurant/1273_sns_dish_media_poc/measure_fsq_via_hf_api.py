#!/usr/bin/env python3
"""#1653 Foursquare 本家の件数を、ダウンロードせず HF の datasets-server で数える

## なぜやり直すのか

parquet を 100 シャード落とす方法は **2回とも 96/100 が HTTP 429（HuggingFace の
レート制限）で失敗**した。バックオフを入れても同じだったので、方法を変える。

`datasets-server.huggingface.co` は **`filter: true`** を返しており、
`where` 句で絞った件数（`num_rows_total`）を**ダウンロードせずに**返す。
データセットは **123,505,440 行**あるので、こちらのほうが筋が良い。

## 数えるもの

    country='JP'                                日本の POI 全部
    country='JP' AND instagram IS NOT NULL      うち Instagram を持つもの
    country='JP' AND date_closed IS NULL        うち営業中
    上記の組み合わせ

**比較したい相手**（別調査の実測）:

    Overture が Foursquare から取り込んだ日本の飲食 POI   85,913
    そこから得られた Instagram                          13,882

**本家がこれより多ければ、その差がハンドルの純増になりうる。**

## この測定が言えないこと

  - `filter` は**飲食カテゴリで絞れない**（`fsq_category_labels` が配列のため）。
    したがって出るのは**飲食に限らない日本の POI 全部**である。
    Overture 側の 85,913 は飲食だけなので、**分母が違う。直接は引き算できない**
  - Foursquare の POI が Overture の店と1対1で対応する保証は無い

実行:
    python3 measure_fsq_via_hf_api.py
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import time
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
API = "https://datasets-server.huggingface.co/filter"
QUERIES = {
    "jp_all": "\"country\"='JP'",
    "jp_instagram": "\"country\"='JP' AND \"instagram\" IS NOT NULL",
    "jp_open": "\"country\"='JP' AND \"date_closed\" IS NULL",
    "jp_open_instagram": "\"country\"='JP' AND \"date_closed\" IS NULL AND \"instagram\" IS NOT NULL",
    "world_instagram": "\"instagram\" IS NOT NULL",
}
OVERTURE_JP_FOOD_FROM_FSQ = 85_913
OVERTURE_IG = 13_882


def ask(where: str, tok: str, tries: int = 40) -> int | None:
    """インデックス構築中は 500 が返る。待って取り直す。"""
    qs = urllib.parse.urlencode({
        "dataset": "foursquare/fsq-os-places", "config": "places",
        "split": "train", "where": where, "limit": "1"})
    for t in range(tries):
        r = subprocess.run(["curl", "-s", f"{API}?{qs}",
                            "-H", f"Authorization: Bearer {tok}"],
                           capture_output=True, timeout=600)
        try:
            d = json.loads(r.stdout.decode())
        except Exception:                                        # noqa: BLE001
            d = {}
        if isinstance(d.get("num_rows_total"), int):
            return d["num_rows_total"]
        err = (d.get("error") or "")[:80]
        print(f"      待機 {t+1}/{tries}: {err!r}", file=sys.stderr, flush=True)
        time.sleep(60)
    return None


def main() -> None:
    tok = (OUT_DIR / ".hf_token").read_text().strip()
    res: dict[str, int | None] = {}
    for k, w in QUERIES.items():
        print(f"  {k} …", file=sys.stderr, flush=True)
        res[k] = ask(w, tok)
        print(f"    → {res[k]!r}", file=sys.stderr, flush=True)

    print("\n=== Foursquare 本家（HF datasets-server で集計）===", file=sys.stderr)
    for k, v in res.items():
        print(f"  {k:22} {v if v is None else format(v, ',')}", file=sys.stderr)

    print(f"\n=== Overture との比較 ===", file=sys.stderr)
    print(f"  Overture が FSQ から取り込んだ日本の**飲食** {OVERTURE_JP_FOOD_FROM_FSQ:,}",
          file=sys.stderr)
    print(f"  Overture 経由で得られた Instagram          {OVERTURE_IG:,}", file=sys.stderr)
    if res.get("jp_open_instagram") is not None:
        print(f"  **本家の日本（営業中）で Instagram あり {res['jp_open_instagram']:,}**",
              file=sys.stderr)
        print(f"  差 **{res['jp_open_instagram'] - OVERTURE_IG:+,}**", file=sys.stderr)
    print("\n  ※ 本家側は**飲食に限れていない**（配列カラムで絞れないため）。"
          "分母が違うので単純な引き算にはならない。", file=sys.stderr)

    p = OUT_DIR / "foursquare_jp_instagram.json"
    p.write_text(json.dumps(
        {"method": "HuggingFace datasets-server /filter（ダウンロードせず件数だけ取る）",
         "dataset_rows_total": 123_505_440, **res,
         "overture_jp_food_from_fsq": OVERTURE_JP_FOOD_FROM_FSQ,
         "overture_instagram": OVERTURE_IG,
         "license": "Apache-2.0（NOTICE.txt 全文の保持による帰属表示が条件）",
         "caveat": "本家側は飲食カテゴリで絞れていない（fsq_category_labels が配列で "
                   "filter が効かないため）。Overture 側の 85,913 は飲食だけなので"
                   "**分母が違い、直接は引き算できない**。"
                   "また FSQ の POI が Overture の店と1対1で対応する保証も無い。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
