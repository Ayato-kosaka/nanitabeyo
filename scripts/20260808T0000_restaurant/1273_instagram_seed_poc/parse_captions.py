#!/usr/bin/env python3
"""#1273 フェーズA: 収集済みキャプション(infl_captions.jsonl)を解析し、被覆を測定する。

パイプライン③④のローカル実装（測定用）。BigQuery の sns_post_parsed / sns_coverage に
対応する中間結果を out/ に出力する。BQ ロードは MCP(execute_sql) 経由で別途行う。

注意（暫定・本実装との差分）:
- google_place_id / dish_category_id(QID) はまだ resolve API を通していない。
  ここでは店 = 正規化住所、カテゴリ = 132 日本語名のキーワード一致で近似している。
  本番は resolve（単一頭脳）で google_place_id と QID を得て置き換える（写経しない）。
"""
import json, re, unicodedata, os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

PREF = ('北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|'
        '神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|'
        '大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|'
        '福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県')
pref_rx = re.compile('(' + PREF + ')')
city_rx = re.compile('(' + PREF + ')(.+?[市区町村])')


def norm(s):
    return re.sub(r'[ 　]', '', re.sub(r'[-−ー―–—‐]', '-', unicodedata.normalize('NFKC', s)))


def find_addr(cap):
    m = pref_rx.search(cap)
    if not m:
        return None, None, None
    tail = re.split(r'[「【『\n]', cap[m.start():])[0].strip()
    core = norm(tail)
    if not (6 <= len(core) <= 40):
        core = norm(cap[m.start():m.start() + 30])
    cm = city_rx.search(cap)
    return core, m.group(1), (cm.group(2) if cm else None)


def find_store(cap):
    for op, cl in [('「', '」'), ('【', '】'), ('『', '』')]:
        i = cap.find(op)
        if i >= 0:
            j = cap.find(cl, i)
            if j > i:
                return cap[i + 1:j].strip()[:40]
    return None


def main():
    cats = json.load(open(os.path.join(OUT, 'dish_categories_jp.json')))['categories_ja']
    cats_sorted = sorted(cats, key=len, reverse=True)

    def find_cat(cap):
        for c in cats_sorted:
            if c in cap:
                return c
        return None

    rows, seen = [], set()
    for line in open(os.path.join(OUT, 'infl_captions.jsonl')):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        cap, link, h = r.get('cap') or '', r.get('link') or '', r.get('h')
        mm = re.search(r'/(reel|p|tv)/([A-Za-z0-9_-]+)', link)
        if not mm:
            continue
        sc = mm.group(2)
        if sc in seen:
            continue
        seen.add(sc)
        addr, region, city = find_addr(cap)
        rows.append(dict(post_id='ig:' + sc, handle=h, addr=addr, region=region, city=city,
                         store=find_store(cap), cat=find_cat(cap), link=link))

    tot = len(rows)
    both = [r for r in rows if r['addr'] and r['cat']]
    cov = defaultdict(lambda: [set(), 0])
    for r in both:
        if not r['city']:
            continue
        k = (r['cat'], r['region'], r['city'])
        cov[k][0].add(r['addr'])
        cov[k][1] += 1
    covrows = [dict(dish_category=k[0], region=k[1], city=k[2], distinct_store=len(v[0]), post_count=v[1])
               for k, v in cov.items()]
    covrows.sort(key=lambda x: -x['distinct_store'])

    json.dump(rows, open(os.path.join(OUT, 'parsed_local.json'), 'w'), ensure_ascii=False)
    json.dump(covrows, open(os.path.join(OUT, 'coverage_local.json'), 'w'), ensure_ascii=False)
    print(f"posts={tot} with_addr={sum(1 for r in rows if r['addr'])} "
          f"with_cat={sum(1 for r in rows if r['cat'])} with_both={len(both)}")
    print(f"distinct_stores(norm addr)={len(set(r['addr'] for r in rows if r['addr']))} "
          f"cells={len(covrows)} categories={len(set(r['cat'] for r in rows if r['cat']))}/134 "
          f"cities={len(set((r['region'],r['city']) for r in both if r['city']))}")


if __name__ == '__main__':
    main()
