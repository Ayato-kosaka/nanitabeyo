-- チケット: 料理カテゴリ提案API（オンライン処理）実装
-- #533 dish_category_features テーブル作成
--
-- 【目的】
-- dish_category に対する特徴量（gate / relevance / market_salience / dine_out_orderability 等）を保持
-- オンラインAPIで参照し、スコアリング・ランキング・フィルタリングに使用
--
-- 【データソース】
-- BigQuery の dish_category_features_catalog からバッチで同期される想定
--
-- 【ロールバック】
-- DROP TABLE IF EXISTS dish_category_features;

-- テーブル定義
CREATE TABLE dish_category_features (
    category_id   TEXT        NOT NULL,
    feature_type  TEXT        NOT NULL,
    feature_key   TEXT        NOT NULL,
    score         FLOAT8      NOT NULL,
    source        TEXT        NOT NULL,
    run_id        TEXT        NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    note          TEXT,
    PRIMARY KEY (category_id, feature_type, feature_key)
);

-- インデックス
CREATE INDEX idx_dcf_category_type ON dish_category_features(category_id, feature_type);
CREATE INDEX idx_dcf_feature_type_key ON dish_category_features(feature_type, feature_key);

-- コメント（テーブル）
COMMENT ON TABLE dish_category_features IS '料理カテゴリの特徴量テーブル（ゲート・ランキング用）';

-- コメント（カラム）
COMMENT ON COLUMN dish_category_features.category_id IS 'dish_categories.id への参照（Wikidata QID）';
COMMENT ON COLUMN dish_category_features.feature_type IS '特徴量タイプ（gate/timeSlot/scene/satiety/taste/market_salience/dine_out_orderability）';
COMMENT ON COLUMN dish_category_features.feature_key IS '特徴量キー（region:country:JP, timeSlot:lunch, global など）';
COMMENT ON COLUMN dish_category_features.score IS 'スコア値（gateは1固定、他は0-1の範囲）';
COMMENT ON COLUMN dish_category_features.source IS 'データソース（llm/manual/rule）';
COMMENT ON COLUMN dish_category_features.run_id IS 'バッチ実行ID（監査用）';
COMMENT ON COLUMN dish_category_features.updated_at IS '最終更新日時';
COMMENT ON COLUMN dish_category_features.note IS '任意メモ（JSON形式で confidence/model/task などを保持）';

-- RLS 有効化
ALTER TABLE dish_category_features ENABLE ROW LEVEL SECURITY;
