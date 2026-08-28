#!/usr/bin/env python3
"""#1269 — ハンドル門を、サイト巡回で実際に集まった店→IG 対に当てて通過率を測る

`measure_ig_handle_gate.py` の門は **31 件**（オーナーの Phase 0）で precision を測った。
ここでは同じ門を、**サイト巡回で実際に集まった 101 対**に当てて、
KPI に効く「通過率」を出す。

**通過率は precision ではない。** この 101 対にはラベルが無い。
precision は 31 件で測った値（100% CI[80.6, 100]）を援用する。

    使える件数 = 集まった対 × 通過率 × precision

実行:
    python3 measure_ig_handle_gate_at_scale.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from measure_ig_handle_gate import judge, wilson

OUT = Path(__file__).resolve().parent / "out"
NOT_HANDLE = {"p", "reel", "reels", "explore", "accounts", "tv", "stories", "s"}


def pairs() -> list[tuple[str, str]]:
    d = json.loads((OUT / "site-to-sns-bridge.json").read_text())
    got: list[tuple[str, str]] = []
    for x in d["results"]:
        hs = [re.sub(r"^instagram\.com/", "", a).strip("/").split("?")[0].lower()
              for a in (x.get("accounts", {}).get("instagram") or [])]
        w = x.get("website") or ""
        if "instagram.com" in w:
            hs.append(re.sub(r".*instagram\.com/", "", w).strip("/").split("?")[0].lower())
        for h in hs:
            h = h.split("/")[0]
            if h and h not in NOT_HANDLE:
                got.append((x["name"], h))
    seen: set = set()
    return [p for p in got if not (p in seen or seen.add(p))]


def main() -> None:
    rows = [{"store": s, "handle": h, **judge(s, h)} for s, h in pairs()]
    n = len(rows)
    res = {"purpose": "#1269 ハンドル門の、実データ上の通過率",
           "source": "out/site-to-sns-bridge.json（サイト巡回で実際に集まった店→IG 対）",
           "n": n,
           "caveat": ("通過率であって precision ではない。この対にはラベルが無い。"
                      "precision は #1269 の 31 件で測った値を援用する")}
    for f in ("pass_fwd", "pass_any", "pass_loose", "pass_fuzzy"):
        k = sum(1 for r in rows if r[f])
        ci = wilson(k, n)
        res[f] = {"passed": k, "pass_rate_pct": round(k / n * 100, 1),
                  "ci_pct": [round(x * 100, 1) for x in ci]}
        print(f"  {f:12s} {k:>3}/{n} = {k/n*100:5.1f}%  CI[{ci[0]*100:.1f}, {ci[1]*100:.1f}]")
    res["rows"] = rows
    (OUT / "ig_handle_gate_at_scale.json").write_text(
        json.dumps(res, ensure_ascii=False, indent=2))

    print("\n--- 曖昧一致で新たに拾えた対 ---")
    for r in rows:
        if r["pass_fuzzy"] and not r["pass_loose"]:
            print(f"  {r['fuzzy']:.2f}  {r['handle']:26s} {r['store']}")
    print("\n--- まだ落ちている対（先頭20）---")
    for r in [x for x in rows if not x["pass_fuzzy"]][:20]:
        print(f"  {r['fuzzy']:.2f}  {r['handle']:26s} {r['store']}")
    print("\n→ out/ig_handle_gate_at_scale.json")


if __name__ == "__main__":
    main()
