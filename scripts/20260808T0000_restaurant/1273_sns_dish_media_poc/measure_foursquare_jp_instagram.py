#!/usr/bin/env python3
"""#1653 Foursquare OS Places 本家に、日本の飲食 POI と Instagram が何件あるか

## なぜ

Overture の Instagram 13,882 件は **100% Foursquare 由来**で、しかも
**Overture は Foursquare を日本の飲食 POI の 10.88%（85,913/789,612）しか取り込んでいない**
（別調査 `out/ig_handle_source_ideas.md`）。

**本家に 85,913 件より多くあれば、その差がハンドルの純増になる。**
本家も同数なら純増ゼロ。**この1つの数字で、この案の成否が決まる。**

## ライセンス（一次資料で確認済み）

`s3://fsq-os-places-us-east-1/LICENSE.txt` が **Apache License 2.0**、
`NOTICE.txt` が「帰属として NOTICE.txt 全文を保持すること」と定める。**商用利用可。**
ポータル各社と違い、規約の壁が無い。

## 測り方

最新リリース `dt=2026-08-11` の places parquet **100 シャード**を、
**1つずつ落として数えて消す**（全部置くと 11.3GB になるため）。
`httpfs` はこのコンテナで導入できない（`extensions.duckdb.org` が 403）ので、
`curl` で落として duckdb のローカル parquet 読みで数える。

数えるもの（すべて `country='JP'`）:

    jp_all                     日本の POI 全部
    jp_dining                  `fsq_category_labels` が `Dining and Drinking` で始まる
    jp_dining_open             ↑ かつ `date_closed IS NULL`
    jp_dining_instagram        ↑↑ かつ `instagram IS NOT NULL`

## この測定が言えないこと

  - **Foursquare の POI が Overture の店と1対1で対応する保証は無い。**
    「本家のほうが多い」＝「そのぶん純増」ではない。名寄せしないと純増は出ない
  - `instagram` 列の中身が**その店のアカウントか**は別問題（Overture 経由の分では
    目視で 27.8% が別主体だった）

実行:
    python3 measure_foursquare_jp_instagram.py
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import time

import duckdb

HERE = pathlib.Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
TMP = pathlib.Path(os.environ.get("FSQ_TMP", "/tmp/claude-0/-home-user-nanitabeyo/"
                                  "03f6e582-9699-5f1c-87bd-53c206dc6519/scratchpad"))
RELEASE = "2026-08-11"
BASE = ("https://huggingface.co/datasets/foursquare/fsq-os-places/resolve/main/"
        f"release/dt={RELEASE}/places/parquet")
N_SHARDS = 100
OVERTURE_JP_FOOD_FROM_FSQ = 85_913          # 別調査の実測
OVERTURE_JP_FOOD_TOTAL = 789_612
OVERTURE_IG = 13_882

SQL = """
SELECT
  count(*) FILTER (WHERE country='JP') AS jp_all,
  count(*) FILTER (WHERE country='JP' AND dining) AS jp_dining,
  count(*) FILTER (WHERE country='JP' AND dining AND date_closed IS NULL) AS jp_dining_open,
  count(*) FILTER (WHERE country='JP' AND dining AND date_closed IS NULL
                   AND instagram IS NOT NULL) AS jp_dining_open_ig,
  count(*) FILTER (WHERE country='JP' AND dining AND instagram IS NOT NULL) AS jp_dining_ig
FROM (
  SELECT country, date_closed, instagram,
    list_contains(list_transform(fsq_category_labels,
      x -> starts_with(x, 'Dining and Drinking')), true) AS dining
  FROM read_parquet('{path}')
)
"""


def main() -> None:
    tok = (OUT_DIR / ".hf_token").read_text().strip()
    con = duckdb.connect()
    tot = {k: 0 for k in ("jp_all", "jp_dining", "jp_dining_open",
                          "jp_dining_open_ig", "jp_dining_ig")}
    done, t0 = 0, time.time()
    TMP.mkdir(parents=True, exist_ok=True)
    for i in range(N_SHARDS):
        url = f"{BASE}/places_{i:06d}.parquet"
        p = TMP / f"fsq_{i:03d}.parquet"
        r = subprocess.run(["curl", "-sL", url, "-H", f"Authorization: Bearer {tok}",
                            "-o", str(p), "-w", "%{http_code}"],
                           capture_output=True, timeout=1800)
        code = r.stdout.decode().strip()
        if code != "200" or not p.exists() or p.stat().st_size < 1_000_000:
            print(f"  [{i:>3}] 取得失敗 http={code}", file=sys.stderr, flush=True)
            p.unlink(missing_ok=True)
            continue
        row = con.execute(SQL.format(path=str(p))).fetchone()
        for k, v in zip(tot, row):
            tot[k] += v
        p.unlink(missing_ok=True)
        done += 1
        el = time.time() - t0
        print(f"  [{i+1:>3}/{N_SHARDS}] 日本 {tot['jp_all']:>7,} / 飲食 "
              f"{tot['jp_dining']:>7,} / 営業中 {tot['jp_dining_open']:>7,} / "
              f"IG {tot['jp_dining_open_ig']:>6,}  ({el/60:.1f}分)",
              file=sys.stderr, flush=True)

    print(f"\n=== Foursquare 本家（{RELEASE}）・{done}/{N_SHARDS} シャード ===",
          file=sys.stderr)
    for k, v in tot.items():
        print(f"  {k:20} {v:>9,}", file=sys.stderr)
    if tot["jp_dining_open"]:
        print(f"\n  営業中の飲食に占める Instagram 保有率 "
              f"**{tot['jp_dining_open_ig']/tot['jp_dining_open']*100:.2f}%**", file=sys.stderr)
    print(f"\n=== Overture との比較 ===", file=sys.stderr)
    print(f"  Overture が FSQ から取り込んだ日本の飲食 {OVERTURE_JP_FOOD_FROM_FSQ:,}",
          file=sys.stderr)
    print(f"  **本家の日本の飲食（営業中） {tot['jp_dining_open']:,}**", file=sys.stderr)
    d = tot["jp_dining_open"] - OVERTURE_JP_FOOD_FROM_FSQ
    print(f"  差 **{d:+,}**", file=sys.stderr)
    print(f"  Overture 経由の Instagram {OVERTURE_IG:,} / "
          f"**本家 {tot['jp_dining_open_ig']:,}** → 差 "
          f"**{tot['jp_dining_open_ig']-OVERTURE_IG:+,}**", file=sys.stderr)

    p = OUT_DIR / "foursquare_jp_instagram.json"
    p.write_text(json.dumps(
        {"release": RELEASE, "shards_done": done, "shards_total": N_SHARDS,
         **tot,
         "overture_jp_food_from_fsq": OVERTURE_JP_FOOD_FROM_FSQ,
         "overture_jp_food_total": OVERTURE_JP_FOOD_TOTAL,
         "overture_instagram": OVERTURE_IG,
         "license": "Apache-2.0（NOTICE.txt 全文の保持による帰属表示が条件）",
         "caveat": "Foursquare の POI が Overture の店と1対1で対応する保証は無い。"
                   "『本家のほうが多い』＝『そのぶん純増』ではなく、名寄せが要る。"
                   "instagram 列がその店のアカウントかも別問題。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
