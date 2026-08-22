#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
#1273 population-audit : 分母(Overture JP food_and_drink 789,612)の精査

# #1273 【設計】目的
#   「全店で dish_media カバレッジ70%」の分母が過大でないかを実測で検証する。
#   カテゴリ / confidence / operating_status / 重複 / IFAS 突合 の5軸で母集団を
#   絞り込み、複数の母集団定義ごとに 600店サンプルでのカバレッジを再計算する。
#
# #1273 【仕様】データ源
#   - /tmp/overture-jp.parquet (JP 全 places 4,624,035件)
#     food母集団 = addresses[1].country='JP' AND list_contains(taxonomy.hierarchy,'food_and_drink')
#   - fixtures/ifas_jp_food.csv (264,135件, 食品営業許可=実在の裏付け)
#   - out/supply_ceiling_2026-08-13.json (同一600店サンプル / YouTube生判定)
#   - out/own-website-images.json (同600店のうち website 保有305店の実測)
#
# #1273 【仕様】分母を小さくして達成率を水増しするのが目的ではない。
#   各定義のメリット/デメリットを併記し、オーナーが選べる材料にする。
"""
import json
import os
import re
import unicodedata
from datetime import datetime, timezone

import duckdb

BASE = os.path.dirname(os.path.abspath(__file__))
PARQUET = "/tmp/overture-jp.parquet"
IFAS = os.path.join(BASE, "fixtures", "ifas_jp_food.csv")
SAMPLE = os.path.join(BASE, "out", "supply_ceiling_2026-08-13.json")
OWNSITE = os.path.join(BASE, "out", "own-website-images.json")
OUT = os.path.join(BASE, "out", "population-audit.json")

FOOD_WHERE = ("where addresses[1].country='JP' "
              "AND list_contains(taxonomy.hierarchy,'food_and_drink')")

# #1273 【設計】「料理写真(dish_media)を出す店」かどうかのカテゴリ分類。
#   A: 明確に料理を提供する（皿で出る食事が主商品）
#   B: 料理写真が主商品ではない／飲み物・パン菓子が主（判断が割れる灰色帯）
#   C: 明確に dish_media 対象外（酒類製造・移動販売・フードコート筐体など）
CAT_DISH_CORE = {"restaurant", "casual_eatery", "fast_food_restaurant"}
CAT_GRAY = {"bar", "cafe", "coffee_shop", "non_alcoholic_beverage_venue",
            "lounge", "smoothie_juice_bar"}
CAT_OUT = {"brewery", "winery", "distillery", "food_truck_stand",
           "alcoholic_beverage_venue", "food_court", None}

# gray のうち primary で救済/除外を分ける（居酒屋=sake_bar は料理を出す、
# internet_cafe / beverage_store は出さない）
PRIMARY_RESCUE = {"sake_bar", "pub", "diner", "delicatessen", "bakery",
                  "desserts", "ice_cream_shop", "donuts", "hong_kong_style_cafe"}
PRIMARY_DROP = {"internet_cafe", "beverage_store", "airport_lounge",
                "hookah_bar", "candy_store", "chocolatier", "coffee_roastery"}



# #1273 【仕様】目視精度検証（カテゴリ分類が「料理写真を出す店」を正しく選べているか）
#   SHA-256(id) 昇順で 600店サンプルから 15件を決定的に抽出し、店名+カテゴリを目視判定した。
VISUAL_VERIFICATION = {
    "method": "SHA-256(id)昇順の先頭15件について 店名/basic_category/categories.primary を目視し、"
              "『料理写真(dish_media)を出すべき店か』を人手判定",
    "n": 15,
    "items": [
        {"name": "焼鳥 月見", "cat": "restaurant/chicken_restaurant", "judge": "YES"},
        {"name": "メンバーズNew眞の華", "cat": "bar/bar", "judge": "NO(会員制スナック・飲酒主体)"},
        {"name": "あじ伴", "cat": "restaurant/japanese_restaurant", "judge": "YES"},
        {"name": "昭和ホルモン食堂", "cat": "restaurant/japanese_restaurant", "judge": "YES"},
        {"name": "樹林", "cat": "restaurant/restaurant", "judge": "YES"},
        {"name": "Bbcバムズブリューカフェ", "cat": "coffee_shop/coffee_shop", "judge": "GRAY(珈琲主体)"},
        {"name": "ピザ・テン・フォー飯島店", "cat": "restaurant/pizza_restaurant", "judge": "YES"},
        {"name": "Cafe and Rest Olive", "cat": "cafe/cafe", "judge": "YES(食事提供・strictは取りこぼす)"},
        {"name": "おいしい隠れ家 か和か美", "cat": "restaurant/japanese_restaurant", "judge": "YES"},
        {"name": "ニユーサニー", "cat": "bar/bar", "judge": "NO(スナック)"},
        {"name": "くれしま 西院店", "cat": "bar/sake_bar", "judge": "YES(居酒屋・strictで救済済み)"},
        {"name": "渋谷焼肉 ざぶとん", "cat": "restaurant/japanese_restaurant", "judge": "YES"},
        {"name": "Restaurant hinata", "cat": "restaurant/restaurant", "judge": "YES"},
        {"name": "Trasparente Laluce", "cat": "casual_eatery/bakery", "judge": "GRAY(パン=料理写真か議論あり)"},
        {"name": "鬼助ベニエ", "cat": "casual_eatery/bakery", "judge": "GRAY(菓子)"},
    ],
    "strict_selected": 11, "strict_clear_true_positive": 9, "strict_gray": 2,
    "strict_clear_false_positive": 0,
    "strict_precision_gray_as_fp": 0.818, "strict_precision_gray_as_tp": 1.0,
    "strict_false_negative": 1,  # Cafe and Rest Olive
    "loose_selected": 15, "loose_clear_false_positive": 2,
    "loose_precision_gray_as_tp": 0.867,
}


def norm_name(s: str) -> str:
    # #1273 【仕様】名寄せ用正規化: NFKC→大文字化→空白/記号除去
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s).upper()
    s = re.sub(r"[\s　\-‐―ー・,，.。()（）「」『』【】/／\\&＆'\"!！?？+＋*]", "", s)
    return s


def main():
    con = duckdb.connect()
    # #1273 【バグ】geometry から座標を取るには spatial 拡張が要る
    res = {"generated_at": datetime.now(timezone.utc).isoformat(),
           "slug": "population-audit"}

    q = lambda sql: con.execute(sql).fetchall()
    total = q(f"select count(*) from '{PARQUET}' {FOOD_WHERE}")[0][0]
    res["population_total"] = total

    # ---- 1. カテゴリ内訳 ----
    cats = q(f"""select coalesce(basic_category,'(null)') bc,
                        coalesce(categories.primary,'(null)') pc, count(*) c
                 from '{PARQUET}' {FOOD_WHERE} group by 1,2 order by c desc""")
    by_bc = {}
    for bc, pc, c in cats:
        by_bc.setdefault(bc, {"total": 0, "primary": {}})
        by_bc[bc]["total"] += c
        by_bc[bc]["primary"][pc] = c
    res["basic_category_breakdown"] = {
        k: {"total": v["total"],
            "pct": round(100.0 * v["total"] / total, 2),
            "top_primary": dict(sorted(v["primary"].items(),
                                       key=lambda x: -x[1])[:6])}
        for k, v in sorted(by_bc.items(), key=lambda x: -x[1]["total"])}

    # dish 対象カテゴリ判定式(SQL)
    core = ",".join(f"'{c}'" for c in CAT_DISH_CORE)
    gray = ",".join(f"'{c}'" for c in CAT_GRAY)
    rescue = ",".join(f"'{c}'" for c in PRIMARY_RESCUE)
    drop = ",".join(f"'{c}'" for c in PRIMARY_DROP)
    # strict: core + gray のうち primary で救済されるもののみ
    DISH_STRICT = (f"(basic_category in ({core}) "
                   f" or (basic_category in ({gray}) and categories.primary in ({rescue})))")
    # loose: core + gray 全部 - primary で明確に外れるもの
    DISH_LOOSE = (f"((basic_category in ({core}) or basic_category in ({gray})) "
                  f" and coalesce(categories.primary,'') not in ({drop}))")

    res["dish_category_counts"] = {
        "strict": q(f"select count(*) from '{PARQUET}' {FOOD_WHERE} and {DISH_STRICT}")[0][0],
        "loose": q(f"select count(*) from '{PARQUET}' {FOOD_WHERE} and {DISH_LOOSE}")[0][0],
    }

    # ---- 2. confidence 分布 ----
    conf = q(f"""select case when confidence is null then 'null'
                   when confidence>=0.9 then '0.9-1.0' when confidence>=0.8 then '0.8-0.9'
                   when confidence>=0.7 then '0.7-0.8' when confidence>=0.6 then '0.6-0.7'
                   when confidence>=0.5 then '0.5-0.6' else '<0.5' end b, count(*)
                 from '{PARQUET}' {FOOD_WHERE} group by 1 order by 1 desc""")
    res["confidence_distribution"] = {b: {"n": c, "pct": round(100.0 * c / total, 2)}
                                      for b, c in conf}
    res["confidence_ge_080"] = q(
        f"select count(*) from '{PARQUET}' {FOOD_WHERE} and confidence>=0.8")[0][0]

    # ---- 3. operating_status ----
    res["operating_status"] = {str(a): b for a, b in
                               q(f"select operating_status,count(*) from '{PARQUET}' {FOOD_WHERE} group by 1")}

    # ---- 4. 重複 ----
    # #1273 【仕様】重複3定義:
    #  (a) tight  : 正規化名一致 かつ 約110m グリッド一致（#843の50m名寄せに近い）
    #  (b) loose  : 正規化名一致 かつ 約1.1km グリッド一致（同一施設の座標ブレ吸収）
    #  (c) chain  : 全国で同名が5件以上（チェーン支店。メニューを共有するため
    #               dish_media はブランド単位で1組あれば足りる可能性がある）
    con.execute(f"""create table food as
      select id, names.primary as name, confidence, basic_category,
             categories.primary as pcat,
             (bbox.ymin+bbox.ymax)/2 as lat, (bbox.xmin+bbox.xmax)/2 as lon,
             websites, socials,
             {DISH_STRICT} as dish_strict, {DISH_LOOSE} as dish_loose
      from '{PARQUET}' {FOOD_WHERE}""")
    con.create_function("nn", norm_name, ["VARCHAR"], "VARCHAR")
    con.execute("create table food2 as select *, nn(name) as nname from food")

    dup_tight = q("""select count(*)-count(distinct (nname, round(lat,3), round(lon,3)))
                     from food2 where nname<>''""")[0][0]
    dup_loose = q("""select count(*)-count(distinct (nname, round(lat,2), round(lon,2)))
                     from food2 where nname<>''""")[0][0]
    chain_rows = q("""select count(*) from food2 where nname in
                      (select nname from food2 where nname<>'' group by 1 having count(*)>=5)""")[0][0]
    chain_brands = q("""select count(*) from (select nname from food2 where nname<>''
                        group by 1 having count(*)>=5)""")[0][0]
    res["duplicates"] = {
        "dup_excess_same_name_110m_grid": dup_tight,
        "dup_excess_same_name_1_1km_grid": dup_loose,
        "chain_branch_rows_name_ge5": chain_rows,
        "chain_distinct_names_ge5": chain_brands,
        "population_after_chain_collapse": total - chain_rows + chain_brands,
    }

    # ---- 5. IFAS 突合 ----
    con.execute(f"""create table ifas as
      select nn(name) as nname, cast(latitude as double) lat, cast(longitude as double) lon,
             region from read_csv_auto('{IFAS}')""")
    res["ifas_rows"] = q("select count(*) from ifas")[0][0]
    res["ifas_regions_nonnull"] = q("select count(distinct region) from ifas where region is not null")[0][0]
    # 名前一致 + 約1km グリッド近傍(3x3) で突合
    con.execute("""create table ifas_key as
      select distinct nname, cast(round(lat,2)*100 as int) gx, cast(round(lon,2)*100 as int) gy from ifas
      where nname<>''""")
    con.execute("""create table food_key as
      select id, nname, cast(round(lat,2)*100 as int) gx, cast(round(lon,2)*100 as int) gy from food2
      where nname<>''""")
    con.execute("""create table ifas_hit as
      select distinct f.id from food_key f join ifas_key i
        on f.nname=i.nname and abs(f.gx-i.gx)<=1 and abs(f.gy-i.gy)<=1""")
    n_ifas_hit = q("select count(*) from ifas_hit")[0][0]
    # 名前だけ一致（座標無視）= 上限側
    n_ifas_name_only = q("""select count(distinct f.id) from food_key f
                            join (select distinct nname from ifas_key) i on f.nname=i.nname""")[0][0]
    res["ifas_match"] = {
        "matched_name_and_1km": n_ifas_hit,
        "pct": round(100.0 * n_ifas_hit / total, 2),
        "matched_name_only_upper_bound": n_ifas_name_only,
        "pct_name_only": round(100.0 * n_ifas_name_only / total, 2),
    }
    # #1273 【仕様】IFAS 側の地域カバー状況（そもそも全国網羅か）
    res["ifas_rows_by_region"] = [{"region": str(r), "n": n} for r, n in
        q("select region, count(*) c from ifas group by 1 order by c desc limit 12")]
    # 座標近傍のみ（名前不問, 約110mグリッド一致）= 実在裏付けの緩い版
    con.execute("""create table ifas_gk as select distinct
        cast(round(lat,3)*1000 as int) gx, cast(round(lon,3)*1000 as int) gy from ifas""")
    n_geo = q("""select count(distinct f.id) from
        (select id, cast(round(lat,3)*1000 as int) gx, cast(round(lon,3)*1000 as int) gy from food2) f
        join ifas_gk i on abs(f.gx-i.gx)<=1 and abs(f.gy-i.gy)<=1""")[0][0]
    res["ifas_match"]["matched_geo_only_110m"] = n_geo
    res["ifas_match"]["pct_geo_only"] = round(100.0 * n_geo / total, 2)
    # IFAS は都道府県により公開状況が異なる → 地域別の裏付け率も出す
    reg = q("""select coalesce(o.region,'(null)') r, count(*) n,
                      count(*) filter (where h.id is not null) hit
               from (select f.id, addr.region from food2 f
                     join (select id, addresses[1].region as region from '""" + PARQUET + """' """ + FOOD_WHERE + """) addr
                       on f.id=addr.id) o
               left join ifas_hit h on o.id=h.id group by 1 order by n desc""")
    res["ifas_by_region"] = [{"region": r, "n": n, "hit": h,
                              "pct": round(100.0 * h / n, 1)} for r, n, h in reg[:10]]

    # ---- 6. 母集団定義 ----
    defs = {
        "D0_all_food": "1=1",
        "D1_dish_categories_loose": "dish_loose",
        "D2_dish_categories_strict": "dish_strict",
        "D3_conf080": "confidence>=0.8",
        "D4_dish_loose_and_conf080": "dish_loose and confidence>=0.8",
        "D5_dish_strict_and_conf080": "dish_strict and confidence>=0.8",
        "D6_dish_loose_conf080_ifas": "dish_loose and confidence>=0.8 and id in (select id from ifas_hit)",
        "D7_dish_strict_conf080_ifas": "dish_strict and confidence>=0.8 and id in (select id from ifas_hit)",
        "D8_ifas_only": "id in (select id from ifas_hit)",
    }
    pops = {}
    for k, w in defs.items():
        n = q(f"select count(*) from food2 where {w}")[0][0]
        # チェーン畳み込み後の件数も併記
        nc = q(f"""select count(distinct case when nname in
                     (select nname from food2 where nname<>'' group by 1 having count(*)>=5)
                     then nname else id end) from food2 where {w}""")[0][0]
        pops[k] = {"n": n, "pct_of_789612": round(100.0 * n / total, 2),
                   "n_chain_collapsed": nc}
    res["population_definitions"] = pops

    # ---- 7. 600店サンプルでのカバレッジ再計算 ----
    sample = json.load(open(SAMPLE, encoding="utf-8"))["results"]
    ids = [r["restaurant"]["id"] for r in sample]
    idlist = ",".join("'" + i + "'" for i in ids)
    rows = q(f"""select id, basic_category, pcat, confidence, dish_strict, dish_loose,
                        (id in (select id from ifas_hit)) as ifas,
                        (websites is not null and len(websites)>0) as has_site,
                        nname
                 from food2 where id in ({idlist})""")
    meta = {r[0]: {"bc": r[1], "pcat": r[2], "conf": r[3], "dish_strict": r[4],
                   "dish_loose": r[5], "ifas": r[6], "has_site": r[7], "nname": r[8]}
            for r in rows}
    res["sample_matched_in_parquet"] = len(meta)

    # #1273 【仕様】own_site は measure_multisource_ceiling.py と同一規則で再現する
    #   （ポータル/SNSドメイン除外 かつ 同一ドメイン共有が3店以下）。
    #   これにより D0 の union が既報の 48.0% を再現することを検証できる。
    PORTAL_DOMAINS = {"tabelog.com", "s.tabelog.com", "r.tabelog.com", "r.gnavi.co.jp",
                      "hotpepper.jp", "hitosara.com", "instagram.com", "twitter.com",
                      "facebook.com", "ameblo.jp", "localplace.jp", "goo.gl", "linktr.ee"}
    freq = dict(q(r"""select regexp_extract(websites[1],'https?://(?:www\.)?([^/]+)',1), count(*)
                       from food2 where len(websites)>0 group by 1"""))
    domrows = q(r"""select id, regexp_extract(websites[1],'https?://(?:www\.)?([^/]+)',1),
                          len(websites)>0 from food2 where id in (""" + idlist + ")")
    own = {rid: bool(hw and dom and dom not in PORTAL_DOMAINS and freq.get(dom, 0) <= 3)
           for rid, dom, hw in domrows}
    dish_img = {r["id"]: (r.get("n_verified_dish", 0) > 0) for r in
                json.load(open(OWNSITE, encoding="utf-8"))["results"]}

    # 実測の precision 補正係数（既存実測より）
    YT_PRECISION = 0.60   # YouTube生判定33.5% → 実効18〜21% 帯の中央 20.1/33.5
    SITE_PRECISION = 0.467  # own-website-images.json の目視 precision 7/15

    def coverage(pred):
        sel = [r for r in sample if pred(r["restaurant"]["id"])]
        n = len(sel)
        if n == 0:
            return None
        yt = sum(1 for r in sel if r.get("hit"))
        site = sum(1 for r in sel if own.get(r["restaurant"]["id"], False))
        union = sum(1 for r in sel
                    if r.get("hit") or own.get(r["restaurant"]["id"], False))
        img = sum(1 for r in sel if dish_img.get(r["restaurant"]["id"], False))
        return {
            "n": n,
            "youtube_raw_pct": round(100.0 * yt / n, 2),
            "youtube_precision_adjusted_pct": round(100.0 * yt / n * YT_PRECISION, 2),
            "own_site_path_pct": round(100.0 * site / n, 2),
            "own_site_verified_dish_img_pct": round(100.0 * img / n, 2),
            "union_path_pct": round(100.0 * union / n, 2),
            "union_precision_adjusted_pct": round(
                100.0 * (yt * YT_PRECISION + site * SITE_PRECISION -
                         yt * YT_PRECISION * (site / n if n else 0)) / n, 2),
        }

    def pred_for(key):
        def f(i):
            m = meta.get(i)
            if m is None:
                return False
            if key == "D0_all_food":
                return True
            if key == "D1_dish_categories_loose":
                return bool(m["dish_loose"])
            if key == "D2_dish_categories_strict":
                return bool(m["dish_strict"])
            if key == "D3_conf080":
                return (m["conf"] or 0) >= 0.8
            if key == "D4_dish_loose_and_conf080":
                return bool(m["dish_loose"]) and (m["conf"] or 0) >= 0.8
            if key == "D5_dish_strict_and_conf080":
                return bool(m["dish_strict"]) and (m["conf"] or 0) >= 0.8
            if key == "D6_dish_loose_conf080_ifas":
                return bool(m["dish_loose"]) and (m["conf"] or 0) >= 0.8 and bool(m["ifas"])
            if key == "D7_dish_strict_conf080_ifas":
                return bool(m["dish_strict"]) and (m["conf"] or 0) >= 0.8 and bool(m["ifas"])
            if key == "D8_ifas_only":
                return bool(m["ifas"])
            return False
        return f

    res["coverage_by_definition"] = {k: coverage(pred_for(k)) for k in defs}
    # チェーン畳み込み時のカバレッジ（同名チェーンは1店でも当たれば全店OKとみなす）
    chain_names = set(x[0] for x in q("""select nname from food2 where nname<>''
                                        group by 1 having count(*)>=5"""))
    res["visual_verification"] = VISUAL_VERIFICATION
    res["sample_chain_share_pct"] = round(
        100.0 * sum(1 for i in ids if meta.get(i, {}).get("nname") in chain_names) / len(ids), 2)

    json.dump(res, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(json.dumps({k: v for k, v in res.items()
                      if k not in ("basic_category_breakdown",)},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
