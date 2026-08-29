-- ==============================================================================
-- 20260828T0000_add_restaurants_address_country_and_links.sql
-- #1681 / #843
-- ==============================================================================
-- 【目的】
-- restaurants に「住所」と「国コード」を持たせ、電話・公式サイト・SNS を別表で持つ。
-- **追加のみ（expand）**で、既存コードは 1 行も壊れない。削除は別 migration。
--
-- 【なぜ必要か】
--
-- ① address / country_code
--   今この 2 つは `address_components`（jsonb）を掘って得ている。実際に読んでいるのは
--   2 箇所だけで、どちらも **国の 2 文字コードしか見ていない**。
--     - app-expo `lib/googlePlaces.ts` : 国コード → 通貨コード
--     - api `locations.service.ts`     : 国コード → 現地言語コード
--   入れ子 JSON を掘り続ける理由が無く、しかも Google の表示テキストに依存するため
--   呼び出し元の言語によって別の値が出る（実測: live 経路は `Tokyo`、DB 経路は `東京都`）。
--   2 文字コードとして明示的に持てば、この不安定さが消える。
--
--   加えて **オープンデータ由来の 62 万行は `address_components` が空**である。
--   Google Places の住所は ToS 3.2.3 で保持できないので、そこを埋める道は
--   「オープンデータの住所を入れる」しかない。保有率は実測 99.997%（621,595/621,616）。
--
-- ② restaurant_links
--   BigQuery の `restaurant_catalog` は phone / website / social_urls を**計算済み**なのに、
--   PG 側に受け口が無いため 9_1 が捨てている。保有率は電話 89.2% / SNS 79.2% / サイト 44.9%。
--   とくに `website` は営業時間の取得（#1666）の入口で、これが無いと着手できない。
--
--   1 店に複数あり得る（電話 2 本、SNS 複数）ので restaurants の列にはしない。
--
-- 【country_code を NOT NULL にしない理由】
--
-- 実測で、アプリ製 2,467 行のうち **1 行だけ国が引けない**。南オセチア・ツヒンヴァリの
-- 店で、`address_components` に country 要素そのものが無い（Google が係争地域の国を
-- 返さない）。座標から補うのは «どの国か» という政治的判断になるので、こちらでは決めない。
-- NULL を許し、引けないときは NULL のままにする。
-- 通貨・言語の解決は既に「引けなければユーザーに選ばせる」形なので NULL で壊れない。
--
-- 【既存データへの影響】
-- NULL 許容の列追加とテーブル新設のみ。既存行は書き換わらない（テーブル rewrite 無し）。
-- 値を入れるのは別途 backfill（オープンデータから。Google は叩かない）。
--
-- 【ロールバック】
--   DROP TABLE IF EXISTS restaurant_links;
--   ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_country_code_check;
--   ALTER TABLE restaurants DROP COLUMN IF EXISTS country_code;
--   ALTER TABLE restaurants DROP COLUMN IF EXISTS address;
-- ==============================================================================

BEGIN;

-- =========================
-- restaurants: address / country_code
-- =========================

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS country_code TEXT;

COMMENT ON COLUMN restaurants.address IS
  '表示用の1行住所。オープンデータ由来（Google Places の住所は ToS 3.2.3 で保持不可）。'
  '構造化が必要になったら別途カラムを足す。NULL は「まだ埋めていない」。';

COMMENT ON COLUMN restaurants.country_code IS
  'ISO-3166-1 alpha-2。通貨コードと現地言語コードの解決に使う。'
  'Google が国を返さない係争地域があるため NULL 許容（実測1行）。';

-- 形式だけ固定する。値の集合（実在する国か）は問わない。
ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_country_code_check;
ALTER TABLE restaurants
  ADD CONSTRAINT restaurants_country_code_check
  CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');

-- 国別の集計・絞り込み用。NULL は入れない（部分索引）。
CREATE INDEX IF NOT EXISTS idx_restaurants_country_code
  ON restaurants(country_code) WHERE country_code IS NOT NULL;

-- =========================
-- Table: restaurant_links
-- =========================
--
-- 1 店 × 種別 × 値 で 1 行。同じ種別を複数持てる（電話 2 本、SNS 複数）。
-- `source` を主キーに含めないのは、同じ値を別の出所が持っていても
-- **同じ 1 本のリンク**だからである（出所は先に入れた方を残す）。

CREATE TABLE IF NOT EXISTS restaurant_links (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  -- リンクの種別。値の集合はアプリ側の定数と揃えること。
  kind          TEXT NOT NULL,

  -- 電話番号・URL の実体。正規化してから入れる（E.164 / スキーム付き URL）。
  value         TEXT NOT NULL,

  -- どこから得たか。overture / osm / ifas / food_permit / official_site / user / owner
  source        TEXT NOT NULL,

  -- いつ取得したか。鮮度の判断に使う。
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (restaurant_id, kind, value)
);

ALTER TABLE restaurant_links DROP CONSTRAINT IF EXISTS restaurant_links_kind_check;
ALTER TABLE restaurant_links
  ADD CONSTRAINT restaurant_links_kind_check
  CHECK (kind IN ('phone', 'website', 'instagram', 'x', 'tiktok', 'facebook', 'other'));

ALTER TABLE restaurant_links DROP CONSTRAINT IF EXISTS restaurant_links_value_not_blank;
ALTER TABLE restaurant_links
  ADD CONSTRAINT restaurant_links_value_not_blank
  CHECK (btrim(value) <> '');

COMMENT ON TABLE restaurant_links IS
  '店の電話・公式サイト・SNS。1店に複数あり得るので restaurants の列にはしない。'
  'BigQuery の restaurant_catalog が計算済みの phone/website/social_urls の受け口。';

-- 店から引く（表示・営業時間クロールの対象抽出）。
CREATE INDEX IF NOT EXISTS idx_restaurant_links_restaurant_kind
  ON restaurant_links(restaurant_id, kind);

-- 種別から引く（#1666: website を持つ店だけを対象にする）。
CREATE INDEX IF NOT EXISTS idx_restaurant_links_kind
  ON restaurant_links(kind);

-- クライアントからの直接アクセスを塞ぐ。書き込みは API / パイプライン（service role）経由。
-- content_reports（20260826T0300）と同じ方針で、ポリシーは置かない。
ALTER TABLE restaurant_links ENABLE ROW LEVEL SECURITY;

COMMIT;
