#!/usr/bin/env python3
"""#1269 Phase 0: business_discovery の実測結果を帰属ラベルとクロス集計する。

入力は ec2_exec.sh のログ。`@@@BD_SUMMARY_JSON` ... `@@@END_BD_SUMMARY_JSON` の間の
1行 JSON を拾う。`business_discovery` が何も返さない＝相手が Professional ではない、が
唯一の確定手段なので、ここで出る professional は下限ではなく確定値。
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
LABELS = json.loads((HERE / "out" / "handles_labeled.json").read_text())
LABEL_OF = {r["handle"]: r["attribution_label"] for r in LABELS["handles"]}
STORE_OF = {r["handle"]: r["store"] for r in LABELS["handles"]}


def main() -> None:
    log = Path(sys.argv[1]).read_text(errors="replace")
    m = re.search(r"@@@BD_SUMMARY_JSON\n(.*?)\n@@@END_BD_SUMMARY_JSON", log, re.S)
    if not m:
        raise SystemExit("BD summary JSON がログに無い")
    src = json.loads(m.group(1))

    # エラー = 相手が非プロ、とは限らない。トークン側の不備（権限不足・失効）でも同じ形で落ちる。
    # 2026-08-27、instagram_manage_insights の無いトークンで全件 #10 になり、素朴に数えると
    # 「プロアカウント率 0%」という嘘の測定値ができた。測定不成立を professional=False と混ぜない。
    TOKEN_SIDE_ERRORS = {10, 190, 200, 2500, 803}

    rows = []
    for r in src["rows"]:
        r = dict(r)
        r["attribution_label"] = LABEL_OF.get(r["handle"], "unknown")
        r["store"] = STORE_OF.get(r["handle"])
        if r.get("professional") is False and r.get("error_code") in TOKEN_SIDE_ERRORS:
            r["professional"] = "unmeasured"  # トークン/アプリ側の問題。相手の種別は分かっていない
        rows.append(r)

    unmeasured = [r for r in rows if r["professional"] == "unmeasured"]
    if unmeasured:
        print(
            f"!!! {len(unmeasured)}/{len(rows)} 件がトークン側のエラーで測定不成立です "
            f"(code={sorted({r.get('error_code') for r in unmeasured})})。"
            "プロアカウント率としては数えません。",
            file=sys.stderr,
        )

    by_label = {}
    for r in rows:
        b = by_label.setdefault(r["attribution_label"], {"n": 0, "professional": 0, "with_website": 0})
        b["n"] += 1
        if r["professional"] == "unmeasured":
            b["unmeasured"] = b.get("unmeasured", 0) + 1
        if r["professional"] is True:
            b["professional"] += 1
            if r.get("website"):
                b["with_website"] += 1
    for b in by_label.values():
        judged = b["n"] - b.get("unmeasured", 0)
        b["judged"] = judged
        b["professional_rate_pct"] = round(100 * b["professional"] / judged, 1) if judged else None

    pro = [r for r in rows if r["professional"] is True]
    judged = [r for r in rows if r["professional"] in (True, False)]
    out = {
        "purpose": "#1269 Phase 0: business_discovery による Professional アカウント率の確定値",
        "method": "business_discovery.username(<handle>) を叩き、データが返れば professional、error なら非 professional と判定した。画面目視と違い偽陰性が無い。",
        "measured_at": src.get("measured_at"),
        "n": len(rows),
        "n_judged": len(judged),
        "n_unmeasured": len(rows) - len(judged),
        "professional": len(pro),
        "professional_rate_pct": round(100 * len(pro) / len(judged), 1) if judged else None,
        "by_attribution_label": by_label,
        "website_present": sum(1 for r in pro if r.get("website")),
        "website_rate_pct_among_professional": round(100 * sum(1 for r in pro if r.get("website")) / len(pro), 1) if pro else None,
        "caption_available": {
            "handles_with_media_returned": sum(1 for r in pro if r.get("media_returned")),
            "handles_where_every_media_had_caption": sum(
                1 for r in pro if r.get("media_returned") and r["media_returned"] == r.get("media_with_caption")
            ),
            "total_media_sampled": sum(r.get("media_returned", 0) for r in pro),
            "total_media_with_caption": sum(r.get("media_with_caption", 0) for r in pro),
        },
        "error_codes": sorted({(r.get("error_code"), r.get("error_subcode")) for r in rows if r["professional"] is not True}, key=str),
        "rows": sorted(rows, key=lambda r: (r["attribution_label"], r["handle"])),
    }
    dst = HERE / "out" / "business_discovery_result.json"
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(json.dumps({k: v for k, v in out.items() if k != "rows"}, ensure_ascii=False, indent=2))
    print("wrote", dst)


if __name__ == "__main__":
    main()
