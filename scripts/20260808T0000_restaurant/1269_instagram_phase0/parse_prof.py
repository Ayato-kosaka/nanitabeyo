#!/usr/bin/env python3
"""#1269 Phase 0: EC2 上の claude --chrome が吐いた `PROF:` 行を集計する。

入力は ec2_exec.sh のログ（stdout をそのまま貼ったファイル）。
`PROF: handle=... status=... professional=... category=... website=...` の行だけ拾い、
out/handles_labeled.json の帰属ラベル（店固有 / チェーン / 別主体）とクロス集計する。
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
LABELS = json.loads((HERE / "out" / "handles_labeled.json").read_text())
LABEL_OF = {r["handle"]: r["attribution_label"] for r in LABELS["handles"]}
STORE_OF = {r["handle"]: r["store"] for r in LABELS["handles"]}

FIELD = re.compile(r"(\w+)=(.*?)(?=\s+\w+=|$)")


def parse(path: Path) -> dict:
    seen = {}
    for line in path.read_text(errors="replace").splitlines():
        line = line.strip()
        i = line.find("PROF: ")
        if i < 0 or line.startswith("PROF_SUMMARY"):
            continue
        rec = {k: v.strip() for k, v in FIELD.findall(line[i + len("PROF: "):])}
        h = rec.get("handle")
        if not h or h not in LABEL_OF:
            continue
        rec["attribution_label"] = LABEL_OF[h]
        rec["store"] = STORE_OF[h]
        seen[h] = rec  # 同じハンドルが2回出たら後勝ち
    return seen


def main() -> None:
    rows = parse(Path(sys.argv[1]))
    missing = sorted(set(LABEL_OF) - set(rows))
    by_label = {}
    for r in rows.values():
        b = by_label.setdefault(r["attribution_label"], {"n": 0, "yes": 0, "no": 0, "unknown": 0, "unreadable": 0})
        b["n"] += 1
        if r.get("status") not in ("ok", "private"):
            b["unreadable"] += 1
        p = r.get("professional", "unknown")
        b[p if p in ("yes", "no") else "unknown"] += 1
    readable = [r for r in rows.values() if r.get("professional") in ("yes", "no")]
    n_yes = sum(1 for r in readable if r["professional"] == "yes")
    with_site = [r for r in rows.values() if r.get("website") not in (None, "", "-")]
    out = {
        "purpose": "#1269 Phase 0: business_discovery の到達率上限になる Professional アカウント率",
        "n_target": len(LABEL_OF),
        "n_observed": len(rows),
        "n_missing": len(missing),
        "missing_handles": missing,
        "n_judged": len(readable),
        "professional_rate_pct": round(100 * n_yes / len(readable), 1) if readable else None,
        "by_attribution_label": by_label,
        "profile_website_present": len(with_site),
        "profile_website_rate_pct": round(100 * len(with_site) / len(rows), 1) if rows else None,
        "rows": sorted(rows.values(), key=lambda r: (r["attribution_label"], r["handle"])),
    }
    dst = HERE / "out" / "professional_rate.json"
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(json.dumps({k: v for k, v in out.items() if k != "rows"}, ensure_ascii=False, indent=2))
    print("wrote", dst)


if __name__ == "__main__":
    main()
