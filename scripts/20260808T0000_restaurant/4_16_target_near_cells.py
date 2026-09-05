#!/usr/bin/env python3
"""#1273 «あと 1 店で埋まるセル» を名指しで潰すための的出し。

## なぜこれが要るか
KPI は «市区町村 × 料理カテゴリ(134) に異なり 5 店»。実測（cov12・KPI 140 QID）で
n=4 のセルが 339 / n=3 が 726 ある一方、集めた店-セルの 63% は n<=4 のセルに沈んで
KPI に 1 点も入っていない。**律速は «量» ではなく «配分»**で、n=4 のセルは 1 店で 1 セル、
n=1 のセルは 4 店で 1 セルなので同じ 1 店の単価が 4 倍違う。

このスクリプトは «あと 1〜2 店» のセルを名指しし、そのセルに実在する «まだ投稿を
取っていない» 候補店を出して、**既存の収集経路の入力**へそのまま渡せる形にする。
新しい収集経路は作らない（ここは的出しだけ。投稿を取るのは 4_2 / 4_4 / 4_10）。

## 写経しないもの（判定の正本）
- **KPI の数え方** = `7_1_build_coverage.py`。ここは 7_1 が作った `sns_coverage` を
  «読むだけ» で、matched の数え直しをしない（数える側と的を出す側がずれない）。
- **店の決め方** = «1 投稿 1 店» は `common_sns.post_store_cte_sql`（配信 9_1 / 計上 7_1）。
  ここが使う「まだ投稿を取っていない店」判定は広めの `STORE_ID_ANY_SQL` /
  `STORE_KNOWN_ANY_SQL` で、同じ列（`sns_post_raw.discovery_seed_place_id`）を見る。
- **都道府県の列挙** = `common_sns.PREF_PATTERN`。
- **handle の決め方 / チェーン除去** = `4_1_discover_sns_accounts.py`。ここでは handle を
  新しく作らず、4_1 が既に作った `sns_source_account` の行を «狙う店の分だけ» 別 run_id へ
  複製するだけにする。
- 唯一ここが持つ判定は «店 → 料理カテゴリ» の当てはめ（下記 CATEGORY_KEYWORDS）。
  これは店名とソース側ジャンル語の部分一致に過ぎず、当てられないカテゴリは
  «当てられない» として出力する（黙って落とさない）。

## 出力（既存スクリプトの入力形式に合わせる）
1. `site_crawl_stores.json` — `[{google_place_id, name, website}]`
   → `4_4_crawl_official_site_igs.py --stores-file <this>`（未クロールの店をサイト crawl）
2. `sns_store_site_ig` へ狙う店の行を **新 run_id** で複製
   → `4_10_scan_store_site_embeds.py --site-run-id <run-id> --statuses ok,no_handle`
3. `sns_source_account` へ狙う店の店アカ行を **新 run_id** で複製
   → `4_2_collect_account_posts.py --account-run-id <run-id>`
     / `4_7_collect_search_api_posts.py --store-mode --account-run-id <run-id>`
4. `near_cell_targets.csv` — セル×候補店の全量（人が見て妥当か判断するための台帳）

BigQuery は読み取りが主で、書くのは上の 2/3（**新しい run_id にだけ足す**。既存 run_id は触らない）。
PostgreSQL には触らない。

## 使い方（db-script-run.yml）
  script_path: scripts/20260808T0000_restaurant/4_16_target_near_cells.py
  args: --run-id sns-2026-09-05-nearcell --min-stores 4 --max-stores 4 --limit 20000
  # 動作確認は --dry-run（BQ を読み、件数と表だけ出して書き込まない）
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
from collections import defaultdict
from pathlib import Path

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import (PREF_PATTERN, PROVIDER_INSTAGRAM, TABLE_POST_RAW, TABLE_COVERAGE,
                        TABLE_SOURCE_ACCOUNT, TABLE_STORE_SITE_IG)

LOGGER = logging.getLogger(__name__)
HERE = Path(__file__).resolve().parent

# --- 店 → 料理カテゴリ の当てはめ語 ------------------------------------------------
#
# 【設計】#1273 これは «その店がそのカテゴリの投稿を持ちうるか» の当たりを付けるための
# 部分一致辞書であって、分類の正解ではない（正解は resolve が投稿ごとに決める）。
# 照合先は 2 つだけ:
#   - `restaurant_catalog.name`（店名）
#   - `restaurant_source_records.source_categories`（overture / osm の英語ジャンル語、
#     ifas の日本語ジャンル語。例 'ramen_restaurant' / 'ラーメン屋' / '一般食堂'）
# 語は小文字化して部分一致で当てる。deny は «その語を含むなら当てない» 除外語。
# ここに無いカテゴリは «当てられない» として報告する（推測で埋めない）。
CATEGORY_KEYWORDS: dict[str, dict[str, list[str]]] = {
    # 麺
    "ラーメン": {"kw": ["ラーメン", "らーめん", "拉麺", "中華そば", "ramen"]},
    "つけ麺": {"kw": ["つけ麺", "つけめん"]},
    "まぜそば": {"kw": ["まぜそば", "混ぜそば"]},
    "油そば": {"kw": ["油そば", "あぶらそば"]},
    "味噌ラーメン": {"kw": ["味噌ラーメン", "みそラーメン"]},
    "塩ラーメン": {"kw": ["塩ラーメン"]},
    "豚骨ラーメン": {"kw": ["豚骨ラーメン", "とんこつラーメン", "豚骨らーめん"]},
    "担担麺": {"kw": ["担担麺", "担々麺", "タンタンメン", "坦々麺"]},
    "ちゃんぽん": {"kw": ["ちゃんぽん", "チャンポン"]},
    "うどん": {"kw": ["うどん", "饂飩", "udon"]},
    # «そば» は «焼きそば / 油そば / 中華そば / まぜそば» を巻き込むので裸では当てない
    "そば": {"kw": ["蕎麦", "そば屋", "そば店", "そば処", "soba"],
             "deny": ["焼きそば", "焼そば", "やきそば", "油そば", "中華そば", "まぜそば"]},
    "焼きそば": {"kw": ["焼きそば", "焼そば", "やきそば"]},
    "冷やし中華": {"kw": ["冷やし中華"]},
    "素麺": {"kw": ["そうめん", "素麺"]},
    # 寿司・魚介
    "寿司": {"kw": ["寿司", "すし", "鮨", "寿し", "sushi"]},
    "海鮮丼": {"kw": ["海鮮丼"]},
    "海鮮料理": {"kw": ["海鮮", "魚介", "seafood_restaurant", "浜焼き"]},
    "刺身盛り合わせ": {"kw": ["刺身", "刺し身"]},
    "刺身定食": {"kw": ["刺身定食"]},
    "牡蠣料理": {"kw": ["牡蠣", "かき小屋", "オイスター", "oyster"]},
    "蟹料理": {"kw": ["蟹料理", "かに料理", "かに道楽", "crab"]},
    "鰹のタタキ": {"kw": ["鰹", "かつおのたたき", "カツオのたたき"]},
    "焼き魚定食": {"kw": ["焼き魚", "焼魚"]},
    "さば塩焼き": {"kw": ["さば塩焼", "鯖塩焼"]},
    "あじの開き": {"kw": ["あじの開き", "鯵の開き"]},
    "ウナギ": {"kw": ["うなぎ", "鰻", "ウナギ", "unagi"]},
    # 肉
    "焼肉": {"kw": ["焼肉", "焼き肉", "yakiniku", "barbecue_restaurant", "korean_barbecue"]},
    "ホルモン焼き": {"kw": ["ホルモン"]},
    "やきとん": {"kw": ["やきとん", "焼きとん", "焼とん"]},
    "焼き鳥": {"kw": ["焼き鳥", "焼鳥", "やきとり", "yakitori"]},
    "手羽先唐揚げ": {"kw": ["手羽先"]},
    "唐揚げ": {"kw": ["唐揚", "からあげ", "から揚げ", "空揚げ"]},
    "ステーキ": {"kw": ["ステーキ", "steakhouse", "steak_house", "steak"]},
    "ハンバーグ": {"kw": ["ハンバーグ"]},
    "牛タン焼き": {"kw": ["牛タン", "牛たん", "牛舌"]},
    "牛すじ煮込み": {"kw": ["牛すじ", "牛スジ"]},
    "生姜焼き": {"kw": ["生姜焼", "しょうが焼", "ショウガ焼"]},
    "とんかつ": {"kw": ["とんかつ", "トンカツ", "豚カツ", "とん喜", "かつ屋"]},
    "カツ丼": {"kw": ["カツ丼", "かつ丼", "katsudon"]},
    "串カツ": {"kw": ["串カツ", "串かつ"]},
    "チキン南蛮": {"kw": ["チキン南蛮"]},
    "フライドチキン": {"kw": ["フライドチキン", "fried_chicken", "chicken_wings_restaurant"]},
    "韓国フライドチキン": {"kw": ["ヤンニョム", "韓国チキン"]},
    # 丼・ごはん
    "牛丼": {"kw": ["牛丼", "beef_bowl"]},
    "親子丼": {"kw": ["親子丼"]},
    "天丼": {"kw": ["天丼"]},
    "天ぷら": {"kw": ["天ぷら", "天麩羅", "てんぷら", "tempura"]},
    "天津飯": {"kw": ["天津飯"]},
    "オムライス": {"kw": ["オムライス"]},
    "ハヤシライス": {"kw": ["ハヤシライス", "ハヤシ"]},
    "タコライス": {"kw": ["タコライス"]},
    "ピラフ": {"kw": ["ピラフ"]},
    "釜飯": {"kw": ["釜飯", "釜めし"]},
    "チャーハン": {"kw": ["チャーハン", "炒飯"]},
    # 和食・定食
    "和食": {"kw": ["和食", "日本料理", "japanese_restaurant", "割烹"]},
    "定食": {"kw": ["定食", "食堂", "一般食堂"],
             "deny": ["給食", "社員食堂", "学校給食", "病院給食", "従業員食堂", "集団給食"]},
    "懐石料理": {"kw": ["懐石", "会席"]},
    "居酒屋": {"kw": ["居酒屋", "izakaya", "sake_bar", "大衆酒場", "酒場"]},
    "おでん": {"kw": ["おでん", "御田"]},
    "沖縄料理": {"kw": ["沖縄料理", "琉球料理"]},
    # 鍋・鉄板
    "もつ鍋": {"kw": ["もつ鍋", "モツ鍋"]},
    "鍋料理": {"kw": ["鍋料理", "鍋処", "hot_pot"]},
    "しゃぶしゃぶ": {"kw": ["しゃぶしゃぶ", "shabu"]},
    "すき焼き": {"kw": ["すき焼", "スキヤキ", "sukiyaki"]},
    "火鍋": {"kw": ["火鍋"]},
    "鉄板焼き": {"kw": ["鉄板焼", "teppan"]},
    "お好み焼き": {"kw": ["お好み焼", "おこのみやき", "okonomiyaki", "savory_pancakes"]},
    "もんじゃ焼き": {"kw": ["もんじゃ"]},
    "たこ焼き": {"kw": ["たこ焼", "タコ焼", "takoyaki"]},
    # 中華・アジア
    "餃子": {"kw": ["餃子", "ぎょうざ", "gyoza", "dumpling_restaurant"]},
    "中華料理": {"kw": ["中華料理", "中国料理", "中華飯店", "中華食堂", "chinese_restaurant"]},
    "四川料理": {"kw": ["四川"]},
    "麻婆豆腐": {"kw": ["麻婆", "マーボー", "マーボ"]},
    "回鍋肉": {"kw": ["回鍋肉", "ホイコーロー"]},
    "チンジャオロース": {"kw": ["青椒肉絲", "チンジャオロース"]},
    "酢豚": {"kw": ["酢豚"]},
    "エビチリ": {"kw": ["エビチリ", "海老チリ"]},
    "エビマヨ": {"kw": ["エビマヨ", "海老マヨ"]},
    "油淋鶏": {"kw": ["油淋鶏", "ユーリンチー"]},
    "韓国料理": {"kw": ["韓国料理", "韓国家庭料理", "korean_restaurant"]},
    "ビビンバ": {"kw": ["ビビンバ", "ビビンパ"]},
    "スンドゥブ": {"kw": ["スンドゥブ", "純豆腐"]},
    "キムチチゲ": {"kw": ["キムチチゲ"]},
    "チーズタッカルビ": {"kw": ["タッカルビ"]},
    "タイ料理": {"kw": ["タイ料理", "thai_restaurant"]},
    "ベトナム料理": {"kw": ["ベトナム料理", "vietnamese_restaurant"]},
    "インドカレー": {"kw": ["インドカレー", "インド料理", "indian_restaurant", "ネパール料理"]},
    "カレー": {"kw": ["カレー", "curry", "咖喱"]},
    "カレーうどん": {"kw": ["カレーうどん"]},
    "キーマカレー": {"kw": ["キーマ"]},
    # 洋食
    "イタリアン": {"kw": ["イタリア", "italian_restaurant", "trattoria", "トラットリア", "オステリア"]},
    "パスタ": {"kw": ["パスタ", "pasta", "スパゲ"]},
    "カルボナーラ": {"kw": ["カルボナーラ"]},
    "ペペロンチーノ": {"kw": ["ペペロンチーノ"]},
    "ナポリタン": {"kw": ["ナポリタン"]},
    "ピザ": {"kw": ["ピザ", "ピッツァ", "pizza"]},
    "リゾット": {"kw": ["リゾット"]},
    "パエリア": {"kw": ["パエリア", "パエージャ", "paella"]},
    # «バル» は焼き鳥バル・ダイニングバルまで巻き込むので入れない（2026-09-05 実測で誤爆）
    "スペイン料理": {"kw": ["スペイン料理", "spanish_restaurant", "iberian_restaurant"]},
    "フレンチ": {"kw": ["フレンチ", "フランス料理", "french_restaurant", "ビストロ", "bistro"]},
    "ハンバーガー": {"kw": ["ハンバーガー", "バーガー", "burger"]},
    "チーズバーガー": {"kw": ["チーズバーガー"]},
    "ホットドッグ": {"kw": ["ホットドッグ", "hot_dog_restaurant"]},
    "サンドイッチ": {"kw": ["サンドイッチ", "sandwich"]},
    "フルーツサンド": {"kw": ["フルーツサンド"]},
    "エビフライ": {"kw": ["エビフライ", "海老フライ"]},
    "カルパッチョ": {"kw": ["カルパッチョ"]},
    "アクアパッツア": {"kw": ["アクアパッツァ", "アクアパッツア"]},
    "グラタン": {"kw": ["グラタン"]},
    "ドリア": {"kw": ["ドリア"]},
    "キッシュ": {"kw": ["キッシュ"]},
    "ビーフシチュー": {"kw": ["ビーフシチュー"]},
    "クリームシチュー": {"kw": ["クリームシチュー"]},
    "エッグベネディクト": {"kw": ["エッグベネディクト"]},
    # カフェ・甘味
    "カフェ": {"kw": ["カフェ", "cafe", "coffee", "喫茶", "珈琲"]},
    "アフタヌーン": {"kw": ["アフタヌーンティー"]},
    "ケーキ": {"kw": ["ケーキ", "パティスリー", "patisserie", "cake"]},
    "ショートケーキ": {"kw": ["ショートケーキ"]},
    "チーズケーキ": {"kw": ["チーズケーキ"]},
    "タルト": {"kw": ["タルト"]},
    "パフェ": {"kw": ["パフェ", "parfait"]},
    "プリンアラモード": {"kw": ["プリンアラモード"]},
    "パンケーキ": {"kw": ["パンケーキ", "pancake_house"]},
    "ワッフル": {"kw": ["ワッフル", "waffle"]},
    "クレープ": {"kw": ["クレープ", "creperie"]},
    "トースト": {"kw": ["トースト"]},
    "フレンチトースト": {"kw": ["フレンチトースト"]},
    "アイスクリーム": {"kw": ["アイスクリーム", "ice_cream_shop", "ice_cream"]},
    "ジェラート": {"kw": ["ジェラート", "gelato_shop", "gelato"]},
    "ソフトクリーム": {"kw": ["ソフトクリーム"]},
    "かき氷": {"kw": ["かき氷", "カキ氷", "氷菓", "shaved_ice_shop"]},
    "アサイーボウル": {"kw": ["アサイー"]},
    "サラダボウル": {"kw": ["サラダボウル", "salad_bar"]},
}


def normalize(text: str | None) -> str:
    return (text or "").lower()


def match_categories(name: str | None, genre_tokens, rules) -> dict[str, str]:
    """店名とジャンル語から «当てはまるカテゴリ → 根拠(name/genre)» を返す。

    根拠は «店名一致» の方が精度が高いので、両方当たったら name を採る。
    """
    n = normalize(name)
    g = " | ".join(normalize(t) for t in (genre_tokens or []))
    hit: dict[str, str] = {}
    for label, rule in rules.items():
        deny = rule.get("deny") or []
        for kw in rule["kw"]:
            k = kw.lower()
            in_name = k in n and not any(d.lower() in n for d in deny)
            in_genre = k in g and not any(d.lower() in g for d in deny)
            if in_name:
                hit[label] = "name"
                break
            if in_genre:
                hit[label] = "genre"
                # 店名側にもっと強い根拠が無いか、残りの語も見る
    return hit


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="«あと1店で埋まるセル» の候補店を既存収集経路の入力形式で出す")
    p.add_argument("--run-id", default=None, help="出力 run_id（sns_source_account / sns_store_site_ig へ新規に足す）")
    p.add_argument("--coverage-run-id", default=None, help="読む sns_coverage の run_id（省略時は最新）")
    p.add_argument("--catalog-run-id", default=None, help="読む restaurant_catalog の run_id（省略時は最大件数の run）")
    # KPI 対象カテゴリの正は «アプリの JP ゲート»（7_1 / 8_1 と同じ）。日本語ラベルから QID を
    # 引くと同名別 QID を拾って 134→140 に膨らみ、アプリに出ないカテゴリを数えてしまう（#1815）。
    p.add_argument("--kpi-gate-feature-key", default="region:country:JP",
                   help="KPI 対象カテゴリを決める dish_category_features_catalog の gate key（7_1 と同じ）")
    p.add_argument("--min-stores", type=int, default=4, help="狙うセルの現店数の下限（既定 4）")
    p.add_argument("--max-stores", type=int, default=4, help="狙うセルの現店数の上限（既定 4。3 も狙うなら --min-stores 3）")
    p.add_argument("--per-cell", type=int, default=20, help="1 セルあたりに出す候補店の上限")
    p.add_argument("--limit", type=int, default=None, help="出力する候補店（異なり店）の総数上限")
    p.add_argument("--top", type=int, default=20, help="標準出力へ出すセルの表の行数")
    p.add_argument("--out-dir", default=str(HERE / "_transient" / "near_cells"),
                   help="JSON / CSV の出力先ディレクトリ")
    p.add_argument("--dry-run", action="store_true", help="BQ へ書き込まない（読み取りと件数・表は出す）")
    return p.parse_args()


def _latest_run_id(pipeline: BigQueryPipeline, table: str, order: str) -> str:
    for row in pipeline.execute(
        f"SELECT run_id FROM `{pipeline.table(table)}` GROUP BY run_id ORDER BY {order} DESC LIMIT 1"
    ):
        return row["run_id"]
    raise RuntimeError(f"{table} に run_id がありません。")


def load_kpi_categories(pipeline: BigQueryPipeline, gate_key: str) -> dict[str, str]:
    """KPI 対象の «QID → 日本語ラベル» を返す。

    対象の決め方は 7_1（および 8_1 の target_categories）と同じ «アプリの JP ゲート»。
    ラベルは当てはめ語（CATEGORY_KEYWORDS）を引くためだけに使い、対象の決定には使わない。
    """
    from google.cloud import bigquery
    qid_label: dict[str, str] = {}
    for row in pipeline.execute(
        f"""
          SELECT g.item_qid, ANY_VALUE(c.label_ja) AS label_ja
          FROM (
            SELECT DISTINCT item_qid FROM `{pipeline.config.dish_dataset_ref}.dish_category_features_catalog`
            WHERE feature_type = 'gate' AND feature_key = @key AND score > 0
          ) g
          LEFT JOIN `{pipeline.config.dish_dataset_ref}.dish_category_catalog` c USING (item_qid)
          GROUP BY g.item_qid
        """,
        [bigquery.ScalarQueryParameter("key", "STRING", gate_key)],
    ):
        qid_label[row["item_qid"]] = row["label_ja"]
    LOGGER.info("KPI 対象カテゴリ（%s ゲート）: QID %d", gate_key, len(qid_label))
    return qid_label


def read_cells(pipeline: BigQueryPipeline, coverage_run_id: str, qids, nmin: int, nmax: int):
    """7_1 が作った sns_coverage から «あと少しで 5 店» のセルを読む（数え直さない）。"""
    from google.cloud import bigquery
    sql = f"""
      SELECT dish_category_id, region, city, distinct_store_count
      FROM `{pipeline.table(TABLE_COVERAGE)}`
      WHERE run_id = @cov AND source_route = 'all' AND city IS NOT NULL
        AND dish_category_id IN UNNEST(@qids)
        AND distinct_store_count BETWEEN @nmin AND @nmax
      ORDER BY distinct_store_count DESC, region, city
    """
    params = [
        bigquery.ScalarQueryParameter("cov", "STRING", coverage_run_id),
        bigquery.ArrayQueryParameter("qids", "STRING", list(qids)),
        bigquery.ScalarQueryParameter("nmin", "INT64", nmin),
        bigquery.ScalarQueryParameter("nmax", "INT64", nmax),
    ]
    return [dict(r) for r in pipeline.execute(sql, params)]


def store_pool_sql(pipeline: BigQueryPipeline) -> str:
    """狙う市区町村にある «まだ投稿を取っていない・手が届く» 店を読む SQL。

    - 市区町村の当て方は 7_1 と同じ（住所の都道府県+市区町村、取れないものは
      1.5km 以内の «市区町村が取れている catalog 店» の最近傍を採る）。
    - «まだ投稿を取っていない» は common_sns の店 ID 列（discovery_seed_place_id）で判定する。
    - «手が届く» = website があるか、4_1 が作った店アカ handle があるか。
      どちらも無い店は、この時点で渡せる収集経路が無いので出さない。
    """
    pref = PREF_PATTERN
    return f"""
      WITH target_cities AS (
        SELECT r AS region, c AS city
        FROM UNNEST(@cities_region) r WITH OFFSET o
        JOIN UNNEST(@cities_city) c WITH OFFSET o2 ON o = o2
      ),
      cat AS (
        SELECT google_place_id, seed_id, name, website, location,
               REGEXP_EXTRACT(address, r'({pref})') AS region,
               REGEXP_EXTRACT(address, r'(?:{pref})(.+?[市区町村])') AS city
        FROM `{pipeline.table('restaurant_catalog')}`
        WHERE run_id = @crid
      ),
      -- «その店の投稿を既に取っている» 集合。列は common_sns の店 ID 列と同じもの。
      collected AS (
        SELECT DISTINCT discovery_seed_place_id AS pid
        FROM `{pipeline.table(TABLE_POST_RAW)}`
        WHERE discovery_seed_place_id IS NOT NULL AND discovery_seed_place_id != ''
      ),
      collected_handles AS (
        SELECT DISTINCT account_id FROM `{pipeline.table(TABLE_POST_RAW)}` WHERE account_id IS NOT NULL
      ),
      -- 4_1 が作った店アカ（handle の作り方・チェーン除去は 4_1 が正）。まだ投稿を
      -- 取っていない handle だけを «手が届く» とみなす。
      acct AS (
        SELECT a.discovery_seed_place_id AS pid, ANY_VALUE(a.handle) AS handle,
               ANY_VALUE(a.account_id) AS account_id, ANY_VALUE(a.account_type) AS account_type,
               ANY_VALUE(a.discovery_method) AS discovery_method
        FROM `{pipeline.table(TABLE_SOURCE_ACCOUNT)}` a
        LEFT JOIN collected_handles ch ON ch.account_id = a.handle
        WHERE a.provider = @prov AND a.handle IS NOT NULL AND a.handle != ''
          AND a.discovery_seed_place_id IS NOT NULL AND a.discovery_seed_place_id != ''
          AND ch.account_id IS NULL
        GROUP BY a.discovery_seed_place_id
      ),
      -- 4_4 が既に crawl 済みの店（もう一度 crawl せず 4_10 の埋め込み走査へ回せる）
      site AS (
        SELECT google_place_id,
               ANY_VALUE(website) AS website, ANY_VALUE(host) AS host,
               ANY_VALUE(handle) AS handle, ANY_VALUE(status) AS status,
               ANY_VALUE(is_aggregator_host) AS is_aggregator_host,
               ANY_VALUE(corroborated) AS corroborated
        FROM `{pipeline.table(TABLE_STORE_SITE_IG)}`
        WHERE website IS NOT NULL AND website != ''
        GROUP BY google_place_id
      ),
      act AS (
        SELECT c.google_place_id, c.seed_id, c.name, c.website, c.location, c.region, c.city,
               a.handle, a.account_id, a.account_type, a.discovery_method,
               s.website AS site_website, s.host AS site_host, s.handle AS site_handle,
               s.status AS site_status, s.is_aggregator_host, s.corroborated
        FROM cat c
        LEFT JOIN collected ON collected.pid = c.google_place_id
        LEFT JOIN acct a ON a.pid = c.google_place_id
        LEFT JOIN site s ON s.google_place_id = c.google_place_id
        WHERE collected.pid IS NULL
          AND ((c.website IS NOT NULL AND c.website != '') OR a.handle IS NOT NULL)
      ),
      -- 住所から市区町村が取れない店は 7_1 と同じ «1.5km 以内の最近傍» で補う
      need AS (SELECT google_place_id, location FROM act WHERE city IS NULL AND location IS NOT NULL),
      ref AS (SELECT location, region, city FROM cat WHERE city IS NOT NULL AND location IS NOT NULL),
      nn AS (
        SELECT n.google_place_id, r.region, r.city
        FROM need n JOIN ref r ON ST_DWITHIN(n.location, r.location, 1500)
        QUALIFY ROW_NUMBER() OVER (PARTITION BY n.google_place_id
                                   ORDER BY ST_DISTANCE(n.location, r.location)) = 1
      ),
      placed AS (
        SELECT a.* EXCEPT (region, city, location, seed_id), a.seed_id,
               COALESCE(a.region, nn.region) AS region, COALESCE(a.city, nn.city) AS city
        FROM act a LEFT JOIN nn USING (google_place_id)
      ),
      genres AS (
        SELECT l.seed_id, ARRAY_AGG(DISTINCT LOWER(sc)) AS source_categories
        FROM `{pipeline.table('restaurant_seed_source_links')}` l
        JOIN `{pipeline.table('restaurant_source_records')}` r
          ON r.run_id = l.run_id AND r.source = l.source AND r.source_record_id = l.source_record_id,
        UNNEST(r.source_categories) sc
        WHERE l.run_id = @crid
        GROUP BY l.seed_id
      )
      SELECT p.google_place_id, p.name, p.website, p.region, p.city,
             p.handle, p.account_id, p.account_type, p.discovery_method,
             p.site_website, p.site_host, p.site_handle, p.site_status,
             p.is_aggregator_host, p.corroborated,
             IFNULL(g.source_categories, ARRAY<STRING>[]) AS source_categories
      FROM placed p
      JOIN target_cities USING (region, city)
      LEFT JOIN genres g ON g.seed_id = p.seed_id
    """


def read_store_pool(pipeline: BigQueryPipeline, catalog_run_id: str, cities):
    from google.cloud import bigquery
    params = [
        bigquery.ScalarQueryParameter("crid", "STRING", catalog_run_id),
        bigquery.ScalarQueryParameter("prov", "STRING", PROVIDER_INSTAGRAM),
        bigquery.ArrayQueryParameter("cities_region", "STRING", [r for r, _ in cities]),
        bigquery.ArrayQueryParameter("cities_city", "STRING", [c for _, c in cities]),
    ]
    return [dict(r) for r in pipeline.execute(store_pool_sql(pipeline), params)]


def build_targets(cells, stores, qid_label, per_cell: int):
    """セル × 候補店を作る。«店名一致 > ジャンル一致»、«handle あり > website だけ» の順に並べる。"""
    by_city: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for s in stores:
        s["categories"] = match_categories(s.get("name"), s.get("source_categories"), CATEGORY_KEYWORDS)
        if s["categories"]:
            by_city[(s["region"], s["city"])].append(s)

    targets = []
    for cell in cells:
        label = qid_label.get(cell["dish_category_id"])
        cands = []
        for s in by_city.get((cell["region"], cell["city"]), []):
            evidence = s["categories"].get(label)
            if not evidence:
                continue
            cands.append((0 if evidence == "name" else 1,
                          0 if s.get("handle") else 1,
                          s["google_place_id"], s, evidence))
        cands.sort(key=lambda t: (t[0], t[1], t[2]))
        targets.append({
            "region": cell["region"], "city": cell["city"],
            "dish_category_id": cell["dish_category_id"], "label": label,
            "distinct_store_count": cell["distinct_store_count"],
            "candidates": [{"store": s, "evidence": ev} for _, _, _, s, ev in cands[:per_cell]],
            "candidate_total": len(cands),
        })
    # «あと 1 店» のセルを先に、その中で候補が多い順（埋まる確率が高い順）
    targets.sort(key=lambda t: (-t["distinct_store_count"], -t["candidate_total"]))
    return targets


# 4_10 が走査できる sns_store_site_ig.status（4_10 の既定 --statuses と同じ）。
# fetch_failed / robots_blocked は «4_4 が既に読めなかった» 店なので、渡しても同じ結果になる。
_SITE_STATUS_SCANNABLE = ("ok", "no_handle")


def _route_of(store: dict) -> str:
    """その店を渡す既存経路を決める。渡せる経路が無いものは 'unreachable'。"""
    if store.get("handle"):
        return "account"          # 4_2 --account-run-id / 4_7 --store-mode
    if store.get("site_status") in _SITE_STATUS_SCANNABLE:
        return "site_embed"       # 4_10 --site-run-id（crawl 済みなので取り直さない）
    if not store.get("site_status") and (store.get("website") or "").startswith("http"):
        return "site_crawl"       # 4_4 --stores-file（まだ crawl していない）
    return "unreachable"          # crawl 済みで到達不能（fetch_failed / robots_blocked 等）


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    coverage_run_id = args.coverage_run_id or _latest_run_id(pipeline, TABLE_COVERAGE, "MAX(computed_at)")
    catalog_run_id = args.catalog_run_id or _latest_run_id(pipeline, "restaurant_catalog", "COUNT(*)")
    LOGGER.info("coverage_run_id=%s / catalog_run_id=%s", coverage_run_id, catalog_run_id)

    qid_label = load_kpi_categories(pipeline, args.kpi_gate_feature_key)
    all_cells = read_cells(pipeline, coverage_run_id, qid_label.keys(), args.min_stores, args.max_stores)
    # region が取れないセルは市区町村を一意に指せない（«中央区» が何県のものか決まらない）ので狙えない
    cells = [c for c in all_cells if c["region"]]
    if len(cells) != len(all_cells):
        LOGGER.warning("都道府県が取れないセル %d 件は狙えないので除外しました", len(all_cells) - len(cells))
    cities = sorted({(c["region"], c["city"]) for c in cells})
    LOGGER.info("狙うセル %d（現店数 %d〜%d）| 市区町村 %d | カテゴリ %d",
                len(cells), args.min_stores, args.max_stores, len(cities),
                len({c["dish_category_id"] for c in cells}))
    if not cells:
        LOGGER.warning("該当セルがありません。--coverage-run-id / --min-stores を確認してください。")
        return

    pool = read_store_pool(pipeline, catalog_run_id, cities)
    stores = [s for s in pool if _route_of(s) != "unreachable"]
    LOGGER.info("狙う市区町村の未収集店 %d 軒（うち渡せる経路がある %d 軒。"
                "残りは 4_4 が既に読めなかったサイトなので渡しても同じ結果になる）", len(pool), len(stores))

    targets = build_targets(cells, stores, qid_label, args.per_cell)
    filled = [t for t in targets if t["candidates"]]

    # --limit は «異なり候補店» の総数で効かせる（同じ店が複数セルを埋めることがある）
    picked: dict[str, dict] = {}
    picked_cells = 0
    for t in targets:
        if not t["candidates"]:
            continue
        added = False
        for c in t["candidates"]:
            pid = c["store"]["google_place_id"]
            if pid not in picked:
                if args.limit and len(picked) >= args.limit:
                    break
                picked[pid] = c["store"]
            added = True
        if added:
            picked_cells += 1
        if args.limit and len(picked) >= args.limit:
            break

    by_route: dict[str, list[dict]] = defaultdict(list)
    for pid, s in picked.items():
        by_route[_route_of(s)].append(s)

    # --- 当てられなかったカテゴリを黙って落とさない -----------------------------------
    cell_labels = {qid_label.get(c["dish_category_id"]) for c in cells}
    no_rule = sorted(l for l in cell_labels if l and l not in CATEGORY_KEYWORDS)
    # «どのセルでも 1 軒も出せなかった» カテゴリだけを挙げる（1 つでも出せたものは «当てられた»）
    with_cand = {t["label"] for t in targets if t["candidates"]}
    no_candidate = sorted({t["label"] for t in targets if t["label"]} - with_cand - set(no_rule))

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1) 4_4 --stores-file 用（未 crawl の店をサイト crawl する）
    site_crawl = [{"google_place_id": s["google_place_id"], "name": s["name"], "website": s["website"]}
                  for s in by_route["site_crawl"]]
    (out_dir / "site_crawl_stores.json").write_text(
        json.dumps(site_crawl, ensure_ascii=False, indent=1), encoding="utf-8")

    # 2) 台帳（人が見て妥当か判断するための全量）
    with (out_dir / "near_cell_targets.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["region", "city", "category", "dish_category_id", "now_stores",
                    "google_place_id", "store_name", "evidence", "route", "handle", "website"])
        for t in targets:
            for c in t["candidates"]:
                s = c["store"]
                if s["google_place_id"] not in picked:
                    continue
                w.writerow([t["region"], t["city"], t["label"], t["dish_category_id"],
                            t["distinct_store_count"], s["google_place_id"], s["name"],
                            c["evidence"], _route_of(s), s.get("handle") or "",
                            s.get("website") or ""])

    (out_dir / "unmapped_categories.json").write_text(json.dumps({
        "no_rule": no_rule, "no_candidate": no_candidate,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    # --- 標準出力: 上位セルの表（人が妥当性を判断できる形） ---------------------------
    print()
    print(f"■ 狙うセル {len(cells)} / 候補店を出せたセル {len(filled)}"
          f" / 出力したセル {picked_cells} / 候補店（異なり）{len(picked)} 軒")
    print(f"{'都道府県':<5}{'市区町村':<9}{'カテゴリ':<9}{'今':>3} {'候補':>5}  候補店の例")
    for t in targets[:args.top]:
        ex = "、".join(f"{c['store']['name']}({c['evidence']})" for c in t["candidates"][:3]) or "-"
        print(f"{t['region']:<5}{t['city']:<9}{t['label'] or '?':<9}{t['distinct_store_count']:>3} "
              f"{t['candidate_total']:>5}  {ex}")
    print()
    for route, rows in sorted(by_route.items()):
        print(f"  経路 {route}: {len(rows)} 軒")
    if no_rule:
        print(f"  当てられないカテゴリ（当てはめ語が無い）: {len(no_rule)} 件 — {'、'.join(no_rule)}")
    if no_candidate:
        print(f"  当てはめ語はあるが候補店 0 のカテゴリ: {len(no_candidate)} 件 — {'、'.join(no_candidate)}")
    print(f"  出力: {out_dir}")

    if args.dry_run:
        LOGGER.info("--dry-run のため BigQuery へは書き込みません")
        return

    now_iso = utc_now().isoformat()
    with pipeline.step(run_id, "4_16_target_near_cells", parameters={
        "coverage_run_id": coverage_run_id, "catalog_run_id": catalog_run_id,
        "min_stores": args.min_stores, "max_stores": args.max_stores,
        "per_cell": args.per_cell, "limit": args.limit,
    }, repo_root=None) as result:
        # 3) 店アカ経路: 4_1 が作った行を «狙う店の分だけ» 新 run_id へ複製する
        #    （handle を新しく作らない。4_2 --account-run-id / 4_7 --store-mode がそのまま読める）
        acc_rows = [{
            "account_id": s.get("account_id") or s["handle"], "provider": PROVIDER_INSTAGRAM,
            "handle": s["handle"], "account_type": s.get("account_type") or "store_branch",
            "discovery_method": s.get("discovery_method"),
            "discovery_seed_place_id": s["google_place_id"],
            "followers": None, "media_count": None,
            "discovered_at": now_iso, "run_id": run_id,
        } for s in by_route["account"]]
        pipeline.delete_run_rows(TABLE_SOURCE_ACCOUNT, run_id)
        n_acc = pipeline.load_json_rows(TABLE_SOURCE_ACCOUNT, acc_rows) if acc_rows else 0

        # 4) 埋め込み走査経路: 4_4 が既に crawl した行を «狙う店の分だけ» 新 run_id へ複製する
        #    （4_10 --site-run-id がそのまま読める。サイトを取り直さない）
        site_rows = [{
            "google_place_id": s["google_place_id"], "website": s["site_website"],
            "host": s.get("site_host"), "is_aggregator_host": s.get("is_aggregator_host"),
            "status": s.get("site_status") or "ok", "handle": s.get("site_handle"),
            "source_tags": [], "corroborated": s.get("corroborated"), "error": None,
            "crawled_at": now_iso, "run_id": run_id,
        } for s in by_route["site_embed"]]
        pipeline.delete_run_rows(TABLE_STORE_SITE_IG, run_id)
        n_site = pipeline.load_json_rows(TABLE_STORE_SITE_IG, site_rows) if site_rows else 0

        result["row_count"] = n_acc + n_site
        result["cells"] = len(cells)
        result["cells_with_candidates"] = len(filled)
        result["candidate_stores"] = len(picked)
        result["account_rows"] = n_acc
        result["site_rows"] = n_site
        result["site_crawl_stores"] = len(site_crawl)

    LOGGER.info("次に流すもの: "
                "4_2 --account-run-id %s（%d 軒）/ "
                "4_10 --site-run-id %s --statuses ok,no_handle（%d 軒）/ "
                "4_4 --stores-file %s（%d 軒）",
                run_id, len(by_route["account"]), run_id, len(by_route["site_embed"]),
                out_dir / "site_crawl_stores.json", len(site_crawl))


if __name__ == "__main__":
    main()
