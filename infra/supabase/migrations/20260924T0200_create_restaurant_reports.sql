-- ==============================================================================
-- 20260924T0200_create_restaurant_reports.sql
-- #1933（決定元: #1827 / 親: #843）
-- ==============================================================================
-- 【目的】
-- 「この店の情報が違う」というユーザーからの**報告**を保存する。
-- オーナーが 1 件ずつ見て、承認したものだけ `restaurants` へ反映する。
--
-- 【なぜ独立テーブルなのか】
-- #1827 で「ユーザーの編集は報告として扱う。置き場所は DB の報告テーブル。
-- GitHub Issue は «その日見る画面» であって記録の正本にしない。
-- `restaurants` に確認済みフラグは持たない」が承認された（2026-09-09）。
--
-- ⚠️ **`content_reports`（投稿・レビューへの通報）に相乗りさせない。**
-- 2026-09-23 オーナー判断「テーブルが違うなら分けるべき」。通報は «消すかどうか»、
-- 報告は «値を直すかどうか» で、持つべき列（どの項目の・どんな値へ）が違う。
--
-- 【実装方針】
-- - **RLS はポリシー無しで有効化する。** `content_reports` と同じ。クライアント直アクセスを
--   塞ぎ、書き込みは API（service role）経由に限定する。報告者が自分の報告を消せないこと、
--   他人の報告が見えないことはこの状態で担保される。**ここに SELECT / INSERT ポリシーを足さない**
-- - 報告しても `restaurants` はその場で変わらない（#1933 受け入れ条件 5）。
--   承認された分だけ書き戻す
-- - **1 報告 = 1 GitHub Issue。** 日次のまとめは作らない（2026-09-23 オーナー判断）。
--   起票は github-actions bot が行い @Ayato-kosaka へメンションする。
--   ⚠️ **`proposed_value` を Issue 本文へ転記しないこと。** このリポジトリは public で、
--   ユーザーの自由入力を含みうる（`content_reports.reason_text` と同じ扱い）。
--   Issue には `id` と `field` だけを載せ、値はオーナーが管理画面/DB で見る
-- ==============================================================================

-- 依存拡張（gen_random_uuid）
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- Table: restaurant_reports
-- =========================

CREATE TABLE IF NOT EXISTS restaurant_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 報告対象の店。restaurants は削除されない運用だが、消えたときに報告だけ残っても
  -- 判定できないので CASCADE で落とす
  restaurant_id    uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  -- 報告者（JWT の uid）。
  -- ⚠️ **`REFERENCES users(id)` を付けないこと。** 匿名ユーザーには `users` 行が存在せず、
  -- FK を張ると匿名からの報告が必ず失敗する（share_links で実測済み。content_reports と同じ）
  reporter_user_id uuid NOT NULL,

  -- 何が違うのか（選択式）。
  -- ⚠️ **この 3 つは «店舗画面に出ていて、ユーザーが間違いに気づけるもの» である**
  --    （2026-09-23。画面を撮って確定: docs/evidence/1933/01-detail-with-data.png）。
  --    住所・位置は画面に 1 文字も出ていないので入れない。出すようになったら足す。
  -- ⚠️ 値の集合は shared 側の定数と **同じ集合**でなければならない。
  --    片方だけ増やすと API は 201 を返すのに INSERT が落ちる（content_reports で踏んだ形）
  field            text NOT NULL
    CONSTRAINT restaurant_reports_field_check
    CHECK (field IN ('name', 'closed', 'opening_hours')),

  -- ユーザーが入力した «正しい値»。
  -- ⚠️ **入力欄は空で始めること（画面側の仕様）。** 画面に出ている値（Google 由来のことがある）を
  --    初期値に入れると、ユーザーが何も直さず送信したときに Google の値がユーザー入力の顔をして
  --    `restaurants` へ入る。ToS 上の «保存しない» が見かけ倒しになる
  -- ⚠️ 第三者の個人情報を含みうる。**外部（GitHub Issue 等）へ転記しないこと**
  -- `field = 'closed'`（閉店した）は値を伴わないので NULL を許す
  proposed_value   text NULL
    CHECK (proposed_value IS NULL OR char_length(proposed_value) <= 500),

  -- オーナーの処理ステータス
  status           text NOT NULL DEFAULT 'pending'
    CONSTRAINT restaurant_reports_status_check
    CHECK (status IN ('pending', 'actioned', 'rejected')),
  resolved_at      timestamptz NULL,
  resolution_note  text NULL,

  -- 起票した GitHub Issue の番号。1 報告 = 1 Issue。
  -- 起票前は NULL。起票に失敗しても報告そのものは残す（起票はリトライできる）
  github_issue_number integer NULL,

  -- 報告時のアプリバージョン（reactions / dish_reviews / content_reports と同じ運用）
  created_version  text NOT NULL DEFAULT 'unknown',

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  lock_no          integer NOT NULL DEFAULT 0,

  -- 同じユーザーが同じ店の同じ項目を二重に報告できないこと（#1933 受け入れ条件 10）。
  -- ⚠️ 部分索引（pending のみ一意）にしないこと。却下された報告を延々と出し直せる余地を残すため。
  --    API 側はこの制約に当たったとき 409 ではなく **既存の報告 ID を返す**（冪等）ので、
  --    ユーザーには「受け付けました」としか見えない（content_reports と同じ作法）
  CONSTRAINT uq_restaurant_reports_reporter_target
    UNIQUE (reporter_user_id, restaurant_id, field)
);

-- =========================
-- インデックス
-- =========================

-- 「未処理を古い順に」引くための索引（起票ジョブと、取りこぼしの拾い直しが使う）
CREATE INDEX IF NOT EXISTS idx_restaurant_reports_status_created
  ON restaurant_reports (status, created_at);

-- 「この店への報告一覧」を引くための索引。
-- uq_restaurant_reports_reporter_target は reporter_user_id が先頭なので、この用途には効かない
CREATE INDEX IF NOT EXISTS idx_restaurant_reports_restaurant
  ON restaurant_reports (restaurant_id, field);

-- Issue 番号から報告を引く（オーナーが Issue 上で «反映 / 却下» を返したときの入口）。
-- 起票前は NULL なので部分索引にする
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_reports_github_issue
  ON restaurant_reports (github_issue_number)
  WHERE github_issue_number IS NOT NULL;

-- =========================
-- テーブルコメント
-- =========================

COMMENT ON TABLE restaurant_reports IS
  '店舗情報の «この情報が違う» 報告。オーナーが 1 件ずつ承認して restaurants へ反映する。RLS ポリシーを持たず、書き込みは API 経由のみ';

COMMENT ON COLUMN restaurant_reports.id IS
  '報告ID（UUID）。報告者へ返す受付番号を兼ねる';
COMMENT ON COLUMN restaurant_reports.restaurant_id IS
  '報告対象の店（restaurants.id）';
COMMENT ON COLUMN restaurant_reports.reporter_user_id IS
  '報告者の auth uid。匿名ユーザーに users 行が無いため外部キー制約は張らない';
COMMENT ON COLUMN restaurant_reports.field IS
  '何が違うか。name（店名）/ closed（閉店した）/ opening_hours（営業時間）。店舗画面に出ていてユーザーが気づける項目だけを入れる（2026-09-23 確定）';
COMMENT ON COLUMN restaurant_reports.proposed_value IS
  'ユーザーが入力した正しい値。closed は値を伴わないので NULL。⚠️ 外部（GitHub Issue 等）へ転記しないこと';
COMMENT ON COLUMN restaurant_reports.status IS
  'pending（未処理）/ actioned（反映した）/ rejected（反映しないと判断）';
COMMENT ON COLUMN restaurant_reports.resolved_at IS
  'actioned / rejected になった日時';
COMMENT ON COLUMN restaurant_reports.resolution_note IS
  'オーナーの対応メモ。報告者には見せない';
COMMENT ON COLUMN restaurant_reports.github_issue_number IS
  'この報告のために立てた GitHub Issue の番号。1 報告 = 1 Issue。起票前は NULL';
COMMENT ON COLUMN restaurant_reports.created_version IS
  '報告時のアプリバージョン（x-app-version ヘッダ由来。未送信なら unknown）';
COMMENT ON COLUMN restaurant_reports.created_at IS
  '報告日時';
COMMENT ON COLUMN restaurant_reports.updated_at IS
  '最終更新日時';
COMMENT ON COLUMN restaurant_reports.lock_no IS
  '楽観ロック用バージョン番号（既存テーブルと同じ運用）';

-- =========================
-- RLS
-- =========================

-- ⚠️ **ポリシーを 1 つも作らないこと。** RLS を有効化してポリシーが無い状態は
-- 「anon / authenticated ロールからは 1 行も見えない・書けない」を意味する。
-- 報告者が自分の報告を消せない・他人の報告が見えないのは、この状態によって担保される。
ALTER TABLE restaurant_reports ENABLE ROW LEVEL SECURITY;

-- ==================================================================
-- 既存テーブルを現行仕様へ揃え直す（冪等化）
--
-- ⚠️ 上の CREATE TABLE は IF NOT EXISTS なので、既にテーブルがある環境では
--    丸ごとスキップされ、インライン制約の変更は一切反映されない。
--    scripts/apply-migration.sh は from_file 以降を毎回全部流すため、
--    「テーブルが既にある環境」は普通に起こりうる。値域の実体はここで張り直す。
-- ==================================================================

ALTER TABLE restaurant_reports
  DROP CONSTRAINT IF EXISTS restaurant_reports_field_check;
ALTER TABLE restaurant_reports
  ADD CONSTRAINT restaurant_reports_field_check
  CHECK (field IN ('name', 'closed', 'opening_hours')) NOT VALID;
ALTER TABLE restaurant_reports VALIDATE CONSTRAINT restaurant_reports_field_check;

ALTER TABLE restaurant_reports
  DROP CONSTRAINT IF EXISTS restaurant_reports_status_check;
ALTER TABLE restaurant_reports
  ADD CONSTRAINT restaurant_reports_status_check
  CHECK (status IN ('pending', 'actioned', 'rejected')) NOT VALID;
ALTER TABLE restaurant_reports VALIDATE CONSTRAINT restaurant_reports_status_check;
