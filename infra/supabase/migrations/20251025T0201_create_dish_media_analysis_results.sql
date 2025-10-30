-- 依存拡張
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- Table: dish_media_analysis_results
-- 役割: 各メディアの累積カウンタ（率は都度計算）
-- 備考: dish_media と 1:1。更新頻度が高い集計用のため updated_at をトリガで自動更新
-- ============================================

CREATE TABLE IF NOT EXISTS dish_media_analysis_results (
  dish_media_id     uuid PRIMARY KEY
                    REFERENCES dish_media(id) ON DELETE CASCADE,

  -- 累積カウンタ（負数禁止）
  impr_total        bigint NOT NULL DEFAULT 0 CHECK (impr_total >= 0),
  view_total        bigint NOT NULL DEFAULT 0 CHECK (view_total >= 0),
  skip_total        bigint NOT NULL DEFAULT 0 CHECK (skip_total >= 0),
  completion_total  bigint NOT NULL DEFAULT 0 CHECK (completion_total >= 0),
  watch_ms_total    bigint NOT NULL DEFAULT 0 CHECK (watch_ms_total >= 0),
  save_total        bigint NOT NULL DEFAULT 0 CHECK (save_total >= 0),
  like_total        bigint NOT NULL DEFAULT 0 CHECK (like_total >= 0),
  open_map_total    bigint NOT NULL DEFAULT 0 CHECK (open_map_total >= 0),

  -- 監査
  created_at        timestamptz(6) NOT NULL DEFAULT now(),
  updated_at        timestamptz(6) NOT NULL DEFAULT now()
);

-- インデックス（トレンド検出・ランキング）
CREATE INDEX IF NOT EXISTS idx_dma_results_updated_at ON dish_media_analysis_results (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_dma_results_impr_total ON dish_media_analysis_results (impr_total DESC);

-- コメント（テーブル）
COMMENT ON TABLE dish_media_analysis_results IS '各メディアの累積パフォーマンス指標（率は都度計算）。dish_media と 1:1。';

-- コメント（カラム）
COMMENT ON COLUMN dish_media_analysis_results.dish_media_id IS 'dish_media の主キーを参照（削除時 CASCADE）';
COMMENT ON COLUMN dish_media_analysis_results.impr_total IS 'インプレッション累計';
COMMENT ON COLUMN dish_media_analysis_results.view_total IS '視聴（開始）累計';
COMMENT ON COLUMN dish_media_analysis_results.skip_total IS 'スキップ累計';
COMMENT ON COLUMN dish_media_analysis_results.completion_total IS '完視聴累計';
COMMENT ON COLUMN dish_media_analysis_results.watch_ms_total IS '累積視聴時間（ms）';
COMMENT ON COLUMN dish_media_analysis_results.save_total IS '保存累計';
COMMENT ON COLUMN dish_media_analysis_results.like_total IS 'いいね累計';
COMMENT ON COLUMN dish_media_analysis_results.open_map_total IS '地図オープン累計';
COMMENT ON COLUMN dish_media_analysis_results.created_at IS 'レコード作成日時';
COMMENT ON COLUMN dish_media_analysis_results.updated_at IS 'レコード更新日時';

-- updated_at 自動更新トリガ
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS set_updated_at_on_dmar ON dish_media_analysis_results;
CREATE TRIGGER set_updated_at_on_dmar
BEFORE UPDATE ON dish_media_analysis_results
FOR EACH ROW
EXECUTE FUNCTION trg_set_updated_at();


-- RLS 有効化
ALTER TABLE dish_media_analysis_results ENABLE ROW LEVEL SECURITY;

