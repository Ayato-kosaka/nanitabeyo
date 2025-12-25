-- ==============================================================================
-- 20251224T0004_create_dish_category_localized_text.sql
-- ==============================================================================
-- 【目的】
-- BigQuery → PostgreSQL 同期のため、dish_category_localized_text テーブルを作成
-- 
-- 【テーブル内容】
-- - dish_category に対する感情訴求型コピー（topic_title / tagline）を管理
-- - BigQuery の dish_category_localized_text_catalog から同期
-- 
-- 【背景】
-- - LLM 生成の感情訴求型コピーを多言語で管理
-- - PostgreSQL は Serving DB として localized text を保持
-- - BigQuery を SoT とし、採用版のみを同期
-- 
-- 【ロールバック】
-- - DROP TABLE IF EXISTS dish_category_localized_text;
-- ==============================================================================

-- =========================================
-- Up
-- =========================================

-- dish_category_localized_text テーブル作成
CREATE TABLE dish_category_localized_text (
    dish_category_id TEXT        NOT NULL REFERENCES dish_categories(id) ON DELETE CASCADE,
    locale           TEXT        NOT NULL,
    topic_title      TEXT        NOT NULL,
    tagline          TEXT        NOT NULL,
    synced_at        TIMESTAMPTZ NOT NULL,
    
    PRIMARY KEY (dish_category_id, locale)
);

-- インデックス作成
-- 負荷が高い場合は、以下のインデックスを有効化検討
-- CREATE INDEX dclt_cat_locale_inc
--   ON dish_category_localized_text (dish_category_id, locale)
--   INCLUDE (topic_title, tagline);

-- コメント
COMMENT ON TABLE dish_category_localized_text 
  IS 'dish_category の感情訴求型コピー（LLM生成）、BigQuery から同期';

COMMENT ON COLUMN dish_category_localized_text.dish_category_id 
  IS 'dish_category QID（FK、CASCADE削除）';

COMMENT ON COLUMN dish_category_localized_text.locale 
  IS 'ロケール（BCP47形式: ja-JP, en 等）';

COMMENT ON COLUMN dish_category_localized_text.topic_title 
  IS '感情訴求型タイトル（最大12-14文字）';

COMMENT ON COLUMN dish_category_localized_text.tagline 
  IS 'キャッチコピー（最大45文字）';

COMMENT ON COLUMN dish_category_localized_text.synced_at 
  IS 'BigQuery から最後に同期された日時';

-- RLS 有効化
ALTER TABLE dish_category_localized_text ENABLE ROW LEVEL SECURITY;

-- =========================================
-- Down (rollback)
-- =========================================
-- 元に戻す場合は、以下のコマンドを実行する
-- DROP TABLE IF EXISTS dish_category_localized_text;
