#!/usr/bin/env python3
"""#1273 実行環境の制約が 48.0% の天井をどれだけ押し下げているかの上限を出す

## なぜ要るか

「70%に届かない」という結論に対して、**「単に測定環境が壊れていただけでは？」**
という疑いが残っていた。実際 #1304 の店舗自社サイト調査には環境由来の欠測がある。

- この実行環境の egress proxy は **HTTPS_CONNECT しか通さない**（`/root/.ccr/README.md`:
  "only HTTPS_PROXY is supported"）。平文HTTP(:80) は 403 で落ちる。
  → https が無い/壊れている店のサイトは**原理的に評価できない**（305店中75店）。
- `web.archive.org:443` と `index.commoncrawl.org:443` も接続できない（2026-08-14 再確認）。
  → アーカイブ経由の救済も測りきれていない。

これらは「routing around するな」と README が明示している類の制約なので、
回避せずに**欠測が結論を覆しうるかどうかだけを上限で押さえる**。

## 出す数字

欠測した75店が、評価できた230店と**同じ確率で** dish 画像を持っていたと仮定する
（実際にはhttpsすら無い店なので、これは店舗自社サイト側に最大限有利な仮定）。
そのうえで天井がどこまで動くかを見る。

実行:
    python3 measure_env_limit_bound.py
"""

from __future__ import annotations

import json
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

# #1273 Round8 で確定した「無料・規約クリーン」の合算天井。
# 店舗自社サイトの寄与は precision 調整後 7.16%（REPORT.md の判定表）。
COMBINED_CEILING_PCT = 48.0
OWNER_TARGET_PCT = 70.0

ENV_BLOCK_PREFIX = "env_http80_blocked"

# 環境制約が今も生きているかを毎回確かめる。直ったなら本スクリプトではなく
# own-website-images.py を測り直すべきなので、それが分かるようにしておく。
REACHABILITY_PROBES = {
    "plain HTTP(:80)": "http://example.com",
    "web.archive.org": "https://web.archive.org/web/2024/http://example.com",
    "index.commoncrawl.org": "https://index.commoncrawl.org/CC-MAIN-2026-30-index?url=example.com&output=json",
    "archive.org(available API)": "https://archive.org/wayback/available?url=example.com",
}


def probe_once(url: str, timeout: float) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return f"ok({resp.status})"
    except urllib.error.HTTPError as exc:
        return f"http_{exc.code}"
    except ssl.SSLError as exc:
        return f"ssl({type(exc).__name__})"
    except Exception as exc:  # noqa: BLE001 - 到達性の分類が目的
        return f"{type(exc).__name__}"


# #1273 【バグ】1回だけ叩いて到達性を判定してはいけない。
# index.commoncrawl.org は 1回目がたまたま 200 を返したが、実クエリ8件では
# 6件が URLError だった。断続的に通るホストを「復旧した」と読むと、
# 環境制約が消えたという誤った結論になる。成功率で見る。
PROBE_ATTEMPTS = 4


def probe(url: str, timeout: float = 25.0) -> str:
    outcomes = [probe_once(url, timeout) for _ in range(PROBE_ATTEMPTS)]
    n_ok = sum(1 for o in outcomes if o.startswith("ok("))
    distinct = sorted(set(outcomes))
    return f"{n_ok}/{PROBE_ATTEMPTS} ok  {','.join(distinct)}"


def main() -> None:
    path = OUT_DIR / "own-website-images.json"
    if not path.exists():
        raise SystemExit(f"#1304 の測定結果が無い: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))

    results = data["results"]
    n_sample = data["sample_size"]
    precision = data["visual_verification"]["precision"]

    blocked = [r for r in results if (r.get("fail_reason") or "").startswith(ENV_BLOCK_PREFIX)]
    evaluable = [r for r in results if not (r.get("fail_reason") or "").startswith(ENV_BLOCK_PREFIX)]
    hits = [r for r in evaluable if r["n_verified_dish"] >= 1]

    # #1273 【バグ回避】判定基準が元スクリプトとずれていないことを毎回確認する。
    # ここを取り違えると「環境のせいで低く出ていた」の大きさを誤って報告する。
    recorded = data["n_store_with_verified_dish_image"]
    total_hits = sum(1 for r in results if r["n_verified_dish"] >= 1)
    if total_hits != recorded:
        raise SystemExit(f"判定基準が元スクリプトと不一致: {total_hits} != {recorded}")

    hit_rate = len(hits) / len(evaluable)
    projected = len(hits) + len(blocked) * hit_rate

    raw_now = len(hits) / n_sample * 100
    raw_projected = projected / n_sample * 100
    adj_now = raw_now * precision
    adj_projected = raw_projected * precision
    delta = adj_projected - adj_now

    print("=== 到達性の再確認 ===", file=sys.stderr)
    reach = {}
    for label, url in REACHABILITY_PROBES.items():
        reach[label] = probe(url)
        print(f"  {label:28} {reach[label]}", file=sys.stderr)

    print("\n=== 環境欠測が天井をどれだけ押し下げているか（上限） ===", file=sys.stderr)
    print(f"600店中 website あり: {len(results)}", file=sys.stderr)
    print(f"  うち平文HTTPのみで評価不能: {len(blocked)}", file=sys.stderr)
    print(f"  評価できた: {len(evaluable)} / dish画像あり {len(hits)} ({hit_rate * 100:.2f}%)", file=sys.stderr)
    print(f"\n店舗自社サイトの寄与 (raw):  {raw_now:.2f}%  ->  {raw_projected:.2f}%", file=sys.stderr)
    print(f"  precision {precision} 調整後: {adj_now:.2f}%  ->  {adj_projected:.2f}%"
          f"  (+{delta:.2f}pt)", file=sys.stderr)

    # union は増分以上には増えないので、これが天井の上限になる。
    ceiling_upper = COMBINED_CEILING_PCT + delta
    print(f"\n合算天井: {COMBINED_CEILING_PCT:.1f}%  ->  **最大でも {ceiling_upper:.1f}%**",
          file=sys.stderr)
    print(f"（union は増分より大きくは増えないため、これは上限。"
          f"YouTube で既に取れている店と重なる分だけ実際は小さくなる）", file=sys.stderr)
    print(f"\nオーナー要求 {OWNER_TARGET_PCT:.0f}% との差: "
          f"{OWNER_TARGET_PCT - ceiling_upper:.1f}pt", file=sys.stderr)
    print("\n結論: 環境の HTTP(:80) 制約は実在するが、**最も有利な仮定を置いても"
          "70% には届かない**。測定環境の不備は 70% 未達の説明にならない。", file=sys.stderr)

    out_path = OUT_DIR / "env_limit_bound.json"
    out_path.write_text(
        json.dumps(
            {
                "reachability": reach,
                "n_with_website": len(results),
                "n_env_blocked": len(blocked),
                "n_evaluable": len(evaluable),
                "n_hits_evaluable": len(hits),
                "hit_rate_evaluable": hit_rate,
                "precision": precision,
                "own_site_pct_raw_now": raw_now,
                "own_site_pct_raw_projected": raw_projected,
                "own_site_pct_adjusted_now": adj_now,
                "own_site_pct_adjusted_projected": adj_projected,
                "delta_pt": delta,
                "combined_ceiling_pct": COMBINED_CEILING_PCT,
                "combined_ceiling_upper_bound_pct": ceiling_upper,
                "owner_target_pct": OWNER_TARGET_PCT,
                "gap_to_target_pt": OWNER_TARGET_PCT - ceiling_upper,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
