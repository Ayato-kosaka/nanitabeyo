-- チケット: 料理カテゴリ提案API（オンライン処理）実装
-- #582 dish_category_localized_text テーブル作成
--
-- 【目的】
-- dish_category の感情訴求型コピー（topic_title / tagline）を多言語で保持
-- オンラインAPIで参照し、ローカライズ文言を返却
--
-- 【データソース】
-- BigQuery の dish_category_localized_text_catalog から LLM 生成された
-- confidence='high' のテキストをバッチで同期される想定
--
-- 【ロールバック】
-- DROP TABLE IF EXISTS dish_category_localized_text;

-- テーブル定義
CREATE TABLE dish_category_localized_text (
    category_id     TEXT        NOT NULL,
    lang            TEXT        NOT NULL,
    topic_title     TEXT        NOT NULL,
    tagline         TEXT        NOT NULL,
    source          TEXT        NOT NULL,
    selected_run_id TEXT        NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    note            TEXT,
    PRIMARY KEY (category_id, lang)
);

-- インデックス
CREATE INDEX idx_dclt_category ON dish_category_localized_text(category_id);
CREATE INDEX idx_dclt_lang ON dish_category_localized_text(lang);

-- コメント（テーブル）
COMMENT ON TABLE dish_category_localized_text IS '料理カテゴリのローカライズ文言テーブル（LLM生成の感情訴求型コピー）';

-- コメント（カラム）
COMMENT ON COLUMN dish_category_localized_text.category_id IS 'dish_categories.id への参照（Wikidata QID）';
COMMENT ON COLUMN dish_category_localized_text.lang IS '言語コード（BCP47形式: ja-JP, ja, en, en-US など）';
COMMENT ON COLUMN dish_category_localized_text.topic_title IS '感情訴求型タイトル（最大12-14文字目安）';
COMMENT ON COLUMN dish_category_localized_text.tagline IS 'キャッチコピー（最大45文字目安）';
COMMENT ON COLUMN dish_category_localized_text.source IS 'データソース（llm/manual）';
COMMENT ON COLUMN dish_category_localized_text.selected_run_id IS '採用した LLM run_id（監査・差分比較用）';
COMMENT ON COLUMN dish_category_localized_text.updated_at IS '最終更新日時';
COMMENT ON COLUMN dish_category_localized_text.note IS '任意メモ（model/pass情報など）';

-- RLS 有効化
ALTER TABLE dish_category_localized_text ENABLE ROW LEVEL SECURITY;
