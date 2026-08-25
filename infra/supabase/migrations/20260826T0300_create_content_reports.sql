-- ==============================================================================
-- 20260826T0300_create_content_reports.sql
-- #1514 (SAF-01)
-- ==============================================================================
-- 【目的】
-- 投稿（dish_media）とレビュー（dish_reviews）に対するユーザーからの通報を保存する。
-- 運営が「見て、対応する」ワークフローの起点になるテーブル。
--
-- 【背景】
-- 通報のためのテーブル・API・画面がこれまで一切無かった。近いものが 2 つあるが
-- どちらも使えない。
--
--   (1) POST /v1/feedback/issue … DB に保存せず public リポジトリの GitHub Issue へ
--       本文をそのまま POST する。対象コンテンツの ID も通報者も持たない。
--       通報に転用すると、第三者の個人情報を含みうる通報内容が全世界へ公開される
--   (2) reactions テーブル … app-expo/lib/reactions.ts が Supabase クライアントで
--       **クライアントから直接 insert / delete** している。RLS は
--       `WITH CHECK (auth.uid() = user_id)` なので、通報者は自分の通報を DELETE できる。
--       「運営が見るまで消えない証跡」でなければ通報の意味が無いので、消せる場所には置けない。
--       加えて運営の処理ステータス（未対応 / 対応済 / 却下）を持てない
--
-- 【実装方針】
-- - 独立テーブルを新設する（オーナー判断。Issue #1514 のコメントを参照）
-- - **RLS はポリシー無しで有効化する。** クライアント直アクセスを塞ぎ、書き込みは
--   API（service role）経由に限定する。これが reactions 相乗りを退けた最大の理由なので、
--   ここに SELECT / INSERT ポリシーを足さないこと
-- - 対象の指し方は既存 3 テーブル（reactions / contribution_tasks / share_links）に揃え、
--   target_type は「対象テーブル名」。対象テーブルが可変なので FK は張らない
-- - 通報しても投稿は即時非表示にしない。通報爆撃がそのまま検閲の道具になるため、
--   運営が見るまで表示は変わらない（このテーブルは表示側から参照されない）
-- ==============================================================================

-- 依存拡張（gen_random_uuid）
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- Table: content_reports
-- =========================

CREATE TABLE IF NOT EXISTS content_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 通報対象の種別。値は対象テーブル名。
  -- ⚠️ 値の集合は shared/api/v1/constants/contentReports.ts の
  --    CONTENT_REPORT_TARGET_TYPES と **同じ集合**でなければならない。
  --    片方だけ増やすと API は 201 を返すのに INSERT が落ちる。
  --    オーナー確定仕様により、対象は投稿（dish_media）とレビュー（dish_reviews）。
  --    ユーザー・店舗は対象外。
  -- ⚠️ 制約に明示的な名前を付けてあるのは、下の「揃え直し」ブロックが
  --    DROP CONSTRAINT IF EXISTS で確実に掴めるようにするため
  target_type      text NOT NULL
    CONSTRAINT content_reports_target_type_check
    CHECK (target_type IN ('dish_media', 'dish_reviews')),

  -- 通報対象の ID。target_type で示したテーブルの主キー。
  -- 対象テーブルが target_type によって変わるので FK は張らない（既存 3 テーブルと同じ方針）。
  -- 型は uuid（dish_media.id / dish_reviews.id がどちらも uuid のため。text にする理由が無い）
  target_id        uuid NOT NULL,

  -- 通報者（JWT の uid）。
  -- ⚠️ **`REFERENCES users(id)` を付けないこと。** このアプリのユーザーは Supabase Auth の
  -- 匿名サインインで始まり、**匿名ユーザーには `users` 行が存在しない**。FK を張ると
  -- 匿名ユーザーからの通報が必ず失敗する（share_links で
  -- `share_links_created_by_fkey` の violation を実測済み → 20260807T0100 で FK を落としている）。
  -- 通報の敷居を上げないため匿名ユーザーからの通報も受け付ける（オーナー確定）
  reporter_user_id uuid NOT NULL,

  -- 通報理由（選択式）。自由記述だけにすると「同じ理由の通報が何件あるか」を
  -- 集計できず、運営が優先順位を付けられない。
  -- ⚠️ 値の集合は CONTENT_REPORT_REASON_CODES と同じ集合を保つこと。
  --    理由コードは投稿・レビューで共通（片方だけの理由は今のところ無い）
  reason_code      text NOT NULL
    CONSTRAINT content_reports_reason_code_check
    CHECK (reason_code IN ('spam', 'sexual', 'violence', 'harassment', 'illegal',
                           'misinformation', 'rights', 'privacy', 'irrelevant', 'other')),

  -- 任意の自由記述。
  -- ⚠️ 第三者の個人情報を含みうる。**外部（GitHub Issue 等）へ転記しないこと。**
  -- 上限は DTO 側（@MaxLength）だけでなくここにも置く。API を経由しない経路で青天井にしないため
  reason_text      text NULL
    CHECK (reason_text IS NULL OR char_length(reason_text) <= 1000),

  -- 運営の処理ステータス。今回のスコープで作られるのは pending のみ
  -- （審査結果の通知・管理画面はスコープ外）。列と値だけ先に確定させておく
  status           text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewing', 'actioned', 'rejected')),
  resolved_at      timestamptz NULL,
  resolution_note  text NULL,

  -- 通報時のアプリバージョン（reactions / dish_reviews と同じ運用）
  created_version  text NOT NULL DEFAULT 'unknown',

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  lock_no          integer NOT NULL DEFAULT 0,

  -- 同じユーザーが同じ対象を何度も通報できないこと（オーナー確定仕様）。
  -- target_type を含むので、同じ ID が別テーブルに在っても衝突しない。
  -- ⚠️ 部分索引（未解決のものだけ一意）にしないこと。「解決後は再通報できる」形は
  -- 運営が rejected にした投稿を延々と通報し直せる余地を残す。
  -- API 側はこの制約に当たったとき 409 ではなく **既存の通報 ID を返す**（冪等）ため、
  -- ユーザーには「受け付けました」としか見えない
  CONSTRAINT uq_content_reports_reporter_target
    UNIQUE (reporter_user_id, target_type, target_id)
);

-- =========================
-- インデックス
-- =========================

-- 運営が「未対応を古い順に」引くための索引
CREATE INDEX IF NOT EXISTS idx_content_reports_status_created
  ON content_reports (status, created_at);

-- 「この投稿への通報一覧・件数」を引くための索引。
-- uq_content_reports_reporter_target は reporter_user_id が先頭なので、この用途には効かない
CREATE INDEX IF NOT EXISTS idx_content_reports_target
  ON content_reports (target_type, target_id);

-- =========================
-- テーブルコメント
-- =========================

COMMENT ON TABLE content_reports IS
  '投稿（dish_media）・レビュー（dish_reviews）への通報。運営の処理ワークフローの起点。RLS ポリシーを持たず、書き込みは API 経由のみ';

COMMENT ON COLUMN content_reports.id IS
  '通報ID（UUID）。通報者へ返す受付番号を兼ねる';
COMMENT ON COLUMN content_reports.target_type IS
  '通報対象の種別。値は対象テーブル名。現在は dish_media / dish_reviews（ユーザー・店舗は対象外）。対象テーブルが可変のため外部キー制約は張らない';
COMMENT ON COLUMN content_reports.target_id IS
  '通報対象のID。target_type で示したテーブルの主キー';
COMMENT ON COLUMN content_reports.reporter_user_id IS
  '通報者の auth uid。匿名ユーザーに users 行が無いため外部キー制約は張らない';
COMMENT ON COLUMN content_reports.reason_code IS
  '通報理由コード。shared/api/v1/constants/contentReports.ts の CONTENT_REPORT_REASON_CODES と同じ集合を保つこと';
COMMENT ON COLUMN content_reports.reason_text IS
  '任意の自由記述。第三者の個人情報を含みうるため、外部（GitHub Issue 等）へ転記しないこと';
COMMENT ON COLUMN content_reports.status IS
  'pending（未対応）/ reviewing（確認中）/ actioned（対応した）/ rejected（対応不要と判断）';
COMMENT ON COLUMN content_reports.resolved_at IS
  'actioned / rejected になった日時';
COMMENT ON COLUMN content_reports.resolution_note IS
  '運営の対応メモ。通報者には見せない';
COMMENT ON COLUMN content_reports.created_version IS
  '通報時のアプリバージョン（x-app-version ヘッダ由来。未送信なら unknown）';
COMMENT ON COLUMN content_reports.created_at IS
  '通報日時';
COMMENT ON COLUMN content_reports.updated_at IS
  '最終更新日時（運営の対応など）';
COMMENT ON COLUMN content_reports.lock_no IS
  '楽観ロック用バージョン番号（既存テーブルと同じ運用）';

-- =========================
-- RLS
-- =========================

-- ⚠️ **ポリシーを 1 つも作らないこと。** RLS を有効化してポリシーが無い状態は
-- 「anon / authenticated ロールからは 1 行も見えない・書けない」を意味する。
-- 通報者が自分の通報を消せない・他人の通報が見えないのは、この状態によって担保される。
-- （自分の通報一覧を見せる要件が出たら、SELECT ポリシーではなく API を足すこと）
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;

-- ==================================================================
-- 既存テーブルを現行仕様へ揃え直す
--
-- ⚠️ **上の CREATE TABLE は IF NOT EXISTS なので、既にテーブルがある環境では
--    丸ごとスキップされ、インライン制約の変更は一切反映されない。**
--    scripts/apply-migration.sh は from_file 以降を毎回全部流すため、
--    「テーブルが既にある環境」は普通に起こりうる。
--    よって値域の実体はここで DROP → ADD で張り直す
--    （ADD CONSTRAINT に IF NOT EXISTS は無いので DROP CONSTRAINT IF EXISTS を必ず前に置く）。
--
--    何度流しても同じ結果になる（冪等）ように書いてある。
-- ==================================================================

-- --- target_type の値域（dish_reviews を追加） ---------------------
-- 初版は ('dish_media') だけだった。レビューも通報できるようになったので張り替える。
-- ⚠️ 値域の «緩和» なので既存行は 1 行も違反しない（規則 3 の additive に収まる）。
--    NOT VALID → VALIDATE の 2 段にするのは、張り替えの一瞬でも
--    ACCESS EXCLUSIVE で全行走査を抱えないため
ALTER TABLE content_reports
  DROP CONSTRAINT IF EXISTS content_reports_target_type_check;
ALTER TABLE content_reports
  ADD CONSTRAINT content_reports_target_type_check
  CHECK (target_type IN ('dish_media', 'dish_reviews')) NOT VALID;
ALTER TABLE content_reports VALIDATE CONSTRAINT content_reports_target_type_check;

-- --- reason_code の値域（初版から変更なし。名前だけ揃える） ---------
-- 初版は無名のインライン CHECK だったため、環境によっては Postgres が付けた
-- 既定名（content_reports_reason_code_check）で存在する。同じ名前なので
-- DROP → ADD で確実に現行の値域へ揃う
ALTER TABLE content_reports
  DROP CONSTRAINT IF EXISTS content_reports_reason_code_check;
ALTER TABLE content_reports
  ADD CONSTRAINT content_reports_reason_code_check
  CHECK (reason_code IN ('spam', 'sexual', 'violence', 'harassment', 'illegal',
                         'misinformation', 'rights', 'privacy', 'irrelevant', 'other')) NOT VALID;
ALTER TABLE content_reports VALIDATE CONSTRAINT content_reports_reason_code_check;
