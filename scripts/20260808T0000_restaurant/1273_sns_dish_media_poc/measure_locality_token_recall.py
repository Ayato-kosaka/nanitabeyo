#!/usr/bin/env python3
"""#1273 ①の店舗同定が地名の**丸ごと一致**を要求して取りこぼしていないかを測る

## 前提の訂正（自分の見立てが外れていた）

自動再開プロンプトに「①の発見パイプライン(NameMatcher)は3文字未満だけ裏取りしている」と
書いたが、**これは誤りである**。`crawl-scaleup.py` / `measure_channel_snowball.py` /
`measure_channel_traversal.py` はいずれも `match_corroborated()` を使っており、
**全ての店名に locality または region の裏取りを課している**。
つまり①に「裏取りを課していない誤爆」は構造的に入っていない。

## では何が問題か

`NameMatcher.area[key]` は `normalize_ja(locality)` を**丸ごと**持ち、
`match_corroborated` は `loc in tja`（丸ごと部分一致）を要求する。
Overture の locality は「札幌市中央区」のように**市＋区が連結**していることがあるので、
タイトルに「中央区」とだけ書いてあると裏取りが通らない。

**これは `measure_seed_youtube_ceiling.py` の judge_strict 第1版で踏んだのと同じ罠**である
（あちらは locality を丸ごと要求して 2.67% という測定不能な値を出した）。
あちらは都道府県・郡を落として最後の市区町村トークンを取る方式に直したが、
**①側は直っていない。**

## 測るもの

キャッシュ済みの全動画タイトル（194,315本、新規取得なし）に対して:

  現行  : locality を丸ごと要求
  提案  : judge_strict と同じ「最後の市区町村トークン」で裏取り（region はそのまま）

で、店舗一致が何件増えるかを数える。増分は**取りこぼしの回収**であって誤爆の追加ではない
——とは限らないので、増分から決定的標本を書き出して目視できるようにする。

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_locality_token_recall.py
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import NameMatcher, normalize_ja  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

STATE = OUT_DIR / "crawl_scaleup_state.json"

# #1273 judge_strict（measure_seed_youtube_ceiling.py）と同じ規則。
# 都道府県を落とし、次に郡を落とし、残りから最後の 市/区/町/村 トークンを取る。
_PREF = re.compile(r"^.{2,4}?[都道府県]")
_GUN = re.compile(r"^.{1,4}?郡")
_ADMIN_TOKEN = re.compile(r"\S{1,6}?[市区町村]")


def locality_needle(raw: str) -> str:
    """「北海道札幌市中央区」-> 「中央区」。取れなければ空文字。"""
    if not raw:
        return ""
    s = _PREF.sub("", raw, count=1)
    s = _GUN.sub("", s, count=1)
    tokens = _ADMIN_TOKEN.findall(s)
    return tokens[-1] if tokens else ""


def sha_rank(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main() -> None:
    if not STATE.exists():
        raise SystemExit(f"クロール結果が無い: {STATE}")
    state = json.loads(STATE.read_text(encoding="utf-8"))
    channels = state["channels"]

    matcher = NameMatcher()

    # locality を「最後の市区町村トークン」に置き換えた裏取り辞書を作る。
    needles: dict[str, tuple[str, str]] = {}
    n_shrunk = 0
    n_empty = 0
    for key, (loc, region) in matcher.area.items():
        needle = locality_needle(loc)
        if not needle:
            n_empty += 1
        elif needle != loc:
            n_shrunk += 1
        needles[key] = (needle, region)

    print(f"[dict] locality を持つ店名 {len(matcher.area):,}", file=sys.stderr)
    print(f"  トークン化で短くなった : {n_shrunk:,}", file=sys.stderr)
    print(f"  市区町村が取れなかった : {n_empty:,}（この店は region 裏取りのみになる）",
          file=sys.stderr)

    n_videos = 0
    cur_videos = new_videos = 0
    cur_pairs: set[tuple[str, str]] = set()
    new_pairs: set[tuple[str, str]] = set()
    added_examples: list[tuple[str, dict]] = []

    for ch_id, ch in channels.items():
        for v in ch.get("videos") or []:
            title = v.get("title") or ""
            if not title:
                continue
            n_videos += 1
            raw = matcher.match(title)
            if not raw:
                continue
            tja = normalize_ja(title)
            cur: set[str] = set()
            new: set[str] = set()
            for key in raw:
                loc, region = matcher.area.get(key, ("", ""))
                if (loc and loc in tja) or (region and region in tja):
                    cur.add(key)
                # 【設計】トークンだけに置き換えると、市区町村が取れない locality
                # （「〇〇村大字△△」等）の店が裏取り手段を失う。丸ごと一致も残して
                # **和集合**にすることで、提案は現行の厳密な上位互換になる。
                needle, region2 = needles.get(key, ("", ""))
                if ((needle and needle in tja) or (loc and loc in tja)
                        or (region2 and region2 in tja)):
                    new.add(key)
            if cur:
                cur_videos += 1
                cur_pairs |= {(v.get("id") or "", k) for k in cur}
            if new:
                new_videos += 1
                new_pairs |= {(v.get("id") or "", k) for k in new}
            for key in new - cur:
                added_examples.append((sha_rank(f"{v.get('id')}/{key}"), {
                    "video_id": v.get("id"), "title": title,
                    "restaurant": matcher.original.get(key, key),
                    "locality_raw": matcher.area.get(key, ("", ""))[0],
                    "locality_needle": needles.get(key, ("", ""))[0],
                    "channel": ch.get("channel"),
                }))

    cur_rest = {k for _, k in cur_pairs}
    new_rest = {k for _, k in new_pairs}

    print(f"\n=== キャッシュ済み {n_videos:,} 本のタイトルに対する店舗同定 ===", file=sys.stderr)
    print(f"{'':28}{'一致した動画':>12}{'distinct 店舗':>14}{'(動画,店舗)対':>14}",
          file=sys.stderr)
    print(f"{'現行（locality 丸ごと）':28}{cur_videos:>12,}{len(cur_rest):>14,}"
          f"{len(cur_pairs):>14,}", file=sys.stderr)
    print(f"{'提案（市区町村トークン）':28}{new_videos:>12,}{len(new_rest):>14,}"
          f"{len(new_pairs):>14,}", file=sys.stderr)

    d_rest = len(new_rest) - len(cur_rest)
    print(f"\n  増分: 店舗 {d_rest:+,} "
          f"({d_rest / max(len(cur_rest), 1) * 100:+.2f}%) / "
          f"対 {len(new_pairs) - len(cur_pairs):+,}", file=sys.stderr)
    lost = cur_rest - new_rest
    if lost:
        print(f"  ※ 提案で**落ちた**店舗 {len(lost):,}（トークンが取れず region も無い型）",
              file=sys.stderr)

    added_examples.sort(key=lambda x: x[0])
    picked = [e[1] for e in added_examples[:60]]
    print(f"\n=== 増分の決定的標本（SHA-256 順、precision はここでは主張しない）===",
          file=sys.stderr)
    for s in picked[:20]:
        print(f"  {s['restaurant'][:16]:18} ← {s['title'][:44]}", file=sys.stderr)
        print(f"    locality {s['locality_raw']!r} -> {s['locality_needle']!r}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "locality_token_recall.json"
    out_path.write_text(
        json.dumps({
            "n_videos": n_videos,
            "dict_with_locality": len(matcher.area),
            "n_shrunk": n_shrunk, "n_needle_empty": n_empty,
            "current": {"videos": cur_videos, "restaurants": len(cur_rest),
                        "pairs": len(cur_pairs)},
            "proposed": {"videos": new_videos, "restaurants": len(new_rest),
                         "pairs": len(new_pairs)},
            "delta_restaurants": d_rest,
            "lost_restaurants": len(lost),
            "added_sample": picked,
            "note": "①は既に全店名へ locality/region の裏取りを課している"
                    "（match_corroborated）。問題は誤爆ではなく、locality を丸ごと要求する"
                    "ことによる取りこぼし。",
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
