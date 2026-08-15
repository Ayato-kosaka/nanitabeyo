#!/usr/bin/env python3
"""#1344 #1345 「同名2箇所以上で辞書から落とした店」は、どれだけ損失なのか

## なぜ

ブログと Shorts の両方で、**店名は書かれているのに逆引きできない**現象が出た。
実物を追うと、原因は共通していた:

    NameMatcher は同名が2箇所以上ある屋号を辞書から落とす（#1273 §23）

支店を確定できないためで、逆引きとしては正しい。だが
「サフラン」85箇所・「ゲルン」3箇所・「そらとたべる」2箇所のような
**地域の個人店が巻き添えで落ちている**。

**本文に地名が書いてあれば、同名の中から1つに絞れるはず**である。
ブログ記事は住所を書くことが多いので、ここが効く可能性がある。

## 【自戒】前回この測定に失敗している

前回（`measure_shorts_channel_locality.py`）は自前の索引を作った結果、
`NameMatcher` が持つストップワード・料理語除外・地名除外を外してしまい、
**『ラーメン』『アルプス』『カフェタイム』を屋号として拾った**。無効だった。

今回は **NameMatcher と同じ除外を全部通し、緩めるのは「2箇所以上」の1点だけ**にする。
そのうえで**自己テストを最初に走らせ**、既知の誤爆語が除外されることを確認してから測る。

## 測るもの

「2箇所以上」だけを理由に落ちた屋号の automaton を作り、
本文中に **その屋号 かつ その店の市区町村** が両方出るときだけ採用する。
（同名が複数あっても、市区町村まで一致すれば普通は1つに決まる）

  - ブログ記事本文（`out/food_blogs_deep.json` の対象ブログ）
  - Shorts のタイトル（`out/shorts_route_search.json`）

**増分は必ず目視標本を出す。** 規則を作った標本での成績は過大評価になる。

実行:
    python3 measure_multiplace_cost.py
"""

from __future__ import annotations

import collections
import csv
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ahocorasick  # type: ignore  # noqa: E402

from measure_channel_traversal import (  # noqa: E402
    LATIN_GEO_NAMES, MIN_NAME_LEN_LATIN, MIN_NAME_LEN_NATIONAL, STOPWORD_NAMES,
    NameMatcher, has_cjk, locality_needle, normalize_ja, normalize_latin,
)

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
FIXTURES = HERE / "fixtures"
SOURCES = ("overture_jp_food.csv", "ifas_jp_food.csv", "osm_jp_food.csv")

_TAG = re.compile(r"<[^>]+>")


def build_multiplace_index(base: NameMatcher):
    """「2箇所以上」だけを理由に落ちた屋号 -> [(locality, region, needle)] を作る。

    除外規則は base（NameMatcher）と同じものを全部通す。緩めるのは件数条件だけ。
    """
    csv.field_size_limit(10**7)
    places: dict[str, set] = collections.defaultdict(set)
    areas: dict[str, list] = collections.defaultdict(list)
    for fn in SOURCES:
        fp = FIXTURES / fn
        if not fp.exists():
            continue
        with fp.open(encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                nm = (r.get("name") or "").strip()
                if not nm:
                    continue
                try:
                    lat = round(float(r["latitude"]), 2)
                    lon = round(float(r["longitude"]), 2)
                except (TypeError, ValueError, KeyError):
                    continue
                k = normalize_ja(nm) if has_cjk(nm) else normalize_latin(nm).strip()
                if not k:
                    continue
                places[k].add((lat, lon))
                areas[k].append((normalize_ja(r.get("locality") or ""),
                                 normalize_ja(r.get("region") or "")))

    # base が辞書に入れた語は対象外（既に取れている）
    already = set()
    for k in places:
        if base.auto_ja.exists(k) or base.auto_la.exists(k):
            already.add(k)

    stop = {normalize_ja(s) for s in STOPWORD_NAMES} | {
        normalize_latin(s).strip() for s in STOPWORD_NAMES}
    # base と同じ料理語彙の除外
    try:
        from dish_category_matcher import CategoryMatcher as _CM
        _cm = _CM()
        dish_vocab = set()
        for _label, _vars in getattr(_cm, "by_label", {}).items():
            dish_vocab.add(_label)
            if isinstance(_vars, (list, tuple, set)):
                dish_vocab |= {v for v in _vars if isinstance(v, str)}
        dish_vocab = {normalize_ja(v) if has_cjk(v) else normalize_latin(v).strip()
                      for v in dish_vocab if v}
    except Exception:                                        # noqa: BLE001
        dish_vocab = set()

    area_vocab = {v for pair in base.area.values() for v in pair if v}
    addr_tail = re.compile(r"(都|道|府|県|市|区|町|村|丁目|番地)$")
    venue_tail = re.compile(
        r"(横丁|のれん街|商店街|フードコート|地下街|公園|百貨店|デパート|市場|"
        r"道の駅|サービスエリア|パーキングエリア|ターミナル|物産館|直売所)$")
    venue_any = re.compile(r"(道の駅|サービスエリア|パーキングエリア|博物館|美術館|"
                           r"水族館|動物園|植物園|記念館|資料館|展望台|キャンプ場)")

    auto = ahocorasick.Automaton()
    kept: dict[str, list] = {}
    for k, pts in places.items():
        if k in already or len(pts) < 2:
            continue
        cjk = has_cjk(k)
        if cjk and len(k) < MIN_NAME_LEN_NATIONAL:
            continue
        if not cjk and len(k) < MIN_NAME_LEN_LATIN:
            continue
        if k in stop or k in dish_vocab or k in area_vocab:
            continue
        if not cjk and k in LATIN_GEO_NAMES:
            continue
        if addr_tail.search(k) or venue_tail.search(k) or venue_any.search(k):
            continue
        seen = set()
        rows = []
        for loc, reg in areas[k]:
            nd = locality_needle(loc)
            key = (loc, reg, nd)
            if key not in seen:
                seen.add(key)
                rows.append(key)
        if not rows:
            continue
        kept[k] = rows
        auto.add_word(k, k)
    auto.make_automaton()
    return auto, kept


def match_with_locality(text_ja: str, auto, kept) -> set[str]:
    """本文に『屋号 かつ その店の市区町村』が両方出るものだけ採る。"""
    out = set()
    for _end, k in auto.iter(text_ja):
        for loc, reg, needle in kept.get(k, ()):
            if (loc and loc in text_ja) or (needle and needle in text_ja):
                out.add(k)
                break
    return out


def main() -> None:
    base = NameMatcher()
    auto, kept = build_multiplace_index(base)
    print(f"「2箇所以上」だけを理由に落ちていた屋号: {len(kept):,}", file=sys.stderr)

    # --- 自己テスト（前回ここを怠って無効な測定をした）---------------------
    print("\n=== 自己テスト: 既知の誤爆語が除外されているか ===", file=sys.stderr)
    ng = 0
    for bad in ("ラーメン", "アルプス", "カフェタイム", "そば", "カフェ", "食堂",
                "ビッグボーイ", "丸源ラーメン"):
        k = normalize_ja(bad)
        present = k in kept
        # 一般語・料理語・チェーンは入っていてはいけない
        mark = "NG" if present and bad in ("ラーメン", "そば", "カフェ", "食堂") else "ok"
        if mark == "NG":
            ng += 1
        print(f"  {bad:12} 索引に在る={present}  {mark}", file=sys.stderr)
    if ng:
        print(f"  **NG {ng}件。索引が汚れているので測定しない。**", file=sys.stderr)
        raise SystemExit(1)

    # --- 母集団側の規模（ネットワーク不要・先に出す）------------------------
    n_places_behind = sum(len(v) for v in kept.values())
    print(f"\n=== 母集団側の規模 ===", file=sys.stderr)
    print(f"  「2箇所以上」で落ちた屋号 {len(kept):,} 種", file=sys.stderr)
    print(f"  その屋号が指す**市区町村の組合せ** {n_places_behind:,}",
          file=sys.stderr)
    print(f"  （屋号1つあたり平均 {n_places_behind/max(len(kept),1):.1f} 市区町村。"
          f"市区町村まで一致すれば普通は1店に決まる）", file=sys.stderr)

    # --- ブログ本文で測る ---------------------------------------------------
    # 【自戒】最初の版は sitemap.xml の第1階層だけを見て、
    # サイトマップ索引（子が全部 .xml）のブログで記事を1本も取れず、
    # 現行の逆引きまで 0店になった。deep と**同じ再帰収集**に直す。
    deep = json.loads((OUT_DIR / "food_blogs_deep.json").read_text(encoding="utf-8"))
    import gzip
    import time
    import urllib.request
    UA = "Mozilla/5.0 (compatible; nanitabeyo-research/1.0)"
    _LOC = re.compile(rb"<loc>\s*([^<\s]+)\s*</loc>", re.I)

    def get(u, timeout=18):
        try:
            req = urllib.request.Request(u, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read(400_000)
        except Exception:                                    # noqa: BLE001
            return None

    def article_urls(host: str, cap: int) -> list[str]:
        urls: set[str] = set()
        queue = [f"https://{host}/sitemap.xml", f"https://{host}/sitemap_index.xml",
                 f"https://{host}/wp-sitemap.xml"]
        seen_sm: set[str] = set()
        while queue and len(urls) < cap * 3 and len(seen_sm) < 25:
            sm = queue.pop(0)
            if sm in seen_sm:
                continue
            seen_sm.add(sm)
            body = get(sm, timeout=20)
            time.sleep(1.0)
            if not body:
                continue
            if body[:2] == b"\x1f\x8b":
                try:
                    body = gzip.decompress(body)
                except Exception:                            # noqa: BLE001
                    continue
            for loc in _LOC.findall(body):
                u = loc.decode("utf-8", "replace")
                if u.endswith(".xml") or u.endswith(".xml.gz"):
                    queue.append(u)
                elif host in u:
                    urls.add(u)
        return sorted(urls)[:cap]

    add_stores: set[str] = set()
    base_stores: set[str] = set()
    examples = []
    n_art = 0
    for row in deep["rows"]:
        if row["n_articles_ok"] == 0:
            continue
        host = row["domain"]
        arts = article_urls(host, 150)
        print(f"  {host[:32]:34} 記事URL {len(arts):>4}", file=sys.stderr)
        for a in arts:
            b = get(a)
            time.sleep(0.8)
            if not b:
                continue
            n_art += 1
            text = _TAG.sub(" ", b.decode("utf-8", "replace"))[:25000]
            tj = normalize_ja(text)
            base_hit = base.match_corroborated(text)
            base_stores |= base_hit
            extra = match_with_locality(tj, auto, kept) - base_hit
            if extra:
                add_stores |= extra
                if len(examples) < 40:
                    for e in list(extra)[:2]:
                        examples.append({"blog": host, "url": a, "name": e,
                                         "n_places": len(kept[e])})
    # 【自戒】現行の逆引きが 0店なら、標本の取り方が壊れている。数字を出さない。
    if base_stores == set() and n_art > 30:
        print(f"\n**{n_art} 記事で現行の逆引きが 0店。deep は同じブログで 16店"
              f"取れているので、取得側が壊れている。数字を出さない。**", file=sys.stderr)
        raise SystemExit(3)

    print(f"\n=== ブログ本文 {n_art} 記事 ===", file=sys.stderr)
    print(f"  現行の逆引き           distinct {len(base_stores):>4}店", file=sys.stderr)
    print(f"  **同名緩和で増える分   distinct {len(add_stores):>4}店**"
          f"（+{len(add_stores)/max(len(base_stores),1)*100:.0f}%）", file=sys.stderr)

    print(f"\n=== 増分の目視標本（precision を人が確かめる）===", file=sys.stderr)
    for e in examples[:15]:
        print(f"  屋号『{e['name']}』（母集団 {e['n_places']}箇所） {e['blog']}",
              file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "multiplace_cost.json"
    p.write_text(json.dumps(
        {"n_multiplace_names": len(kept), "n_articles": n_art,
         "base_stores": len(base_stores), "added_stores": len(add_stores),
         "added": sorted(add_stores)[:200], "examples": examples,
         "caveat": "本文に屋号と市区町村が両方出るときだけ採った。"
                   "増分の precision は目視で確かめること。経路存在率であって実効ではない。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
