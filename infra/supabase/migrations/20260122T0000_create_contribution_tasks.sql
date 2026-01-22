-- ==============================================================================
-- 20260122T0000_create_contribution_tasks.sql
-- #699
-- ==============================================================================
-- 【目的】
-- ユーザー協力・フィードバックを汎用的に記録するテーブルを作成
--
-- 【背景】
-- 「料理提案画像最適化」などのユーザー協力企画を今後も増やしていく前提で、
-- 企画ごとの協力（事実ログ）を汎用的に保存できる基盤を先に用意する。
-- 更新先テーブル等の「結果の使い方」は後段の集計/バッチに委ね、
-- まずは再現可能な事実ログを蓄積する。
--
-- 【実装方針】
-- - 協力データは「事実ログ」として保存し、特定テーブル更新前提にしない
-- - 企画識別子は task_key（例: food_image_optimize_v1）で統一
-- - 対象は target_type + target_id で汎用参照
-- - 企画固有情報は payload(jsonb)、ユーザー回答は result(jsonb) に保存
-- ==============================================================================

-- 依存拡張
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- Table: contribution_tasks
-- =========================

CREATE TABLE IF NOT EXISTS contribution_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 例: image_feedback, image_comparison, text_feedback, choice_vote
  type          text NOT NULL,

  -- 例: dish_category_image_optimize_v1, restaurant_card_ab_2026_01
  task_key      text NOT NULL,

  -- 例: dish_categories, image, app_screen (対象の種別)
  target_type   text NOT NULL,

  -- 対象ID（対象テーブルは企画によって異なるのでFKは張らない）
  target_id     text NOT NULL,

  -- ユーザーに提示したデータ(再現性のため)
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ユーザーの回答/選択結果
  result        jsonb NOT NULL DEFAULT '{}'::jsonb,

  user_id       uuid NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now()
);

-- =========================
-- インデックス
-- =========================

-- 基本インデックス（集計と検索）
CREATE INDEX IF NOT EXISTS idx_contribution_tasks_task_key
  ON contribution_tasks (task_key);

CREATE INDEX IF NOT EXISTS idx_contribution_tasks_target
  ON contribution_tasks (target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_contribution_tasks_user_created_at
  ON contribution_tasks (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contribution_tasks_created_at
  ON contribution_tasks (created_at DESC);

-- jsonb検索を見越したGIN（重ければ後回しでもOK）
CREATE INDEX IF NOT EXISTS idx_contribution_tasks_payload_gin
  ON contribution_tasks USING gin (payload);

CREATE INDEX IF NOT EXISTS idx_contribution_tasks_result_gin
  ON contribution_tasks USING gin (result);

-- =========================
-- テーブルコメント
-- =========================

COMMENT ON TABLE contribution_tasks IS
  'ユーザー協力・フィードバックを汎用的に記録するためのテーブル。企画（task_key）単位で、ユーザーに提示した内容（payload）と回答結果（result）を事実ログとして保存する。特定の更新処理や集計ロジックには依存しない設計。';

COMMENT ON COLUMN contribution_tasks.id IS
  '協力タスクの一意な識別子（UUID）';

COMMENT ON COLUMN contribution_tasks.type IS
  '協力の種類。画面UIや集計ロジックの分岐に使用する（例: image_feedback, image_comparison など）';

COMMENT ON COLUMN contribution_tasks.task_key IS
  '企画を識別するキー。分析・集計・バージョン管理の主軸となる（例: food_image_optimize_v1）';

COMMENT ON COLUMN contribution_tasks.target_type IS
  '協力対象の種別。どの種類のデータに対する協力かを示す（例: dish, image, app_screen）';

COMMENT ON COLUMN contribution_tasks.target_id IS
  '協力対象のID。target_type で指定された対象の主キーID。汎用性を保つため外部キー制約は張らない';

COMMENT ON COLUMN contribution_tasks.payload IS
  'ユーザーに提示した情報。後から当時の状況を再現できるよう、表示内容や質問文などをJSONで保存する';

COMMENT ON COLUMN contribution_tasks.result IS
  'ユーザーの回答・選択結果。選択肢、評価スコア、自由記述コメントなどをJSONで保存する';

COMMENT ON COLUMN contribution_tasks.user_id IS
  '協力を行ったユーザーのID（認証ユーザー）';

COMMENT ON COLUMN contribution_tasks.created_at IS
  '協力が行われた日時（レコード作成日時）';

-- =========================
-- RLS（有効化のみ。ポリシーは作らない＝クライアント直アクセス不可）
-- =========================

ALTER TABLE contribution_tasks ENABLE ROW LEVEL SECURITY;
