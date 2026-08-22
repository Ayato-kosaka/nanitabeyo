#!/usr/bin/env python3
"""#1345 Shorts の**店舗特定**だけを取り出して、機械の限界と人間の限界を分けて測る

## なぜ

オーナーの主張:

    「YouTube で焼き鳥とかラーメンと調べたらショートが無限に出てくる。
      供給はある。詰まっているのは**キャプションから店を特定する**ところだ。
      そこを徹底的にやれば打開策が見つかるはずだ」

これは正しい問いの立て方である。既存の測定 (`out/shorts_route_search.json`) は
**機械の店舗特定率 15/216 = 6.94%** を出しているが、これは
`NameMatcher.match_corroborated`（店名×地名の裏取り）**1つだけ**の成績であり、

    「機械が特定できなかった」 と 「そもそも題名に店が書かれていない」

を**分けていない**。前者なら抽出器を直せば伸びる（＝打開策がある）。
後者なら何を作っても伸びない。**この2つを分けるのがこの測定の目的である。**

## 測るもの

  段階A 収集: カテゴリ × エリアで4分未満フィルタの検索をかけ、60秒以下だけ残す
  段階B 機械: 題名に対して**5種類の抽出器**をかけ、それぞれの特定率と和を出す
       E1 辞書＋地名の裏取り（現行の基準線）
       E2 括弧（【】『』「」《》）の中身を店名候補として辞書照合
       E3 「＠地名」「店名（地名）」の位置表現
       E4 ハッシュタグ
       E5 概要欄の URL（Google マップ / 食べログ / Instagram）と住所（部分標本のみ）
  段階C 人間: 無作為標本の題名を**私が読んで**「店を特定できるか」を3値で判定

**段階C から段階B を引いた差が、抽出器を直せば取れる余地**である。

## この測定が言えないこと

  - 検索結果は実行ごとに変わる。**同じ数字は再現しない**
  - 特定できたとしても、その動画の**権利処理は別問題**（規約・許諾）
  - 「特定できた店」が母集団のどれだけを覆うかは**別の測定**（重複が多い）
  - 概要欄は1本ずつメタデータを引くので、部分標本しか見ない

実行:
    python3 measure_shorts_identification.py collect --per-query 60
    python3 measure_shorts_identification.py machine
    python3 measure_shorts_identification.py sample --n 60
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import random
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from measure_channel_traversal import NameMatcher  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
YT = "/tmp/yt-dlp-latest"
SP_UNDER_4MIN = "EgIYAQ%3D%3D"

# 既存の測定（CATEGORIES/CATEGORIES2）と重ならない第3セットにする。
# 【規律】抽出器を作る標本と評価する標本を分けないと、成績が過大になる。
CATEGORIES = ["焼き鳥", "ラーメン", "焼肉", "うどん", "とんかつ", "餃子", "海鮮丼", "喫茶店"]
AREAS = ["渋谷", "池袋", "難波", "天神", "栄", "三宮", "博多", "上野"]

BRACKET = re.compile(r"[【『「《\[]([^】』」》\]]{2,20})[】』」》\]]")
AT_PLACE = re.compile(r"[＠@]\s*([^\s#｜|]{2,15})")
HASHTAG = re.compile(r"[#＃]([^\s#＃]{2,20})")
URL_MAPS = re.compile(r"(maps\.app\.goo\.gl|goo\.gl/maps|google\.[a-z.]+/maps)", re.I)
URL_TABELOG = re.compile(r"tabelog\.com", re.I)
URL_INSTA = re.compile(r"instagram\.com", re.I)
ADDR = re.compile(r"(北海道|東京都|京都府|大阪府|.{2,3}県)[^\s]{2,30}?[0-9０-９]")


def search(query: str, limit: int) -> list[dict]:
    q = urllib.parse.quote_plus(query)
    url = f"https://www.youtube.com/results?search_query={q}&sp={SP_UNDER_4MIN}"
    cmd = [YT, "--flat-playlist", "--dump-json", "--playlist-end", str(limit), url]
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=180)
    except subprocess.TimeoutExpired:
        return []
    out = []
    for line in p.stdout.decode("utf-8", "replace").splitlines():
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def stage_collect(args) -> None:
    seen: dict[str, dict] = {}
    for ci, cat in enumerate(CATEGORIES, 1):
        for ai, area in enumerate(AREAS, 1):
            q = f"{cat} {area}"
            vids = search(q, args.per_query)
            n_sh = 0
            for v in vids:
                d = v.get("duration")
                if d is None or d > 60:
                    continue
                n_sh += 1
                vid = v.get("id")
                if vid and vid not in seen:
                    seen[vid] = {"id": vid, "title": (v.get("title") or "").strip(),
                                 "duration": d, "channel": v.get("channel"),
                                 "channel_id": v.get("channel_id"), "query": q}
            print(f"  [{ci}/{len(CATEGORIES)}·{ai}/{len(AREAS)}] {q:16} "
                  f"取得 {len(vids):>3} / 60秒以下 {n_sh:>3} / 累計 distinct {len(seen)}",
                  file=sys.stderr, flush=True)
            time.sleep(0.5)
    p = OUT_DIR / "shorts_identification_pool.json"
    p.write_text(json.dumps({"n_queries": len(CATEGORIES) * len(AREAS),
                             "per_query": args.per_query,
                             "categories": CATEGORIES, "areas": AREAS,
                             "n_shorts": len(seen), "rows": list(seen.values()),
                             "caveat": "検索結果は実行ごとに変わる。同じ数字は再現しない。"},
                            ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}  60秒以下の distinct 動画 **{len(seen)}**", file=sys.stderr)


def stage_machine(args) -> None:
    pool = json.loads((OUT_DIR / "shorts_identification_pool.json").read_text(encoding="utf-8"))
    m = NameMatcher()
    rows = pool["rows"]
    hits = {k: set() for k in ("E1 辞書+地名裏取り", "E2 括弧の中身", "E3 ＠地名",
                               "E4 ハッシュタグ")}
    detail = []
    for r in rows:
        t = r["title"]
        got = {}
        c = m.match_corroborated(t) if hasattr(m, "match_corroborated") else None
        if c:
            hits["E1 辞書+地名裏取り"].add(r["id"])
            got["E1"] = c if isinstance(c, str) else str(c)
        for b in BRACKET.findall(t):
            if b in m.auto_ja.keys() or b in m.auto_la.keys():
                hits["E2 括弧の中身"].add(r["id"])
                got["E2"] = b
                break
        if AT_PLACE.search(t):
            hits["E3 ＠地名"].add(r["id"])
            got["E3"] = AT_PLACE.search(t).group(1)
        tags = [h for h in HASHTAG.findall(t)
                if h in m.auto_ja.keys() or h in m.auto_la.keys()]
        if tags:
            hits["E4 ハッシュタグ"].add(r["id"])
            got["E4"] = tags[0]
        if got:
            detail.append({"id": r["id"], "title": t, "got": got})

    n = len(rows)
    print(f"=== 題名からの機械的な店舗特定（n={n}）===", file=sys.stderr)
    for k, v in hits.items():
        print(f"  {k:18} {len(v):>4} / {n} = **{len(v)/n*100:5.2f}%**", file=sys.stderr)
    union = set().union(*hits.values())
    print(f"  {'和（どれか1つでも）':18} {len(union):>4} / {n} = "
          f"**{len(union)/n*100:5.2f}%**", file=sys.stderr)

    p = OUT_DIR / "shorts_identification_machine.json"
    p.write_text(json.dumps(
        {"n": n, "by_extractor": {k: len(v) for k, v in hits.items()},
         "union": len(union), "union_rate": len(union) / n,
         "detail": detail[:400],
         "caveat": "**経路存在率でも実効でもなく、抽出器の成績**である。"
                   "当たった中身が正しいかは目視で確かめる必要がある。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


def stage_desc(args) -> None:
    """E5: 概要欄を実際に引いて、URL と住所がどれだけ入っているかを数える。

    既存の `out/shorts_description.json` は **median_desc_len = 0**（141本）だった。
    「キャプションから店を特定する」という筋の**前提そのもの**なので、
    別標本で取り直して確かめる。1本ずつメタデータを引くので部分標本だけ見る。
    """
    pool = json.loads((OUT_DIR / "shorts_identification_pool.json").read_text(encoding="utf-8"))
    rnd = random.Random(20260819)
    smp = rnd.sample(pool["rows"], min(args.n, len(pool["rows"])))
    rows, lens = [], []
    for i, r in enumerate(smp, 1):
        cmd = [YT, "--skip-download", "--dump-json",
               f"https://www.youtube.com/watch?v={r['id']}"]
        try:
            pr = subprocess.run(cmd, capture_output=True, timeout=90)
            d = json.loads(pr.stdout.decode("utf-8", "replace").splitlines()[0])
        except Exception:                                        # noqa: BLE001
            rows.append({"id": r["id"], "ok": False})
            print(f"{i:>3}. 取得失敗", file=sys.stderr, flush=True)
            continue
        desc = d.get("description") or ""
        lens.append(len(desc))
        rec = {"id": r["id"], "ok": True, "title": r["title"], "desc_len": len(desc),
               "maps": bool(URL_MAPS.search(desc)), "tabelog": bool(URL_TABELOG.search(desc)),
               "insta": bool(URL_INSTA.search(desc)), "addr": bool(ADDR.search(desc)),
               "n_tags": len(HASHTAG.findall(desc)),
               "location": d.get("location")}
        rows.append(rec)
        print(f"{i:>3}. len={len(desc):>5} maps={rec['maps']} tabelog={rec['tabelog']} "
              f"insta={rec['insta']} addr={rec['addr']} loc={rec['location']!r}",
              file=sys.stderr, flush=True)
        time.sleep(0.3)

    ok = [r for r in rows if r.get("ok")]
    lens.sort()
    med = lens[len(lens) // 2] if lens else 0
    n = len(ok)
    print(f"\n=== 概要欄（n={n}）===", file=sys.stderr)
    print(f"  文字数の中央値 **{med}**  / 空（0文字） "
          f"**{sum(1 for r in ok if r['desc_len'] == 0)}/{n}**", file=sys.stderr)
    for k, lab in (("maps", "Google マップの URL"), ("tabelog", "食べログの URL"),
                   ("insta", "Instagram の URL"), ("addr", "住所らしき文字列")):
        c = sum(1 for r in ok if r[k])
        print(f"  {lab:22} {c:>3}/{n} = **{c/n*100:5.2f}%**", file=sys.stderr)
    c = sum(1 for r in ok if r.get("location"))
    print(f"  {'位置情報タグ':22} {c:>3}/{n} = **{c/n*100:5.2f}%**", file=sys.stderr)

    p2 = OUT_DIR / "shorts_identification_desc.json"
    p2.write_text(json.dumps(
        {"n": n, "median_desc_len": med, "rows": rows,
         "caveat": "概要欄は1本ずつ引くので部分標本。URL があっても"
                   "**その店の URL とは限らない**（チャンネルの固定リンク等）。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p2.name}", file=sys.stderr)


def stage_sample(args) -> None:
    pool = json.loads((OUT_DIR / "shorts_identification_pool.json").read_text(encoding="utf-8"))
    rows = pool["rows"]
    rnd = random.Random(20260819)
    smp = rnd.sample(rows, min(args.n, len(rows)))
    p = OUT_DIR / "shorts_identification_sample.json"
    p.write_text(json.dumps({"n": len(smp), "seed": 20260819, "rows": smp},
                            ensure_ascii=False, indent=2), encoding="utf-8")
    for i, r in enumerate(smp, 1):
        print(f"{i:>3}. [{r['duration']:>2}s] {r['title']}", file=sys.stderr)
        print(f"      ch={r['channel']}  q={r['query']}", file=sys.stderr)
    print(f"\n-> {p.name}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="stage", required=True)
    c = sub.add_parser("collect"); c.add_argument("--per-query", type=int, default=60)
    sub.add_parser("machine")
    de = sub.add_parser("desc"); de.add_argument("--n", type=int, default=60)
    s = sub.add_parser("sample"); s.add_argument("--n", type=int, default=60)
    args = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    {"collect": stage_collect, "machine": stage_machine,
     "desc": stage_desc, "sample": stage_sample}[args.stage](args)


if __name__ == "__main__":
    main()
