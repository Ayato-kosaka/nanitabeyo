-- =============================================================================
-- #1970 site_crawl 経路（まだ公式サイトを crawl していない候補店）の狙いを渡す表
-- =============================================================================
--
-- 【なぜ要るか】
-- `4_16_target_near_cells.py` は «あと 1〜2 店で埋まるセル» の候補店を、既存の収集経路
-- （account / site_embed / site_crawl）の入力形式で出す。account と site_embed の 2 経路は
-- 既存表（sns_source_account / sns_store_site_ig）へ新 run_id で複製するが、site_crawl 経路
-- だけは runner 上のファイル（site_crawl_stores.json）にしか書いていなかった。ジョブが
-- 終わるとそのファイルは消えるため、`4_4_crawl_official_site_igs.py --stores-file` へ渡す
-- 手段が実際には無く、狙い撃ちが黙って «restaurant_catalog を google_place_id 昇順で
-- 巡回するだけ» に戻っていた。この表は他の 2 経路と同じ作法（BigQuery へ書く）に揃える。
--
-- `${DATASET}` は既存の sns_* と同じ `food-scroll.restaurant_recommendation` を想定する。
-- 20260830T0000_create_sns_seed_tables.sql は本番へ適用済みのため、そちらへ ALTER で
-- 積まず、このファイルで新規テーブルとして追加する。
-- =============================================================================

CREATE TABLE `${DATASET}.sns_site_crawl_target` (
  run_id           STRING NOT NULL,  -- 4_16 が発行した run_id（4_4 --stores-run-id が読む）
  google_place_id  STRING NOT NULL,  -- crawl 対象店（restaurant_catalog.google_place_id）
  name             STRING,           -- 店名（4_4 の crawl ログ用）
  website          STRING,           -- crawl する website
  created_at       TIMESTAMP NOT NULL
)
PARTITION BY DATE(created_at)
CLUSTER BY run_id, google_place_id
OPTIONS (description = '#1970 4_16 が狙う site_crawl 経路の対象店。4_4 --stores-run-id が読む。');
