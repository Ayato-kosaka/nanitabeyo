#!/usr/bin/env python3
"""#1273 «市区町村 × 134 カテゴリ» の KPI が、どこまで到達しうるかを測る読み取り専用レポート。

## なぜこれが要るか
KPI の分母 246,962（= 市区町村 1,843 × JP ゲート 134 カテゴリ）の 100% は物理的に不可能である。
「その市区町村にその料理の店が 5 軒存在しない」セルが大量にあるためだが、**それが何セルなのかを
一度も数えていない**。数えないまま «達成率 0.40%» とだけ言っても、それが «収集が足りない» のか
«そもそも無い» のかが区別できず、オーナーが分母を再定義する判断を下せない。

このスクリプトは 3 段階を数える。**ゴールや分母を決めない**（それは経営判断）。数字だけ出す。

| 段 | 定義（分子 / 分母は全て «市区町村 × 134 カテゴリ» のセル） |
| --- | --- |
| 上限A（物理） | catalog の実在店から «その市区町村にそのカテゴリの店が 5 軒以上ある» と**推定**できるセル数 |
| 上限B（在庫） | いま手元にある «店 × カテゴリ» の組を理想的に配ったときに 5 店へ届くセル数（実測） |
| 上限C（現状） | `sns_coverage` が実際に ≥5 と数えているセル数（実測。7_1 の出力を読むだけ） |

**上限A だけが推定である。** 推定の当てはまり具合は `validate` クエリで、既に ≥5 を達成している
セル（上限C）を «不可能» と判定していないかで検算する。

## 写経しないもの（判定の正本）
- **KPI 対象カテゴリ（134）** = `common_sns.kpi_gate_category_sql`。ラベルから引かない（#1815）。
- **店 → 料理カテゴリ の当てはめ語** = `4_16_target_near_cells.CATEGORY_KEYWORDS`。
  この辞書はここへ複製せず import する。当てはめの意味も 4_16 の `match_categories` と同じ
  （店名 or ジャンル語に kw を含み、かつ同じ側に deny 語を含まない）。
- **都道府県 / 市区町村の取り方** = `common_sns.PREF_PATTERN` と 7_1 と同じ正規表現。
- **KPI のセル数** = `sns_coverage`（7_1 の出力）を読むだけ。数え直さない。

## 上限A の推定がどこまで信用できるか
- 当てはめ語は «店名 / overture・osm・ifas のジャンル語» の部分一致でしかない。
  «その店がそのカテゴリを出しうるか» の当たりであって、分類の正解ではない（4_16 と同じ断り）。
- したがって **上限A は取りこぼす側（過小）に倒れる**。`validate` で «上限C なのに上限A に
  入っていない» セル数を必ず併記すること。過小なら «上限A は下限» と読む。
- 住所から市区町村が取れない店（実測 40%）は、7_1 の «1.5km 最近傍» の代わりに
  **0.01°（≒1.1km）グリッドの多数決**で補う（620k 店に ST_DWITHIN を張ると重すぎるため）。
  近似の一致率は `grid_accuracy` クエリで、住所から市区町村が取れる店に対して実測する。

## 初回の実測（2026-09-05 / catalog run `restaurant-2026-08-23` / coverage run `cov15`）
分母 246,962 = 市区町村 1,843 × JP ゲート 134。

- 上限A **9,657**（3.91%）… ≥1 店なら 31,458（12.74%）
- 上限B **1,135**（0.46%）… 手元の 20,036 店 / 30,611 «店×カテゴリ» を配ったとき
- 上限C **994**（0.40%）
- 検算: 上限C の 994 セルのうち 844（84.9%）は上限A でも ≥5。88 が 1〜4、**62 が 0**。
  ＝ 上限A は取りこぼす側に 15% ずれる ⇒ **9,657 は物理上限の «下限»**（補正すると約 11,400）。
- 市区町村の補完（グリッド多数決）の一致率 97.9%（住所から市区町村が取れる 378,910 店で実測）。
- 134 のうち **54 カテゴリ**は «≥5 店あり得る市区町村» が 1 つも無い＝専門店として名乗る店が
  日本に無い（チーズケーキ・親子丼・ナポリタン等）。それでも上限C ではそのうち 67 セルが
  達成済みなので、**この 54 については上限A は «測れない» のであって «0» ではない**。

## 使い方
BigQuery は読むだけ。書き込みは一切しない（他のワーカーと並走するため）。

  python3 7_3_report_coverage_ceiling.py --print-sql ceiling     # SQL を出すだけ
  python3 7_3_report_coverage_ceiling.py --coverage-run-id cov15 # 認証があれば実行して表を出す
"""

from __future__ import annotations

import argparse
import importlib.util
import logging
import re
from pathlib import Path

from common_sns import PREF_PATTERN, TABLE_COVERAGE, TABLE_POST_RAW, TABLE_POST_RESOLVED, \
    LATEST_RESOLVED_QUALIFY, kpi_gate_category_sql

LOGGER = logging.getLogger(__name__)
HERE = Path(__file__).resolve().parent

CATALOG_RUN_ID = "restaurant-2026-08-23"


def _load_category_keywords() -> dict:
    """4_16 の CATEGORY_KEYWORDS を import する（複製しない）。モジュール名が数字始まりなので手で読む。"""
    path = HERE / "4_16_target_near_cells.py"
    spec = importlib.util.spec_from_file_location("target_near_cells", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod.CATEGORY_KEYWORDS


# --- «主要都市» の定義の候補 -------------------------------------------------------
#
# 【設計】#1273 «主要都市» はチケットに定義が無い（オーナー判断待ち）。ここでは決めずに、
# 判断できるよう候補を 3 つ用意して、それぞれの達成率を出せるようにする。
# 名簿は法令上の区分（地方自治法）なので、人口の推定を持ち込まずに固定できる。
TOKYO23 = ["千代田区","中央区","港区","新宿区","文京区","台東区","墨田区","江東区","品川区","目黒区",
           "大田区","世田谷区","渋谷区","中野区","杉並区","豊島区","北区","荒川区","板橋区","練馬区",
           "足立区","葛飾区","江戸川区"]
SEIREI = ["札幌市","仙台市","さいたま市","千葉市","横浜市","川崎市","相模原市","新潟市","静岡市","浜松市",
          "名古屋市","京都市","大阪市","堺市","神戸市","岡山市","広島市","北九州市","福岡市","熊本市"]
# 中核市（人口 20 万人以上が要件）。政令市へ移行した市は SEIREI 側に置く。
CHUKAKU = ["旭川市","函館市","青森市","八戸市","盛岡市","秋田市","山形市","福島市","郡山市","いわき市",
           "宇都宮市","前橋市","高崎市","川越市","川口市","越谷市","船橋市","柏市","八王子市","横須賀市",
           "富山市","金沢市","福井市","甲府市","長野市","松本市","岐阜市","豊橋市","岡崎市","一宮市",
           "豊田市","大津市","豊中市","吹田市","高槻市","枚方市","八尾市","寝屋川市","東大阪市","姫路市",
           "尼崎市","明石市","西宮市","奈良市","和歌山市","鳥取市","松江市","倉敷市","呉市","福山市",
           "下関市","高松市","松山市","高知市","久留米市","長崎市","佐世保市","大分市","宮崎市","鹿児島市",
           "那覇市","水戸市"]


def _re_alt(words) -> str:
    """BigQuery の REGEXP_CONTAINS 用に «語1|語2» を作る（語はリテラル扱いにする）。"""
    return "|".join(re.escape(w.lower()) for w in words)


def _match_expr(rule: dict) -> str:
    """4_16 の match_categories と同じ意味の SQL 条件式。

    «店名側に kw を含み deny を含まない» か «ジャンル語側に kw を含み deny を含まない»。
    片側の deny がもう片側を殺さないのも 4_16 と同じ。deny が無い規則は
    «店名 ## ジャンル語» の連結 1 本で等価になる（語に '#' は無い）ので 1 回で判定する。
    """
    kw = _re_alt(rule["kw"])
    deny = rule.get("deny") or []
    if not deny:
        return f"REGEXP_CONTAINS(blob, r'{kw}')"
    d = _re_alt(deny)
    name = f"(REGEXP_CONTAINS(nm, r'{kw}') AND NOT REGEXP_CONTAINS(nm, r'{d}'))"
    genre = f"(REGEXP_CONTAINS(gg, r'{kw}') AND NOT REGEXP_CONTAINS(gg, r'{d}'))"
    return f"({name} OR {genre})"


def _dataset(project: str, dataset: str) -> str:
    return f"{project}.{dataset}"


def build_base_sql(ds: str, dish_ds: str, keywords: dict) -> str:
    """店 → (市区町村, 当てはまったカテゴリ) の evidence を作る共通 CTE 群。"""
    pref = PREF_PATTERN
    arms = ",\n            ".join(
        f"IF({_match_expr(rule)}, ['{label}'], [])" for label, rule in keywords.items()
    )
    return f"""
      gate AS (
        {kpi_gate_category_sql(dish_ds, key_param=None)}
      ),
      label AS (
        SELECT g.item_qid, ANY_VALUE(c.label_ja) AS label_ja
        FROM gate g LEFT JOIN `{dish_ds}.dish_category_catalog` c USING (item_qid)
        GROUP BY g.item_qid
      ),
      cat AS (
        SELECT google_place_id, seed_id, LOWER(IFNULL(name, '')) AS nm,
               latitude, longitude,
               REGEXP_EXTRACT(address, r'({pref})') AS region0,
               REGEXP_EXTRACT(address, r'(?:{pref})(.+?[市区町村])') AS city0
        FROM `{ds}.restaurant_catalog`
        WHERE run_id = '{CATALOG_RUN_ID}'
      ),
      genre AS (
        SELECT l.seed_id, LOWER(STRING_AGG(t, ' | ')) AS gg
        FROM `{ds}.restaurant_seed_source_links` l
        JOIN `{ds}.restaurant_source_records` s
          USING (run_id, source, source_record_id), UNNEST(s.source_categories) t
        GROUP BY l.seed_id
      ),
      -- 住所から市区町村が取れない店を補うグリッド（7_1 の 1.5km 最近傍の近似）。
      -- 0.01度 ≒ 1.1km。同じ枡にある «住所から市区町村が取れた店» の多数決を採る。
      bucket AS (
        SELECT CAST(ROUND(latitude * 100) AS INT64) la, CAST(ROUND(longitude * 100) AS INT64) lo,
               CAST(ROUND(latitude * 10) AS INT64) la2, CAST(ROUND(longitude * 10) AS INT64) lo2,
               region0 AS region, city0 AS city
        FROM cat WHERE city0 IS NOT NULL
      ),
      grid1 AS (
        SELECT la, lo, region, city, n, SUM(n) OVER (PARTITION BY la, lo) AS tot
        FROM (SELECT la, lo, region, city, COUNT(*) n FROM bucket GROUP BY 1, 2, 3, 4)
        QUALIFY ROW_NUMBER() OVER (PARTITION BY la, lo ORDER BY n DESC, city) = 1
      ),
      grid2 AS (
        SELECT la2 AS la, lo2 AS lo, region, city
        FROM (SELECT la2, lo2, region, city, COUNT(*) n FROM bucket GROUP BY 1, 2, 3, 4)
        QUALIFY ROW_NUMBER() OVER (PARTITION BY la2, lo2 ORDER BY n DESC, city) = 1
      ),
      store AS (
        SELECT c.google_place_id, c.nm, IFNULL(gn.gg, '') AS gg,
               CONCAT(c.nm, ' ## ', IFNULL(gn.gg, '')) AS blob,
               COALESCE(c.region0, g1.region, g2.region) AS region,
               COALESCE(c.city0, g1.city, g2.city) AS city,
               c.city0 IS NOT NULL AS city_from_address
        FROM cat c
        LEFT JOIN genre gn USING (seed_id)
        LEFT JOIN grid1 g1 ON g1.la = CAST(ROUND(c.latitude * 100) AS INT64) AND g1.lo = CAST(ROUND(c.longitude * 100) AS INT64)
        LEFT JOIN grid2 g2 ON g2.la = CAST(ROUND(c.latitude * 10) AS INT64) AND g2.lo = CAST(ROUND(c.longitude * 10) AS INT64)
      ),
      ev AS (
        SELECT s.google_place_id, s.region, s.city, lbl
        FROM store s, UNNEST(ARRAY_CONCAT(
            {arms}
        )) AS lbl
        WHERE s.city IS NOT NULL
      ),
      cell AS (
        SELECT l.item_qid, e.region, e.city, COUNT(DISTINCT e.google_place_id) AS n_stores
        FROM ev e JOIN label l ON l.label_ja = e.lbl
        GROUP BY 1, 2, 3
      ),
      cities AS (
        SELECT DISTINCT region0 AS region, city0 AS city
        FROM cat WHERE city0 IS NOT NULL
      )
    """


def q_grid_accuracy(ds: str, dish_ds: str, keywords: dict) -> str:
    """グリッド多数決の市区町村が、住所から取れる市区町村とどれだけ一致するか（近似の質）。"""
    return f"""WITH {build_base_sql(ds, dish_ds, keywords)},
      chk AS (
        SELECT c.city0, g1.city AS grid_city, g2.city AS grid_city2, IFNULL(g1.tot, 0) AS tot
        FROM cat c
        LEFT JOIN grid1 g1 ON g1.la = CAST(ROUND(c.latitude * 100) AS INT64) AND g1.lo = CAST(ROUND(c.longitude * 100) AS INT64)
        LEFT JOIN grid2 g2 ON g2.la = CAST(ROUND(c.latitude * 10) AS INT64) AND g2.lo = CAST(ROUND(c.longitude * 10) AS INT64)
        WHERE c.city0 IS NOT NULL
      )
      SELECT COUNT(*) n, COUNTIF(city0 = COALESCE(grid_city, grid_city2)) agree,
             COUNTIF(tot >= 10) n_big, COUNTIF(tot >= 10 AND city0 = grid_city) agree_big,
             COUNTIF(COALESCE(grid_city, grid_city2) IS NULL) no_grid,
             (SELECT COUNTIF(city IS NOT NULL) FROM store) AS stores_with_city,
             (SELECT COUNT(*) FROM store) AS stores_total
      FROM chk
    """


def q_report(ds: str, dish_ds: str, keywords: dict, coverage_run_id: str) -> str:
    """上限A（推定）と上限C（実測）を 1 本のクエリで «section, key, a, b, c, d» の縦持ちで返す。

    高い CTE（62 万店 × 133 語の当てはめ）を 1 回だけ評価するため、切り口ごとにクエリを
    分けず UNION ALL でまとめる。列の意味は section ごとに違うので key 列に書いてある。

      A_total     … a=市区町村数 b=分母(a×134) c=上限A(≥5) d=上限A(≥1)
      A_stores    … a=catalog 店数 b=市区町村が付いた店 c=店×カテゴリの証拠数 d=証拠を持つ店
      V_validate  … a=上限C(≥5) b=そのうち上限Aも≥5 c=上限A 1〜4 d=上限A 0（推定の取りこぼし）
      V_validate1 … a=上限C(≥1) b=上限A 0 c=上限A ≥1
      C_citydef   … a=市区町村数 b=分母 c=上限A d=上限C（«主要都市» の定義候補ごと）
      D_category  … a=上限A ≥1 の市区町村数 b=上限A ≥5 c=上限C ≥5 d=上限C ≥1（カテゴリごと）
    """
    t23 = ", ".join(f"'{c}'" for c in TOKYO23)
    sei = ", ".join(f"'{c}'" for c in SEIREI)
    chu = ", ".join(f"'{c}'" for c in CHUKAKU)
    return f"""WITH {build_base_sql(ds, dish_ds, keywords)},
      achieved AS (
        SELECT dish_category_id AS item_qid, region, city, distinct_store_count
        FROM `{ds}.{TABLE_COVERAGE}`
        WHERE run_id = '{coverage_run_id}' AND source_route = 'all' AND city IS NOT NULL
          AND dish_category_id IN (SELECT item_qid FROM gate)
      ),
      store_cnt AS (
        SELECT region, city, COUNT(*) AS n FROM store WHERE city IS NOT NULL GROUP BY 1, 2
      ),
      cellA_city AS (
        SELECT region, city, COUNTIF(n_stores >= 5) AS ceilA, COUNTIF(n_stores >= 1) AS ceilA1
        FROM cell GROUP BY 1, 2
      ),
      cellC_city AS (
        SELECT region, city, COUNTIF(distinct_store_count >= 5) AS ceilC FROM achieved GROUP BY 1, 2
      ),
      cellA_cat AS (
        SELECT item_qid, COUNTIF(n_stores >= 1) AS a1, COUNTIF(n_stores >= 5) AS a5 FROM cell GROUP BY 1
      ),
      cellC_cat AS (
        SELECT item_qid, COUNTIF(distinct_store_count >= 5) AS c5, COUNTIF(distinct_store_count >= 1) AS c1
        FROM achieved GROUP BY 1
      ),
      joined AS (
        SELECT a.item_qid, a.region, a.city, a.distinct_store_count, IFNULL(x.n_stores, 0) AS est
        FROM achieved a LEFT JOIN cell x USING (item_qid, region, city)
      ),
      city_def AS (
        SELECT c.region, c.city, IFNULL(sc.n, 0) AS n_stores,
               ROW_NUMBER() OVER (ORDER BY IFNULL(sc.n, 0) DESC) AS rk,
               ((c.city IN ({t23}) AND c.region = '東京都') OR c.city IN ({sei})) AS d1,
               c.city IN ({chu}) AS d3only
        FROM cities c LEFT JOIN store_cnt sc USING (region, city)
      ),
      per_city AS (
        SELECT d.*, IFNULL(ca.ceilA, 0) AS ceilA, IFNULL(ca.ceilA1, 0) AS ceilA1, IFNULL(cc.ceilC, 0) AS ceilC
        FROM city_def d
        LEFT JOIN cellA_city ca USING (region, city)
        LEFT JOIN cellC_city cc USING (region, city)
      )
      SELECT 'A_total' AS section, 'cells(city x 134)' AS key,
             (SELECT COUNT(*) FROM cities) AS a,
             (SELECT COUNT(*) FROM cities) * (SELECT COUNT(*) FROM gate) AS b,
             (SELECT COUNTIF(n_stores >= 5) FROM cell) AS c,
             (SELECT COUNTIF(n_stores >= 1) FROM cell) AS d
      UNION ALL SELECT 'A_stores', 'catalog stores / with city / evidence pairs / stores with evidence',
             (SELECT COUNT(*) FROM store), (SELECT COUNTIF(city IS NOT NULL) FROM store),
             (SELECT COUNT(*) FROM ev), (SELECT COUNT(DISTINCT google_place_id) FROM ev)
      UNION ALL SELECT 'V_validate', 'C>=5 / alsoA>=5 / A 1-4 / A 0',
             (SELECT COUNTIF(distinct_store_count >= 5) FROM achieved),
             (SELECT COUNTIF(distinct_store_count >= 5 AND est >= 5) FROM joined),
             (SELECT COUNTIF(distinct_store_count >= 5 AND est BETWEEN 1 AND 4) FROM joined),
             (SELECT COUNTIF(distinct_store_count >= 5 AND est = 0) FROM joined)
      UNION ALL SELECT 'V_validate1', 'C>=1 / A=0 / A>=1 / -',
             (SELECT COUNTIF(distinct_store_count >= 1) FROM achieved),
             (SELECT COUNTIF(est = 0) FROM joined), (SELECT COUNTIF(est >= 1) FROM joined), 0
      UNION ALL SELECT 'C_citydef', 'd1_政令市20+東京23区', COUNT(*), COUNT(*) * 134, SUM(ceilA), SUM(ceilC) FROM per_city WHERE d1
      UNION ALL SELECT 'C_citydef', 'd3_d1+中核市', COUNT(*), COUNT(*) * 134, SUM(ceilA), SUM(ceilC) FROM per_city WHERE d1 OR d3only
      UNION ALL SELECT 'C_citydef', 'd2_飲食店数 上位100', COUNT(*), COUNT(*) * 134, SUM(ceilA), SUM(ceilC) FROM per_city WHERE rk <= 100
      UNION ALL SELECT 'C_citydef', 'd2_飲食店数 上位300', COUNT(*), COUNT(*) * 134, SUM(ceilA), SUM(ceilC) FROM per_city WHERE rk <= 300
      UNION ALL SELECT 'C_citydef', 'd2_飲食店数 上位600', COUNT(*), COUNT(*) * 134, SUM(ceilA), SUM(ceilC) FROM per_city WHERE rk <= 600
      UNION ALL SELECT 'C_citydef', 'd4_飲食店 100軒以上', COUNT(*), COUNT(*) * 134, SUM(ceilA), SUM(ceilC) FROM per_city WHERE n_stores >= 100
      UNION ALL SELECT 'C_citydef', 'd4_飲食店 300軒以上', COUNT(*), COUNT(*) * 134, SUM(ceilA), SUM(ceilC) FROM per_city WHERE n_stores >= 300
      UNION ALL SELECT 'C_citydef', 'all_全市区町村', COUNT(*), COUNT(*) * 134, SUM(ceilA), SUM(ceilC) FROM per_city
      UNION ALL SELECT 'D_category', l.label_ja, IFNULL(ac.a1, 0), IFNULL(ac.a5, 0), IFNULL(cc.c5, 0), IFNULL(cc.c1, 0)
      FROM label l LEFT JOIN cellA_cat ac ON ac.item_qid = l.item_qid LEFT JOIN cellC_cat cc ON cc.item_qid = l.item_qid
      ORDER BY section, c DESC, key
    """


def q_inventory(ds: str, dish_ds: str, coverage_run_id: str) -> str:
    """上限B（在庫）: いま手元にある «店 × カテゴリ» を理想的に配ったときの ≥5 セル数。

    7_1（上限C）との違いは «店の決め方» だけにする。7_1 は 1 投稿 1 店を厳密に決める
    （`post_store`。看板が複数店を指す投稿は捨てる）が、ここは «その投稿がどの店の看板の
    下で見つかったか» を全部採る（`discovery_seed_place_id` と resolve の店の両方）。
    B − C が «配り方の損失»。市区町村の当て方は上限A と同じ（住所 → グリッド多数決）。
    """
    pref = PREF_PATTERN
    return f"""
      WITH gate AS ({kpi_gate_category_sql(dish_ds, key_param=None)}),
      cat AS (
        SELECT google_place_id, latitude, longitude,
               REGEXP_EXTRACT(address, r'({pref})') AS region0,
               REGEXP_EXTRACT(address, r'(?:{pref})(.+?[市区町村])') AS city0
        FROM `{ds}.restaurant_catalog` WHERE run_id = '{CATALOG_RUN_ID}'
      ),
      bucket AS (
        SELECT CAST(ROUND(latitude * 100) AS INT64) la, CAST(ROUND(longitude * 100) AS INT64) lo,
               CAST(ROUND(latitude * 10) AS INT64) la2, CAST(ROUND(longitude * 10) AS INT64) lo2,
               region0 AS region, city0 AS city
        FROM cat WHERE city0 IS NOT NULL
      ),
      grid1 AS (
        SELECT la, lo, region, city FROM (SELECT la, lo, region, city, COUNT(*) n FROM bucket GROUP BY 1, 2, 3, 4)
        QUALIFY ROW_NUMBER() OVER (PARTITION BY la, lo ORDER BY n DESC, city) = 1
      ),
      grid2 AS (
        SELECT la2 AS la, lo2 AS lo, region, city FROM (SELECT la2, lo2, region, city, COUNT(*) n FROM bucket GROUP BY 1, 2, 3, 4)
        QUALIFY ROW_NUMBER() OVER (PARTITION BY la2, lo2 ORDER BY n DESC, city) = 1
      ),
      place AS (
        SELECT c.google_place_id, COALESCE(c.region0, g1.region, g2.region) AS region,
               COALESCE(c.city0, g1.city, g2.city) AS city
        FROM cat c
        LEFT JOIN grid1 g1 ON g1.la = CAST(ROUND(c.latitude * 100) AS INT64) AND g1.lo = CAST(ROUND(c.longitude * 100) AS INT64)
        LEFT JOIN grid2 g2 ON g2.la = CAST(ROUND(c.latitude * 10) AS INT64) AND g2.lo = CAST(ROUND(c.longitude * 10) AS INT64)
      ),
      latest AS (
        SELECT provider, post_id, status, google_place_id, dish_category_id
        FROM `{ds}.{TABLE_POST_RESOLVED}`
        {LATEST_RESOLVED_QUALIFY}
      ),
      pair AS (
        SELECT DISTINCT pid, v.dish_category_id
        FROM latest v
        JOIN `{ds}.{TABLE_POST_RAW}` r ON r.provider = v.provider AND r.post_id = v.post_id,
        UNNEST([NULLIF(r.discovery_seed_place_id, ''), IF(v.status = 'matched', v.google_place_id, NULL)]) pid
        WHERE v.dish_category_id IS NOT NULL AND pid IS NOT NULL
          AND v.dish_category_id IN (SELECT item_qid FROM gate)
      ),
      cellB AS (
        SELECT p.dish_category_id, c.region, c.city, COUNT(DISTINCT p.pid) n
        FROM pair p JOIN place c ON c.google_place_id = p.pid
        WHERE c.city IS NOT NULL GROUP BY 1, 2, 3
      )
      SELECT (SELECT COUNT(DISTINCT pid) FROM pair) AS stores_in_hand,
             (SELECT COUNT(*) FROM pair) AS store_category_pairs,
             (SELECT COUNT(DISTINCT pid) FROM pair p JOIN place c ON c.google_place_id = p.pid WHERE c.city IS NOT NULL) AS stores_placed,
             (SELECT COUNT(*) FROM cellB) AS cellsB_ge1,
             (SELECT COUNTIF(n >= 3) FROM cellB) AS cellsB_ge3,
             (SELECT COUNTIF(n >= 5) FROM cellB) AS cellsB_ge5
    """


QUERIES = {"report": q_report, "grid_accuracy": q_grid_accuracy, "inventory": q_inventory}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="KPI の到達可能上限（上限A/B/C）を測る。読み取りのみ")
    p.add_argument("--coverage-run-id", default="cov15", help="読む sns_coverage の run_id（上限C）")
    p.add_argument("--project", default="food-scroll")
    p.add_argument("--dataset", default="restaurant_recommendation")
    p.add_argument("--dish-dataset", default="wikidata_food_graph")
    p.add_argument("--print-sql", default=None, choices=sorted(QUERIES) + ["all"],
                   help="SQL を標準出力へ出すだけ（BigQuery へ接続しない）")
    return p.parse_args()


def build(name: str, args) -> str:
    ds = _dataset(args.project, args.dataset)
    dish_ds = _dataset(args.project, args.dish_dataset)
    kw = _load_category_keywords()
    if name == "inventory":
        return q_inventory(ds, dish_ds, args.coverage_run_id)
    if name == "grid_accuracy":
        return q_grid_accuracy(ds, dish_ds, kw)
    return q_report(ds, dish_ds, kw, args.coverage_run_id)


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    names = sorted(QUERIES) if args.print_sql in (None, "all") else [args.print_sql]
    if args.print_sql:
        for n in names:
            print(f"-- ===== {n} =====")
            print(build(n, args))
        return
    from pipeline_common import BigQueryPipeline  # 認証があるときだけ読む
    pipeline = BigQueryPipeline()
    for n in names:
        print(f"\n## {n}")
        for row in pipeline.execute(build(n, args)):
            print(dict(row))


if __name__ == "__main__":
    main()
