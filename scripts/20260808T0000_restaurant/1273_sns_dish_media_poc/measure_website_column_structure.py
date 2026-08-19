#!/usr/bin/env python3
"""#1273 `website` 列は誰のサイトを指しているのか（母集団規模で数える）

## なぜ

自社サイト経路の店単位 precision を 32 店まで広げて目視したところ、**偽 12 件の
うち 6 件が「別主体のサイト」**だった（乃が美 / Francfranc の食器販売ページ /
弘前観光協会 / SUBWAY のロゴ / 個人ブログ）。これは料理画像の判定器を
いくら良くしても取れない。**`website` 列そのものの質**の問題である。

n=31 の目視で「半分が別主体」と言われても、それが標本の偶然なのか構造なのかは
分からない。**母集団の全部を数えれば決着がつく**ので数えた。

## 測り方

BigQuery の Overture 公開データ `bigquery-public-data.overture_maps.place` で、
日本の飲食 15 カテゴリ（`fixtures/overture_jp_food.csv` と同じ `basic_category`）
のうち `websites` を持つ行を取り、**URL のホストごとに何店が指しているか**を数えた。
ホストを次の7クラスに分けている（クラス分けは SQL 中の正規表現がすべてで、
目視は入っていない）。

    A ポータル（食べログ・ぐるなび・ホットペッパー・出前系）
    B SNS（Instagram / X / Facebook / TikTok / YouTube / LINE）
    C ブログ・無料ホスティング（アメブロ・エキサイト・FC2・ジオシティーズ…）
    D サイト作成サービス（グーペ・Wix・Jimdo・owst…店ごとのページを持つ）
    E チェーン本社（50店以上が同じホストを指す。A〜D 以外）
    F 複数店で共有（2〜49店）
    G 1店だけ（独自サイトの可能性が高い）

**スキャンは 6.3GB / 課金 0.87GB。** BigQuery の無償枠（月1TB）の内側であり、
制約(b)「無料でないものは使わない」に反しない。

## この測定が言えないこと

  - **Overture のみ**である。母集団 1,132,482 は Overture + IFAS + OSM の3ソース
  - `websites` の**先頭1件**しか見ていない
  - 「同じホストを何店が指すか」であって、**ページが店ごとに分かれているかは別**。
    ポータルは店ごとのページを持つ（帰属できないのは*画像*であって URL ではない）
  - クラス E と F の切り方（50店）に理論的根拠はない。**バケット別の数も併記する**

実行:
    python3 measure_website_column_structure.py

SQL は本ファイル末尾の SQL 定数に丸ごと入れてある。実行結果は
`out/website_column_structure.json`（BigQuery MCP 経由で取得済み）。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

POP_TOTAL = 1_132_482          # #843 母集団（3ソース）
OVERTURE_FOOD = 789_612        # fixtures/overture_jp_food.csv の行数

# 目視 32 店（out/own_site_by_store_labels_n32.json）の判定。
# ホスト規模と突き合わせて「別主体ほど外す」が構造かどうかを見る。
VERDICTS = {
    "ameblo.jp": "偽", "hachiban.co.jp": "境界", "cocos-jpn.co.jp": "真",
    "masala-kaoru.com": "真", "koganeseimensyo.com": "真", "cimosel.exblog.jp": "真",
    "kukururu-okinawa.com": "真", "coroya.com": "真", "akan-malt-beef.jp": "境界",
    "flojapon.co.jp": "真", "nogaminopan.com": "偽", "kunimaru.net": "真",
    "edaya.owst.jp": "真", "ichibanya.co.jp": "偽", "torigin-ginza.jp": "真",
    "santune.co.jp": "偽", "francfranc.com": "偽", "oishiiocha.com": "偽",
    "r.gnavi.co.jp": "偽", "tottokimiso.com": "偽", "sukiya.jp": "真",
    "hodatsushimizu.jp": "偽", "hirosaki-kanko.or.jp": "偽", "kuwapan.jp": "真",
    "tsukubamirai-yosoji.com": "真", "torikizoku.co.jp": "真", "isuminavi.jp": "真",
    "ponystoy.com": "偽", "torisen-kagoshima.food96.com": "偽",
}
# sukiya.jp と r.gnavi.co.jp は標本に2店ずつある（#21/#22、#19/#29）。
DOUBLED = {"sukiya.jp": 2, "r.gnavi.co.jp": 2}
PORTAL_LIKE = {"r.gnavi.co.jp", "ameblo.jp", "isuminavi.jp", "hirosaki-kanko.or.jp",
               "torisen-kagoshima.food96.com", "cimosel.exblog.jp", "hodatsushimizu.jp"}


def main() -> None:
    d = json.loads((OUT_DIR / "website_column_structure.json").read_text(encoding="utf-8"))
    n = d["n_with_website"]

    print("=== `website` 列のホストは誰のものか（Overture 日本の飲食）===", file=sys.stderr)
    print(f"  website を持つ店 **{n:,}**（Overture 飲食 {OVERTURE_FOOD:,} の "
          f"{n/OVERTURE_FOOD*100:.2f}%） / 異なるホスト {d['n_distinct_hosts']:,}",
          file=sys.stderr)
    for c in d["classes"]:
        print(f"  {c['klass']:34} {c['n_stores']:>7,} 店  **{c['pct']:5.2f}%**"
              f"  （ホスト {c['n_hosts']:,}）", file=sys.stderr)

    own = next(c for c in d["classes"] if c["klass"].startswith("G"))
    builder = next(c for c in d["classes"] if c["klass"].startswith("D"))
    portal = next(c for c in d["classes"] if c["klass"].startswith("A"))
    sns = next(c for c in d["classes"] if c["klass"].startswith("B"))
    chain = next(c for c in d["classes"] if c["klass"].startswith("E"))
    shared = next(c for c in d["classes"] if c["klass"].startswith("F"))

    store_specific = own["n_stores"] + builder["n_stores"]
    not_the_store = portal["n_stores"] + sns["n_stores"]
    print(f"\n  **店に固有の URL（G+D）{store_specific:,} = "
          f"{store_specific/n*100:.2f}%**", file=sys.stderr)
    print(f"  **店のサイトですらない（A ポータル + B SNS）{not_the_store:,} = "
          f"{not_the_store/n*100:.2f}%**", file=sys.stderr)
    print(f"  写真が全店で共通になる（E チェーン + F 共有）"
          f"{chain['n_stores']+shared['n_stores']:,} = "
          f"{(chain['n_stores']+shared['n_stores'])/n*100:.2f}%", file=sys.stderr)
    print(f"\n  母集団 {POP_TOTAL:,} に対する『店固有サイトを持つ店』は "
          f"**{store_specific/POP_TOTAL*100:.2f}%**"
          f"（Overture 飲食に対しては {store_specific/OVERTURE_FOOD*100:.2f}%）",
          file=sys.stderr)

    print("\n=== ホスト規模のバケット（A〜D を除いた分）===", file=sys.stderr)
    for b in d["buckets_excluding_portal_sns_blog_builder"]:
        print(f"  {b['bucket']:9} {b['n_stores']:>7,} 店  （ホスト {b['n_hosts']:,}）",
              file=sys.stderr)

    print("\n=== 目視32店をホスト規模で層別（構造の裏取り）===", file=sys.stderr)
    hc = d["sample_host_counts"]
    strata = {"ポータル・ブログ・自治体": [], "1〜4店(店固有)": [],
              "5〜49店(小規模チェーン)": [], "50店以上(チェーン本社)": []}
    for host, v in VERDICTS.items():
        cnt = hc.get(host, 0)
        key = ("ポータル・ブログ・自治体" if host in PORTAL_LIKE
               else "50店以上(チェーン本社)" if cnt >= 50
               else "5〜49店(小規模チェーン)" if cnt >= 5
               else "1〜4店(店固有)")
        strata[key] += [v] * DOUBLED.get(host, 1)
    for key, vs in strata.items():
        t = vs.count("真")
        print(f"  {key:24} 真 {t}/{len(vs)} = **{t/len(vs)*100:5.1f}%**"
              f"（境界 {vs.count('境界')}）", file=sys.stderr)
    print("  ※ 各層 n が一桁なので**差を主張できる標本ではない**。"
          "母集団側の構造（上の表）が主で、これは整合性の確認である。", file=sys.stderr)

    p = OUT_DIR / "website_column_structure_summary.json"
    p.write_text(json.dumps({
        "n_with_website": n,
        "store_specific": store_specific,
        "store_specific_pct_of_site_layer": store_specific / n * 100,
        "store_specific_pct_of_population": store_specific / POP_TOTAL * 100,
        "not_the_store_pct": not_the_store / n * 100,
        "chain_or_shared_pct": (chain["n_stores"] + shared["n_stores"]) / n * 100,
        "strata": {k: {"真": v.count("真"), "境界": v.count("境界"), "n": len(v)}
                   for k, v in strata.items()},
        "caveat": d["caveat"],
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


SQL = r"""
-- 実行: BigQuery（billing project = food-scroll）。スキャン 6.3GB / 課金 0.87GB。
WITH jp AS (
  SELECT LOWER(REGEXP_EXTRACT(websites.list[SAFE_OFFSET(0)].element,
                              r'^(?:https?://)?(?:www\.)?([^/:?#]+)')) AS host
  FROM `bigquery-public-data.overture_maps.place`
  WHERE ST_INTERSECTSBOX(geometry, 122.0, 24.0, 154.0, 46.0)
    AND addresses.list[SAFE_OFFSET(0)].element.country = 'JP'
    AND basic_category IN ('alcoholic_beverage_venue','bar','brewery','cafe',
      'casual_eatery','coffee_shop','distillery','fast_food_restaurant','food_court',
      'food_truck_stand','lounge','non_alcoholic_beverage_venue','restaurant',
      'smoothie_juice_bar','winery')
    AND ARRAY_LENGTH(websites.list) > 0
), g AS (
  SELECT host, COUNT(*) AS n FROM jp WHERE host IS NOT NULL GROUP BY host
), c AS (
  SELECT host, n, CASE
    WHEN REGEXP_CONTAINS(host, r'(^|\.)(tabelog\.com|gnavi\.co\.jp|hotpepper\.jp|hitosara\.com|localplace\.jp|ekiten\.jp|navitime\.co\.jp|mapion\.co\.jp|its-mo\.com|loco\.yahoo\.co\.jp|gourmet\.yahoo\.co\.jp|retty\.me|food96\.com|goo\.ne\.jp|epark\.jp|ubereats\.com|demae-can\.com)$') THEN 'A ポータル(グルメ/出前)'
    WHEN REGEXP_CONTAINS(host, r'(^|\.)(instagram\.com|twitter\.com|x\.com|facebook\.com|tiktok\.com|youtube\.com|line\.me|lin\.ee|threads\.net)$') THEN 'B SNS'
    WHEN REGEXP_CONTAINS(host, r'(^|\.)(ameblo\.jp|exblog\.jp|hatenablog\.com|livedoor\.jp|livedoor\.blog|blog\.jp|fc2\.com|geocities\.jp|blogspot\.com|wordpress\.com|jugem\.jp|seesaa\.net|cocolog-nifty\.com|webnode\.jp|crayonsite\.com|crayonsite\.net)$') THEN 'C ブログ・無料ホスティング'
    WHEN REGEXP_CONTAINS(host, r'(^|\.)(goope\.jp|wixsite\.com|jimdofree\.com|jimdo\.com|shopselect\.net|base\.shop|thebase\.in|owst\.jp|gorp\.jp|storeinfo\.jp|net\.jp)$') THEN 'D サイト作成サービス(店ごとのサブドメイン)'
    WHEN n >= 50 THEN 'E チェーン本社(50店以上・上のどれでもない)'
    WHEN n >= 2  THEN 'F 複数店で共有(2-49)'
    ELSE 'G 1店だけ(独自サイトの可能性)' END AS klass
  FROM g
)
SELECT klass, COUNT(*) AS n_hosts, SUM(n) AS n_stores,
       ROUND(SUM(n) * 100.0 / (SELECT SUM(n) FROM c), 2) AS pct
FROM c GROUP BY klass ORDER BY n_stores DESC;
"""


if __name__ == "__main__":
    main()
