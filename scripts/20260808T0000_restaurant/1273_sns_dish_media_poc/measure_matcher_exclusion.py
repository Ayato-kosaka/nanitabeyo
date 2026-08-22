#!/usr/bin/env python3
"""#1273 目視で見つけた誤りの型を NameMatcher から除外できるか

## なぜ

`measure_support_precision.py` の目視80件で、誤りが4類型に分かれた。

| 型 | 例 | 除外できるか |
|---|---|---|
| 施設名を屋号として拾う | 国際通りのれん街 / 唐戸はれて横丁 / アルプス公園 | **できる** |
| 屋号として不正な行（地名だけ） | 港区新橋 | **できる** |
| 一般語が屋号 | みつだんご | 既存の dish_vocab 除外の範囲 |
| チェーン・多拠点の別店舗 | 丸幸ラーメンセンター（佐賀市 vs 基山町） | **できない**（支店同定が要る） |

除外できる2型に規則を当てて、**何が落ちるか**を測る。

## 規則（自分で決めたので明記する）

**規則1: 施設・場所の型で終わる屋号を落とす。**
末尾が 横丁 / のれん街 / 商店街 / フードコート / 地下街 / 公園 / 百貨店 / 市場 …
の名前は「容器」であって1軒の店ではない。容器の中のテナントの動画に必ず当たる。

**規則2: 市区町村トークンを含み、業態語を1つも持たない屋号を落とす。**
既存の `addr_tail` は**末尾**しか見ていないので「港区新橋」が通り抜けていた。
業態語（店・屋・亭・家・軒・食堂・酒場・カフェ …）を持つ名前は残すので、
「ラーメンショップ新守谷店」「中華食堂和木」「北区赤羽飯店」は落ちない。

## 検証の仕方（ここが本体）

**規則が落とすものを標本して目視する。** 落ちたものが本当に誤りなら規則は妥当、
正しい店が混ざっていれば規則は行き過ぎである。
規則を作った80件とは**別の標本**を見る（規則を作った標本での成績は過大評価になる）。

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_matcher_exclusion.py --sample 40
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import NameMatcher  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
STATE = OUT_DIR / "crawl_scaleup_state.json"

# 規則1: 容器（施設・場所）の型
VENUE_TAIL = re.compile(
    r"(横丁|のれん街|暖簾街|商店街|フードコート|地下街|公園|百貨店|デパート|"
    r"ショッピングセンター|ショッピングモール|アウトレット|サービスエリア|"
    r"パーキングエリア|道の駅|市場|センター街|銀座街|飲食街|屋台村|"
    r"ターミナル|バスセンター|物産館|直売所)$")

# 規則2 の初版は **[市区町村] の1文字でも含めば落とす** という作りで、目視40件中
# **5件が誤爆**した（12.5%）。落としてはいけない実在の店:
#   「丼の市まつ」（肉どんぶり専門店。「市まつ」の市）
#   「西村麺業」（**西村**の村。姓であって行政区画ではない）
#   「との町たる井」「人形町花」（町は付くが市区町村ではない）
#   「亜熱帯地区はなれ」（地区の区）
# 原因は「市区町村の1文字」を行政区画の証拠と見なしたこと。**文字ではなく実在の
# 市区町村名と突き合わせる**ように変えた。母集団の locality 列から作った集合を使う。
_PREF_HEAD = re.compile(r"^.{2,4}?[都道府県]")

# 規則2 の第2版は行政区画の判定を実在の市区町村名との突合に直したが、**業態語の番人を
# 外してしまい**、目視40件で誤爆が 5件 → 7件に**増えた**。落としてはいけない実在の店:
#   「町田商店練馬土支田店」「町田商店ニトリ成増店」「町田商店仙台吉成店」
#     … 町田市が実在するのでラーメンチェーン「町田商店」が丸ごと落ちた
#   「村上うどん」「町中華あがっ亭」「本町酒場」「西村麺業」「呉市役所食堂」
# 第1版は業態語の番人を持ちながら行政区画の判定が雑（[市区町村]1文字）で、
# 第2版は判定が正しいのに番人が無い。**両方を同時に満たす版**にする。
# 【自戒】番人を名前**全体**に当てたら、地名に含まれる字で誤作動した。
# 「名古屋市中区栄」の**屋**、「尾道市土堂」の**堂**。番人は**住所を剥がした残り**にだけ当てる。
# 裸の「堂」は地名に出やすいので外し、「食堂」だけを見る。
BIZ_WORD = re.compile(
    r"(店|屋|亭|軒|房|舎|庵|苑|館|坊|処|荘|食堂|酒場|居酒屋|寿司|鮨|丼|麺|"
    r"そば|うどん|ラーメン|らーめん|中華|洋食|和食|カフェ|cafe|バル|バー|"
    r"レストラン|キッチン|kitchen|ダイニング|ベーカリー|パン|菓子|珈琲|喫茶)",
    re.I)


def rule1(name: str) -> bool:
    return bool(VENUE_TAIL.search(name))


def make_rule2(known_admin: set[str]):
    """屋号が**実在の市区町村名**で始まるなら住所行とみなす。"""
    def rule2(name: str) -> bool:
        s = _PREF_HEAD.sub("", name, count=1)   # 先頭の都道府県は剥がす
        # 実在の市区町村名で始まるか。**最長**の前置を採る（名古屋市中区 > 名古屋市）
        best = 0
        for m in re.finditer(r"[市区町村]", s):
            if s[: m.end()] in known_admin:
                best = m.end()
        if best == 0:
            return False
        # 番人は**住所を剥がした残り**にだけ当てる
        return not BIZ_WORD.search(s[best:])
    return rule2


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=40)
    args = ap.parse_args()

    matcher = NameMatcher()
    # 実在の市区町村名の集合を母集団の locality 列から作る（手書きしない）
    known_admin: set[str] = set()
    for loc, _reg in matcher.area.values():
        if not loc:
            continue
        s = _PREF_HEAD.sub("", loc, count=1)
        # 【自戒】ここで s[:1] のような**1文字の前置**まで入れていた。
        # 「町田市」から「町」が入り、ラーメンチェーン「町田商店」が丸ごと落ちた。
        for m in re.finditer(r"[市区町村]", s):
            head = s[: m.end()]
            if len(head) >= 2:
                known_admin.add(head)
        if len(s) >= 2:
            known_admin.add(s)
    known_admin.discard("")
    print(f"実在の市区町村トークン {len(known_admin):,} 種", file=sys.stderr)
    rule2 = make_rule2(known_admin)

    state = json.loads(STATE.read_text(encoding="utf-8"))
    ch = state["channels"]

    pairs: list[tuple[str, str]] = []
    n_videos: collections.Counter = collections.Counter()
    for k in ch:
        for v in ch[k].get("videos") or []:
            t = (v.get("title") or "").strip()
            if not t:
                continue
            for r in matcher.match_corroborated(t):
                pairs.append((r, t))
                n_videos[r] += 1
    stores = set(n_videos)
    print(f"(店, 動画) 対 {len(pairs):,} / distinct 店 {len(stores):,}\n", file=sys.stderr)

    d1 = {s for s in stores if rule1(s)}
    d2 = {s for s in stores if rule2(s)}
    drop = d1 | d2
    p1 = [p for p in pairs if p[0] in d1]
    p2 = [p for p in pairs if p[0] in d2]
    pd = [p for p in pairs if p[0] in drop]

    print(f"=== 規則が落とす量 ===", file=sys.stderr)
    print(f"  規則1（容器の型）      店 {len(d1):>5,}  対 {len(p1):>6,}", file=sys.stderr)
    print(f"  規則2（地名のみ）      店 {len(d2):>5,}  対 {len(p2):>6,}", file=sys.stderr)
    print(f"  合計（重複除去）       店 {len(drop):>5,} = {len(drop)/len(stores)*100:.2f}%"
          f"  対 {len(pd):>6,} = {len(pd)/len(pairs)*100:.2f}%", file=sys.stderr)

    def pick(lst, tag):
        seen, out = set(), []
        for s, t in sorted(lst, key=lambda p: hashlib.sha256(
                f"{tag}/{p[0]}/{p[1]}".encode()).hexdigest()):
            if s in seen:
                continue
            seen.add(s)
            loc, reg = matcher.area.get(s, ("", ""))
            out.append({"store_key": s, "locality": loc, "region": reg,
                        "title": t, "support": n_videos[s],
                        "by_rule1": s in d1, "by_rule2": s in d2})
            if len(out) >= args.sample:
                break
        return out

    sample = pick(pd, "EXCL-v3-fresh")
    print(f"\n=== 落ちる屋号の標本（{len(sample)}件・SHA-256順・屋号は重複させない）===",
          file=sys.stderr)
    for i, r in enumerate(sample, 1):
        tag = ("1" if r["by_rule1"] else "") + ("2" if r["by_rule2"] else "")
        print(f"{i:>3}. [規則{tag}] 屋号「{r['store_key']}」 {r['region']}{r['locality']}"
              f" (support {r['support']})", file=sys.stderr)
        print(f"     {r['title'][:86]}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "matcher_exclusion.json"
    p.write_text(json.dumps(
        {"n_pairs": len(pairs), "n_stores": len(stores),
         "rule1": {"n_stores": len(d1), "n_pairs": len(p1),
                   "stores": sorted(d1)[:200]},
         "rule2": {"n_stores": len(d2), "n_pairs": len(p2),
                   "stores": sorted(d2)[:200]},
         "drop_total": {"n_stores": len(drop), "n_pairs": len(pd),
                        "pct_stores": len(drop) / len(stores) * 100,
                        "pct_pairs": len(pd) / len(pairs) * 100},
         "sample": sample,
         "caveat": "規則が落とすものを目視して妥当性を見る。規則を作った80件とは別の標本。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
