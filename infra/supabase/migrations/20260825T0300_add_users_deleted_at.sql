-- =============================================================================
-- #1511 ACC-01 アプリ内でアカウントを削除できるようにする
--   users に論理削除カラム deleted_at を追加する
--
-- ## 目的
-- 設定画面からの「アカウントを削除」を実装するために、`users` 行に
-- 「削除済み」を表す状態を持たせる。削除処理 (DELETE /v1/users/me) は
-- この 1 カラムを立てると同時に、同じトランザクションの中で PII
-- (username / display_name / bio / avatar_path) を匿名値へ上書きする。
--
-- ## 背景 — なぜ users 行を物理削除しないのか（リーダー判断 #1511）
-- `users.id` は dish_media / dish_reviews / dish_media_likes / restaurant_bids
-- から参照されており、いずれの外部キーも `ON DELETE NO ACTION` である。
-- とくに:
--   - `dish_media_likes.user_id` と `restaurant_bids.user_id` は **NOT NULL** なので
--     `SET NULL` に倒せない
--   - `restaurant_bids` を CASCADE で消すと、それを参照する `payouts`（振込記録）まで
--     連鎖して消える。会計・資金決済の記録をユーザー操作で消せる構造にはできない
-- したがって「行は残す・中身を匿名化する・deleted_at で読み取り経路から外す」を採る。
-- 法令（GDPR / 個人情報保護法）が求めるのは個人を識別できる情報の除去であり、
-- 行そのものの物理削除ではない。
--
-- なお **Supabase Auth (auth.users) の側は物理削除**する（API が service_role で
-- admin API を叩く）。users 行を残す設計のままアカウントも残すと「削除したはずの
-- 資格情報でログインできる」経路が残ってしまうため、そこだけは実体を消す。
-- 結果としてこの削除は取り消せない操作になる。
--
-- ## 設計判断
-- - **索引は張らない。** deleted_at の絞り込みが効くのは
--   `GET /v1/users/:id`（PK 引きの後段チェック）と、dish_media / dish_reviews を
--   引くときの `users` への準結合だけで、単独のスキャン条件にはならない。
--   行数に対して削除済みユーザーは極少数になる見込みで、部分索引を張っても
--   プランナが選ぶ状況が想像できない。必要になってから足す。
-- - **RLS は変更しない。** 削除処理は API（service role 相当の接続で RLS を
--   バイパスする）だけが行い、auth.users を消した時点で本人のセッション自体が
--   無効になるため、クライアント直読み（users_select_own）に deleted 考慮は要らない。
-- - **既定値は NULL。** 既存行はすべて `deleted_at IS NULL`（= 有効）として扱われる。
--   NULL 許容カラムの追加なのでテーブル書き換えは発生しない（メタデータ操作のみ）。
--
-- ## ロールバック
--   ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;
-- 削除 API のデプロイより前なら無害。デプロイ後に落とす場合は削除済みユーザーの
-- 判別手段が失われるため、API のリバートとセットで行うこと。
-- =============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

COMMENT ON COLUMN users.deleted_at IS
  'アカウント削除(匿名化)の実行時刻。NULL = 有効なユーザー。削除時は username を deleted_<id> へ置換し display_name / bio / avatar_path を NULL 化する (#1511)';

-- =============================================================================
-- 事後アサーション
--
-- `ADD COLUMN IF NOT EXISTS` は列が既にあっても成功するので、**「流した」ことと
-- 「対象スキーマに列がある」ことは別**である（適用先スキーマの取り違えは
-- 適用ログが success でも起きうる）。実際の状態を検査して落とす。
-- 再実行しても安全（冪等）。
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name   = 'users'
      AND column_name  = 'deleted_at'
  ) THEN
    RAISE EXCEPTION
      'users.deleted_at が存在しません（schema: %）。アカウント削除 API が起動時に失敗します。',
      current_schema();
  END IF;

  RAISE NOTICE '✅ users.deleted_at 追加済み（schema: %）', current_schema();
END $$;
