#!/usr/bin/env python3
"""#1345 Misskey の 12.67% を監査する（YouTube・Bluesky と同じ偽陽性が入っていないか）

## なぜ

同じ判定器（`measure_supply_ceiling` の normalize / core_name、3文字以上は裏取り無し）で
測った2つの面を目視したら、**リンク無し層の偽陽性が桁違いだった**:

    YouTube  機械 25.33% → precision 21.1% → **5.34%**
    Bluesky  機械 13.33% → precision 15.0% → **2.00%**

しかも**両方で誤爆した屋号が 11 件一致**した
（Cockapoo / Grand café / Hira / Three Suns / uouo / あかつき / いじげん /
マクドナルド / ムーラン / 世界の山ちゃん / 木曽路）。
**原因は面ではなく店名辞書**なので、Misskey にも同じものが入っているはずである。

Misskey の 12.67% は r_N の構成要素としてそのまま使われている。**監査せずに使えない。**

## 測るもの

`out/misskey_ceiling.json` に保存されている **note_id** を
`POST /api/notes/show` で引き直し、本文を出して目視する。
検索し直すのではなく **ヒットしたその投稿**を引くので、当時の判定を正確に再現できる。

## この測定が言えないこと

  - 本文と添付枚数を見るだけで、**画像そのものは見ない**（料理が写っているかは別）
  - 削除された投稿は引けない（**欠測として数える**）

実行:
    python3 verify_misskey_hits.py
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
SHOW = "https://misskey.io/api/notes/show"
UA = "nanitabeyo-research/1.0 (dish-media feasibility PoC)"


def show(note_id: str, timeout: float = 25.0) -> dict | None:
    body = json.dumps({"noteId": note_id}).encode()
    for attempt in range(4):
        try:
            req = urllib.request.Request(
                SHOW, data=body,
                headers={"Content-Type": "application/json", "User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503):
                time.sleep(2 ** attempt * 2)
                continue
            return None
        except Exception:                                        # noqa: BLE001
            if attempt == 3:
                return None
            time.sleep(2 ** attempt)
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--delay", type=float, default=1.2)
    args = ap.parse_args()

    src = OUT_DIR / "misskey_ceiling.json"
    if not src.exists():
        print("**misskey_ceiling.json が無い。数字を出さない。**", file=sys.stderr)
        raise SystemExit(2)
    d = json.loads(src.read_text(encoding="utf-8"))

    out = {}
    for layer in ("without_overture", "with_overture"):
        hits = [r for r in d["results"][layer] if r.get("hit")]
        rows = []
        gone = 0
        print(f"\n=== {layer}: ヒット {len(hits)} 件を引き直す ===", file=sys.stderr)
        for i, r in enumerate(hits, 1):
            nid = (r.get("best_match") or {}).get("note_id")
            note = show(nid) if nid else None
            time.sleep(args.delay)
            if not note:
                gone += 1
                rows.append({"name": r["name"], "note_id": nid, "gone": True})
                print(f"{i:>2}. 『{r['name']}』  **引けなかった**", file=sys.stderr)
                continue
            text = (note.get("text") or "").replace("\n", " ")
            rows.append({"name": r["name"], "note_id": nid, "gone": False,
                         "text": text[:300], "n_files": len(note.get("files") or [])})
            print(f"{i:>2}. 『{r['name']}』 files={len(note.get('files') or [])}",
                  file=sys.stderr)
            print(f"     {text[:110]}", file=sys.stderr)
        out[layer] = {"n_hit": len(hits), "n_gone": gone, "rows": rows}

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "misskey_hit_review.json"
    p.write_text(json.dumps(
        {"source": "out/misskey_ceiling.json", "endpoint": SHOW, "layers": out,
         "caveat": "本文と添付枚数を見るだけで画像そのものは見ていない。"
                   "削除済みの投稿は引けないので欠測として数える。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
