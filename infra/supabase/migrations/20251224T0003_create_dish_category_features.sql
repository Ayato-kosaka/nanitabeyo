-- ==============================================================================
-- 20251224T0003_create_dish_category_features.sql
-- ==============================================================================
-- 【目的】
-- BigQuery → PostgreSQL 同期のため、dish_category_features テーブルを作成
-- 
-- 【テーブル内容】
-- - dish_category に対する特徴量（gate / satiety / scene / taste 等）を管理
-- - BigQuery の dish_category_features_catalog から同期
-- 
-- 【背景】
-- - BigQuery を SoT とし、PostgreSQL は Serving DB として特徴量を保持
-- - gate（region whitelist）、将来的には satiety / scene / timeSlot / taste も追加
-- 
-- 【ロールバック】
-- - DROP TABLE IF EXISTS dish_category_features;
-- ==============================================================================

-- =========================================
-- Up
-- =========================================

-- dish_category_features テーブル作成
CREATE TABLE dish_category_features (
    dish_category_id TEXT             NOT NULL REFERENCES dish_categories(id) ON DELETE CASCADE,
    feature_type     TEXT             NOT NULL,
    feature_key      TEXT             NOT NULL,
    score            DOUBLE PRECISION NOT NULL,
    synced_at        TIMESTAMPTZ      NOT NULL,
    
    PRIMARY KEY (dish_category_id, feature_type, feature_key)
);

-- インデックス作成
CREATE INDEX dcf_gate_key_catid_pos
  ON dish_category_features (feature_key, dish_category_id)
  WHERE feature_type = 'gate' AND score > 0;

-- コメント
COMMENT ON TABLE dish_category_features 
  IS 'dish_category の特徴量（gate / satiety / scene / taste 等）、BigQuery から同期';

COMMENT ON COLUMN dish_category_features.dish_category_id 
  IS 'dish_category QID（FK、CASCADE削除）';

COMMENT ON COLUMN dish_category_features.feature_type 
  IS '特徴量タイプ（gate | satiety | scene | timeSlot | taste 等)';

COMMENT ON COLUMN dish_category_features.feature_key 
  IS '特徴量キー（region:scope:global, region:country:JP, morning, lunch 等）';

COMMENT ON COLUMN dish_category_features.score 
  IS 'スコア（特徴量の重要度や有無を示す数値）';

COMMENT ON COLUMN dish_category_features.synced_at 
  IS 'BigQuery から最後に同期された日時';

-- RLS 有効化
ALTER TABLE dish_category_features ENABLE ROW LEVEL SECURITY;

-- =========================================
-- Down (rollback)
-- =========================================
-- 元に戻す場合は、以下のコマンドを実行する
-- DROP TABLE IF EXISTS dish_category_features;
