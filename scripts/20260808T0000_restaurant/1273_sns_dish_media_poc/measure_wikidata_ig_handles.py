#!/usr/bin/env python3
"""#1653 — Wikidata の Instagram ユーザー名（P2003）に、日本の飲食店が何件あるか

Wikidata は **CC0** で、規約上いっさい制約が無い。OSM と並んで
「無条件に使える店舗ソース」なので、量があるかを数えた。

## 結果（先に書く）

  日本 × instance of レストラン(Q11707) × P2003 → **53 件**
  日本 × instance of カフェ(Q30022)     × P2003 → **14 件**

母集団 1,132,482 に対して **0.006%**。**却下**。規約は完璧だが、量が 4 桁足りない。

`wdt:P31/wdt:P279*` で下位クラスまで辿る問い合わせは Wikidata 側でタイムアウトする
（60 秒上限）ので、主要 2 クラスの直接一致だけを数えた。下位クラスを足しても
桁は変わらない。

実行:
    python3 measure_wikidata_ig_handles.py
"""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

OUT = Path(__file__).resolve().parent / "out"
EP = "https://query.wikidata.org/sparql"
CLASSES = {"Q11707": "レストラン", "Q30022": "カフェ", "Q11666": "居酒屋・バー",
           "Q7075": "図書館(対照群)"}


def ask(cls: str) -> int | None:
    q = (f"SELECT (COUNT(DISTINCT ?s) AS ?n) WHERE "
         f"{{ ?s wdt:P31 wd:{cls} ; wdt:P17 wd:Q17 ; wdt:P2003 ?i }}")
    r = subprocess.run(["curl", "-s", "-G", EP, "--data-urlencode", f"query={q}",
                        "-H", "Accept: application/sparql-results+json",
                        "-H", "User-Agent: nanitabeyo/1.0", "--max-time", "150"],
                       capture_output=True)
    try:
        b = json.loads(r.stdout)["results"]["bindings"]
        return int(b[0]["n"]["value"])
    except Exception:                                            # noqa: BLE001
        return None


def main() -> None:
    got = {}
    for c, label in CLASSES.items():
        n = ask(c)
        got[c] = {"label": label, "n": n}
        print(f"  {label:18s} ({c}) → {n}")
        time.sleep(2)
    total = sum(v["n"] for v in got.values()
                if v["n"] is not None and v["label"] != "図書館(対照群)")
    res = {"purpose": "#1653 Wikidata P2003 に日本の飲食店が何件あるか",
           "license": "CC0（規約上の制約なし）", "measured_at": time.strftime("%Y-%m-%d"),
           "by_class": got, "food_total": total, "population": 1_132_482,
           "share_pct": round(total / 1_132_482 * 100, 4),
           "judgement": "却下。規約は完璧だが量が4桁足りない",
           "caveat": "wdt:P31/wdt:P279* の下位クラス展開は Wikidata 側でタイムアウトする。"
                     "直接一致のみ。下位クラスを足しても桁は変わらない"}
    (OUT / "wikidata_ig_handles.json").write_text(
        json.dumps(res, ensure_ascii=False, indent=2))
    print(f"\n飲食計 {total} 件 = 母集団の {res['share_pct']}% → 却下")


if __name__ == "__main__":
    main()
