#!/usr/bin/env python3
"""#1273 リンク無し層の厳格版が低いのは「seed に locality が無い」せいなのかを全数で測る

## なぜ

`measure_description_corroboration.py` で、緩い判定ではヒットしたのに
**厳格版が判定不能**（seed の locality が空で地名の裏取りができない）だった行が 30件あり、
**うち 29件がリンク無し層**に偏っていた。

厳格版はリンク層 16.22% / リンク無し層 5.00%。この差が

  (a) リンク無し層の店は動画で地名を書かれない（実態）
  (b) リンク無し層の seed に locality が入っていない（母集団側の欠損）

のどちらなのかで意味が全く違う。(b) なら**母集団を直せば実効が上がる**。

## 測るもの

fixture 3ソース全 1,244,029 行について、リンクの有無別に

  - `locality` が空の割合
  - `locality` はあるが**市区町村トークンが取れない**割合（裏取りに使えない）
  - `region` も空の割合（region 裏取りにも落ちる＝完全に手がかり無し）

**ネットワークアクセスは一切しない。**

## この数字が言えないこと

「locality を埋めれば厳格版が上がる」とまでは言えない。埋めた上で
**動画のタイトルにその地名が出るか**は別の実測が要る。ここで分かるのは
**上限側の余地**だけである。

実行:
    python3 measure_locality_coverage.py
"""

from __future__ import annotations

import collections
import csv
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"

SOURCES = ("overture_jp_food.csv", "osm_jp_food.csv", "ifas_jp_food.csv")

_PREF = re.compile(r"^.{2,4}?[都道府県]")
_GUN = re.compile(r"^.{1,4}?郡")
_ADMIN_TOKEN = re.compile(r"\S{1,6}?[市区町村]")


def locality_needle(raw: str) -> str:
    if not raw:
        return ""
    s = _PREF.sub("", raw, count=1)
    s = _GUN.sub("", s, count=1)
    tokens = _ADMIN_TOKEN.findall(s)
    return tokens[-1] if tokens else ""


def main() -> None:
    csv.field_size_limit(10**7)
    # [総数, locality空, needle取れない(locality有), region空, 完全に手がかり無し]
    by_link: dict[bool, list[int]] = {True: [0] * 5, False: [0] * 5}
    by_source: dict[str, list[int]] = collections.defaultdict(lambda: [0] * 5)

    for filename in SOURCES:
        path = FIXTURES / filename
        if not path.exists():
            raise SystemExit(f"fixture が無い: {path}")
        source = filename.split("_")[0]
        with path.open(encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                if not (row.get("name") or "").strip():
                    continue
                loc = (row.get("locality") or "").strip()
                region = (row.get("region") or "").strip()
                has_link = (int(row.get("n_socials") or 0) > 0
                            or int(row.get("n_websites") or 0) > 0)
                needle = locality_needle(loc)
                for bucket in (by_link[has_link], by_source[source]):
                    bucket[0] += 1
                    if not loc:
                        bucket[1] += 1
                    elif not needle:
                        bucket[2] += 1
                    if not region:
                        bucket[3] += 1
                    if not needle and not region:
                        bucket[4] += 1

    def show(title: str, table: dict) -> dict:
        print(f"\n=== {title} ===", file=sys.stderr)
        print(f"{'':12}{'行数':>10}{'locality空':>12}{'needle不可':>12}"
              f"{'region空':>10}{'手がかり無し':>13}", file=sys.stderr)
        out = {}
        for key, (n, empty, no_needle, no_region, none_at_all) in table.items():
            out[str(key)] = {"n": n, "locality_empty": empty,
                             "locality_empty_pct": empty / max(n, 1) * 100,
                             "needle_unavailable": no_needle,
                             "region_empty": no_region,
                             "no_clue": none_at_all,
                             "no_clue_pct": none_at_all / max(n, 1) * 100}
            print(f"{str(key):12}{n:>10,}{empty / max(n,1)*100:>11.2f}%"
                  f"{no_needle / max(n,1)*100:>11.2f}%{no_region / max(n,1)*100:>9.2f}%"
                  f"{none_at_all / max(n,1)*100:>12.2f}%", file=sys.stderr)
        return out

    link_rows = show("リンクの有無別", {"リンク有り": by_link[True],
                                 "リンク無し": by_link[False]})
    source_rows = show("ソース別", dict(sorted(by_source.items())))

    a = by_link[True]
    b = by_link[False]
    gap = (b[4] / max(b[0], 1) - a[4] / max(a[0], 1)) * 100
    print(f"\n  地名の手がかりが全く無い店の割合の差（リンク無し − リンク有り）: "
          f"**{gap:+.2f}pt**", file=sys.stderr)
    print("\n  ※ ここで分かるのは上限側の余地だけ。locality を埋めても"
          "「動画のタイトルにその地名が出るか」は別の実測が要る。", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "locality_coverage.json"
    out_path.write_text(
        json.dumps({"by_link": link_rows, "by_source": source_rows,
                    "no_clue_gap_pt": gap,
                    "caveat": "上限側の余地のみ。locality を埋めた上で動画に地名が出るかは別測定。"},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
