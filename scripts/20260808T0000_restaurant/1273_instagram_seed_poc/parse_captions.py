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

# 都道府県が省略され市区町村から始まる住所を拾うフォールバック。
# 「名古屋市東区葵3丁目…」のように市区町村トークンの直後が番地(数字/丁目/条)であるものだけ採る。
# ノイズ対策: 市区町村名は2文字以上 / 「市内・区内」除外 / 住所内に数字必須（下の検証で担保）。
citylead_rx = re.compile(r'([一-龥ァ-ヶ]{2,4}[市区町村](?![内])(?:[一-龥ァ-ヶ]{1,4}区)?[一-龥ァ-ヶ0-9０-９][0-9０-９一-龥ァ-ヶ\-−ー丁目番地条]{1,28})')
# 主要市の都道府県マップ（region を埋められる分だけ。無ければ region=None のまま city で集計する）
CITY_PREF = {
    '札幌市': '北海道', '仙台市': '宮城県', 'さいたま市': '埼玉県', '千葉市': '千葉県',
    '横浜市': '神奈川県', '川崎市': '神奈川県', '相模原市': '神奈川県', '名古屋市': '愛知県',
    '新潟市': '新潟県', '静岡市': '静岡県', '浜松市': '静岡県', '京都市': '京都府',
    '大阪市': '大阪府', '堺市': '大阪府', '神戸市': '兵庫県', '岡山市': '岡山県',
    '広島市': '広島県', '北九州市': '福岡県', '福岡市': '福岡県', '熊本市': '熊本県',
}


def norm(s):
    return re.sub(r'[ 　]', '', re.sub(r'[-−ー―–—‐]', '-', unicodedata.normalize('NFKC', s)))


def _city_token(s):
    cm = re.search(r'([一-龥ァ-ヶ]{1,5}?[市区町村])', s)
    return cm.group(1) if cm else None


def find_addr(cap):
    m = pref_rx.search(cap)
    if m:
        tail = re.split(r'[「【『\n]', cap[m.start():])[0].strip()
        core = norm(tail)
        if not (6 <= len(core) <= 40):
            core = norm(cap[m.start():m.start() + 30])
        cm = city_rx.search(cap)
        return core, m.group(1), (cm.group(2) if cm else None)
    # フォールバック: 市区町村始まりの住所（都道府県が省略されている）
    cm = citylead_rx.search(cap)
    if cm:
        core = norm(re.split(r'[「【『\n]', cm.group(1))[0].strip())
        # 番地の数字が無いもの（施設名・「市内」等）はノイズとして落とす
        if 6 <= len(core) <= 40 and re.search(r'[0-9]', core):
            city = _city_token(cm.group(1))
            region = CITY_PREF.get(city)  # 主要市なら region を補完、他は None
            return core, region, city
    return None, None, None


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

    # 表記ゆれの回収（分類の磨き上げ）。カテゴリ正式名(カタカナ)に一致しないが
    # 同義の別表記で出現するものを拾う。exact 一致を先に試し、外れたときだけ使う
    # （「もつ鍋」等の専用カテゴリを「鍋料理」より優先するため）。
    VARIANTS = {
        'ウナギ': ['うなぎ', '鰻'], '牛丼': ['牛丼'], '親子丼': ['親子丼'], '天丼': ['天丼'],
        '冷やし中華': ['冷し中華'], '担担麺': ['担々麺', '担担麺', 'タンタンメン'],
        '酢豚': ['酢豚'], '回鍋肉': ['ホイコーロー', '回鍋肉'], '鍋料理': ['鍋料理', '火鍋', '寄せ鍋', '水炊き'],
        'カレーうどん': ['カレーうどん'], '生姜焼き': ['生姜焼き', 'しょうが焼き'],
        'もんじゃ焼き': ['もんじゃ'], 'やきとん': ['やきとん', '焼きとん'], 'ホルモン焼き': ['ホルモン焼き', 'ホルモン'],
        '牡蠣料理': ['牡蠣', '生牡蠣'], '蟹料理': ['蟹料理', 'かに料理', '蟹しゃぶ'], '釜飯': ['釜飯', 'かまめし'],
        '牛すじ煮込み': ['牛すじ煮込み', '牛スジ煮込み'], '手羽先唐揚げ': ['手羽先'],
    }
    var_pairs = sorted(((v, cat) for cat, vs in VARIANTS.items() for v in vs),
                       key=lambda x: -len(x[0]))

    def find_cat(cap):
        for c in cats_sorted:
            if c in cap:
                return c
        for v, cat in var_pairs:
            if v in cap:
                return cat
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
