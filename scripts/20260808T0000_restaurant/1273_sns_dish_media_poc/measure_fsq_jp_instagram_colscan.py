#!/usr/bin/env python3
"""#1653 — Foursquare OS Places 本家から、日本の店の Instagram ハンドルを数えて取り出す

## なぜ 3 回目なのか。前の 2 回は測定になっていなかった

  1回目: シャード 100 本を丸ごと落とす方式。**96/100 が HTTP 429 で落ちず**、
         「日本の飲食 35 件」という無意味な数字を出した
  2回目: 同じ方式で再実行。**やはり 96/100 が 429**。同じ失敗を繰り返した
  3回目: HuggingFace の `datasets-server /filter` に切り替えた。
         **`jp_all → 100`、`jp_instagram → 0`** という明らかにおかしい値が返り、
         その後は `A query parameter is invalid` / `Unexpected error.` しか返らなくなった。
         `/size` は正常に 109,255,094 行を返すので、**このデータセットの filter
         インデックスが壊れている**。数字は破棄した

## 今回の方式 — 列だけを範囲読みする

全 11GB を落とす必要は無い。必要なのは `country` / `instagram` / `date_closed` /
`fsq_category_labels` の 4 列だけである。parquet は列ごとに固まって並んでいるので、
**行グループ単位でその列のバイト範囲だけを HTTP Range で取れば済む**。

さらに Foursquare のシャードは**国ごとに固まっている**ことが分かっている。
そこで行グループごとに **まず `country` だけ読み、JP が 1 件も無ければ他の列は読まない**。
これで日本以外の行グループは `country` 列のぶんしか転送しない。

429 は `huggingface_hub` が指数バックオフで自動再試行する（前 2 回の敗因はここ）。

## この測定が言えないこと

  - **Foursquare に `instagram` が入っている＝そのアカウントが本当にその店のものである、
    ではない。** #1269 で測った誤紐付けの問題はそのまま残る
  - 料理写真が写っているかは別問題で、ここでは測らない

実行:
    HF_TOKEN=... python3 measure_fsq_jp_instagram_colscan.py
"""

from __future__ import annotations

import csv
import json
import os
import pathlib
import sys
import time

RELEASE = "2026-08-11"
HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "out"
BASE = f"datasets/foursquare/fsq-os-places/release/dt={RELEASE}/places/parquet"
COLS_FIRST = ["country"]
COLS_REST = ["fsq_place_id", "name", "instagram", "website", "date_closed",
             "fsq_category_labels", "locality", "region"]
FOOD = ("restaurant", "food", "cafe", "coffee", "bar", "bakery", "dining",
        "diner", "pizzeria", "steakhouse", "izakaya", "noodle", "sushi")


def is_food(labels) -> bool:
    if labels is None:
        return False
    s = " ".join(str(x) for x in labels).lower()
    return any(w in s for w in FOOD)


def main() -> None:
    from huggingface_hub import HfFileSystem
    import pyarrow.parquet as pq

    tokf = OUT / ".hf_token"
    tok = os.environ.get("HF_TOKEN") or (
        tokf.read_text().strip().splitlines()[0].strip() if tokf.exists() else None)
    if not tok:
        raise SystemExit("HF_TOKEN がありません")

    fs = HfFileSystem(token=tok)
    files = sorted(fs.ls(BASE, detail=False))
    print(f"シャード {len(files)} 本", file=sys.stderr, flush=True)

    csv_path = OUT / "fsq_jp_instagram.csv"
    state_path = OUT / "fsq_colscan_state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {
        "done_shards": [], "jp_all": 0, "jp_open": 0, "jp_ig": 0,
        "jp_open_ig": 0, "jp_food": 0, "jp_food_ig": 0, "jp_food_open_ig": 0}
    done = set(state["done_shards"])

    fh = csv_path.open("a", newline="", encoding="utf-8")
    w = csv.writer(fh)
    if csv_path.stat().st_size == 0:
        w.writerow(["fsq_place_id", "name", "instagram", "website",
                    "locality", "region", "date_closed", "is_food"])

    t0 = time.time()
    for si, path in enumerate(files):
        if si in done:
            continue
        try:
            with fs.open(path, "rb") as f:
                pf = pq.ParquetFile(f)
                for g in range(pf.metadata.num_row_groups):
                    c = pf.read_row_group(g, columns=COLS_FIRST).column("country").to_pylist()
                    idx = [i for i, v in enumerate(c) if v == "JP"]
                    if not idx:
                        continue
                    t = pf.read_row_group(g, columns=COLS_REST)
                    cols = {n: t.column(n).to_pylist() for n in COLS_REST}
                    for i in idx:
                        ig = cols["instagram"][i]
                        closed = cols["date_closed"][i]
                        food = is_food(cols["fsq_category_labels"][i])
                        state["jp_all"] += 1
                        if not closed:
                            state["jp_open"] += 1
                        if ig:
                            state["jp_ig"] += 1
                            if not closed:
                                state["jp_open_ig"] += 1
                        if food:
                            state["jp_food"] += 1
                            if ig:
                                state["jp_food_ig"] += 1
                                if not closed:
                                    state["jp_food_open_ig"] += 1
                        if ig:
                            w.writerow([cols["fsq_place_id"][i], cols["name"][i], ig,
                                        cols["website"][i], cols["locality"][i],
                                        cols["region"][i], closed, int(food)])
        except Exception as e:                                   # noqa: BLE001
            print(f"  shard {si} 失敗: {type(e).__name__} {str(e)[:120]}",
                  file=sys.stderr, flush=True)
            continue
        state["done_shards"].append(si)
        fh.flush()
        state_path.write_text(json.dumps(state, ensure_ascii=False))
        print(f"  [{len(state['done_shards']):>3}/{len(files)}] shard {si:>3} "
              f"日本 {state['jp_all']:>8,} / IG {state['jp_ig']:>7,} / "
              f"飲食IG {state['jp_food_ig']:>6,} ({time.time()-t0:.0f}s)",
              file=sys.stderr, flush=True)

    fh.close()
    n = len(state["done_shards"])
    result = {
        "purpose": "#1653 Foursquare OS Places 本家の日本 × instagram 実数",
        "release": RELEASE, "shards_done": n, "shards_total": len(files),
        "complete": n == len(files),
        "method": "列射影＋行グループ単位の country 事前判定で HTTP Range 読み",
        **{k: v for k, v in state.items() if k != "done_shards"},
        "caveat": ("instagram フィールドが入っている＝そのアカウントが本当にその店のもの、"
                   "ではない。#1269 の誤紐付けの問題はそのまま残る"),
    }
    (OUT / "fsq_jp_instagram_counts.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2))
    print(f"\n=== {n}/{len(files)} シャード ===", file=sys.stderr)
    for k in ("jp_all", "jp_open", "jp_ig", "jp_open_ig",
              "jp_food", "jp_food_ig", "jp_food_open_ig"):
        print(f"  {k:16s} {state[k]:>9,}", file=sys.stderr)


if __name__ == "__main__":
    main()
