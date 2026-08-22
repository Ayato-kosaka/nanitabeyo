#!/usr/bin/env python3
"""#1273 Misskey を複数インスタンスに広げると上乗せになるかを、同一標本で union として測る

## なぜ

リンク無し層(343,247店 = 30.31%)は YouTube 26.00% ∪ Misskey(misskey.io) 12.67% で
35.37% しかない。ここが天井 54.28% の最大の弱点。

Misskey の `notes/search` は**そのインスタンスが知っている note**（ローカル＋連合で
流れてきたもの）を検索する。インスタンスごとにローカルユーザーが違うので、
別インスタンスを足せば上乗せがあるはず。**あるかどうかを推測せず測る。**

`misskey.design` と `nijimiss.moe` は APIキー不要で 200 を返すことを確認済み。

## 測りかた

`measure_misskey_ceiling.py` と**同一標本・同一判定基準**。
違う標本や緩い基準で測ると「足せるか」が判断できない。

- 標本: `out/seed_strata_sample.json` のリンク無し層 150店
- 判定: 店名が本文に出現 ＋ 画像添付あり ＋ 短い店名は地名の裏取り必須
- **union は推定せず、店単位で実際に重ね合わせる**（独立仮定を使わない）

実行:
    python3 measure_fediverse_union.py
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from measure_supply_ceiling import (  # noqa: E402
    MIN_NAME_LEN_FOR_SUBSTRING,
    core_name,
    normalize,
    wilson_interval,
)

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
SEED_CACHE = OUT_DIR / "seed_strata_sample.json"
MISSKEY_IO_RESULTS = OUT_DIR / "misskey_ceiling.json"

# APIキー不要で notes/search が 200 を返すことを確認済みのインスタンス。
INSTANCES = ["misskey.design", "nijimiss.moe"]

TOTAL_SEEDS = 1_132_482
SEEDS_WITH_OVERTURE = 789_235
SEEDS_WITHOUT_OVERTURE = 343_247
OWNER_TARGET_PCT = 70.0
LINK_LAYER_RATE = 0.625  # measure_multisource_ceiling.py（チェーン除外撤廃後）
YT_LINKLESS_RATE = 0.260

_THROTTLE_S = 1.2
_RETRY_ON_429 = 3


def search(host: str, query: str, limit: int, timeout: float) -> tuple[list[dict], str | None]:
    url = f"https://{host}/api/notes/search"
    payload = json.dumps({"query": query, "limit": limit}).encode()
    for attempt in range(_RETRY_ON_429):
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = json.loads(resp.read().decode("utf-8", "replace"))
            return (body if isinstance(body, list) else []), None
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt + 1 < _RETRY_ON_429:
                time.sleep(_THROTTLE_S * (2 ** attempt))
                continue
            return [], f"http_{exc.code}"
        except Exception as exc:  # noqa: BLE001
            return [], type(exc).__name__
    return [], "http_429"


def judge(name: str, locality: str, notes: list[dict]) -> bool:
    """measure_misskey_ceiling.py の judge_note と同一の規則。"""
    nm = normalize(name)
    core = normalize(core_name(name))
    loc = normalize(locality)
    for note in notes:
        files = note.get("files") or []
        if not any((f.get("type") or "").startswith("image") for f in files):
            continue
        text = normalize(note.get("text") or "")
        for needle in (nm, core):
            if not needle or needle not in text:
                continue
            if len(needle) < MIN_NAME_LEN_FOR_SUBSTRING and not (loc and loc in text):
                continue
            return True
    return False


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 Fediverse 複数インスタンスの union")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--timeout", type=float, default=30.0)
    args = ap.parse_args()

    if not SEED_CACHE.exists():
        raise SystemExit(f"seed 標本が無い: {SEED_CACHE}")
    if not MISSKEY_IO_RESULTS.exists():
        raise SystemExit(f"misskey.io の結果が無い: {MISSKEY_IO_RESULTS}")

    sample = json.loads(SEED_CACHE.read_text(encoding="utf-8"))["sample"]["without_overture"]
    io_rows = json.loads(MISSKEY_IO_RESULTS.read_text(encoding="utf-8"))["results"][
        "without_overture"
    ]
    io_hit = {r["seed_id"] for r in io_rows if r.get("hit")}
    print(f"リンク無し層 {len(sample)} 店 / misskey.io のヒット {len(io_hit)}", file=sys.stderr)

    per_host: dict[str, set] = {}
    for host in INSTANCES:
        print(f"\n=== {host} ===", file=sys.stderr)
        hits = set()
        errs: dict[str, int] = {}
        started = time.time()
        for i, item in enumerate(sample):
            notes, err = search(host, item["name"], args.limit, args.timeout)
            if err:
                errs[err] = errs.get(err, 0) + 1
            elif judge(item["name"], item["locality"], notes):
                hits.add(item["seed_id"])
            if i % 50 == 49:
                print(f"    {i + 1}/{len(sample)}", file=sys.stderr)
            time.sleep(_THROTTLE_S)
        per_host[host] = hits
        n_ok = len(sample) - sum(errs.values())
        print(
            f"  判定できた {n_ok}/{len(sample)} / ヒット {len(hits)} "
            f"({len(hits) / n_ok * 100 if n_ok else 0:.2f}%) / {time.time() - started:.0f}s",
            file=sys.stderr,
        )
        if errs:
            print(f"  エラー: {errs}", file=sys.stderr)
        # #1273 【設計】単独の率ではなく「misskey.io に無かった店をいくつ拾ったか」が本質。
        newly = hits - io_hit
        print(f"  **misskey.io に無かった店を新たに拾った: {len(newly)} 店**", file=sys.stderr)

    union_fedi = set(io_hit)
    for hits in per_host.values():
        union_fedi |= hits
    print(f"\n=== Fediverse 合算（実際に重ね合わせた。独立仮定を使っていない）===",
          file=sys.stderr)
    print(f"  misskey.io 単独           : {len(io_hit)}/{len(sample)} "
          f"({len(io_hit) / len(sample) * 100:.2f}%)", file=sys.stderr)
    print(f"  + {len(INSTANCES)} インスタンス : {len(union_fedi)}/{len(sample)} "
          f"({len(union_fedi) / len(sample) * 100:.2f}%)", file=sys.stderr)

    fedi_rate = len(union_fedi) / len(sample)
    # YouTube との union は実測していないので独立仮定の上限（従来と同じ扱い）。
    linkless_before = 1 - (1 - YT_LINKLESS_RATE) * (1 - len(io_hit) / len(sample))
    linkless_after = 1 - (1 - YT_LINKLESS_RATE) * (1 - fedi_rate)
    sl = SEEDS_WITH_OVERTURE / TOTAL_SEEDS
    sll = SEEDS_WITHOUT_OVERTURE / TOTAL_SEEDS
    ceiling_before = LINK_LAYER_RATE * sl + linkless_before * sll
    ceiling_after = LINK_LAYER_RATE * sl + linkless_after * sll

    print(f"\n  リンク無し層(YouTube と独立仮定): {linkless_before * 100:.2f}% -> "
          f"{linkless_after * 100:.2f}%", file=sys.stderr)
    print(f"  天井: {ceiling_before * 100:.2f}% -> **{ceiling_after * 100:.2f}%** "
          f"（{(ceiling_after - ceiling_before) * 100:+.2f}pt）", file=sys.stderr)
    print(f"  要求 {OWNER_TARGET_PCT:.0f}% との差: "
          f"{OWNER_TARGET_PCT - ceiling_after * 100:.2f}pt", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "fediverse_union.json"
    out_path.write_text(
        json.dumps(
            {
                "instances": INSTANCES,
                "sample_size": len(sample),
                "misskey_io_hits": len(io_hit),
                "per_instance_hits": {h: len(v) for h, v in per_host.items()},
                "per_instance_new": {h: len(v - io_hit) for h, v in per_host.items()},
                "union_hits": len(union_fedi),
                "union_rate": fedi_rate,
                "linkless_before": linkless_before,
                "linkless_after": linkless_after,
                "ceiling_before_pct": ceiling_before * 100,
                "ceiling_after_pct": ceiling_after * 100,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
