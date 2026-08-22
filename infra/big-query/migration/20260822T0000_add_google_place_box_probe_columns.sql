-- #1276 の PoC で、名寄せの根拠を「A と B の合意」から「座標矩形の中での一意性」へ
-- 変えた。矩形（locationRestriction）は矩形の外を実際に切り落とすので、
-- 「矩形の中に同名が1件しか無い」が「取り違える相手が居ない」を意味する。
--
-- 合意ベースは負例で誤マッチ率 11.3% だった。locationBias が絞り込まないため、
-- 店が Google に無ければ A も B も揃って隣の店を返してしまうのが原因である。
--
-- 監査のため、矩形 probe の結果も attempts に残す。判定を後から変えたときに
-- 再課金せず再評価できる。
ALTER TABLE `${DATASET}.restaurant_google_place_match_attempts`
  ADD COLUMN IF NOT EXISTS place_ids_tight_box ARRAY<STRING>,
  ADD COLUMN IF NOT EXISTS place_ids_wide_box  ARRAY<STRING>,
  ADD COLUMN IF NOT EXISTS http_status_tight_box INT64,
  ADD COLUMN IF NOT EXISTS http_status_wide_box  INT64;

-- 4つ目のソース: 自治体の食品営業許可台帳。
-- IFAS は 2021年6月の食品衛生法改正以降の申請しか持たないため、改正前に許可を
-- 取った施設が丸ごと欠ける。実測で、Google の店に届かない分の中心は雑居ビル
-- 上階のスナック・バーで、許可台帳の住所には階数が入るのでそこを指せる。
-- ③（Google 側から見た到達率）は台帳のある自治体で 66.5% → 78.9% になった。
CREATE TABLE IF NOT EXISTS `${DATASET}.restaurant_food_permit_raw` (
  run_id             STRING NOT NULL,
  snapshot_date      DATE NOT NULL,
  source_release     STRING,
  source_record_id   STRING NOT NULL,
  jurisdiction       STRING,
  name               STRING,
  address            STRING,
  business_type      STRING,
  latitude           FLOAT64,
  longitude          FLOAT64,
  -- 'source'（台帳に座標があった） / 'geocoded:full' 等（国土地理院で解決した粒度）。
  -- 粗い座標を番地レベルと誤認しないために残す。
  coordinate_source  STRING,
  is_active          BOOL NOT NULL,
  raw_payload_json   STRING,
  record_hash        STRING NOT NULL,
  ingested_at        TIMESTAMP NOT NULL
)
PARTITION BY snapshot_date
CLUSTER BY run_id, jurisdiction
OPTIONS (
  require_partition_filter = TRUE,
  description = '自治体が公開する食品営業許可施設一覧。IFAS に載らない改正前の許可を補う。'
);
