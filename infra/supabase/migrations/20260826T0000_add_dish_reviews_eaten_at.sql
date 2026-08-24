-- =============================================================================
-- dish_reviews に eaten_at（食べた日）を追加する（① expand: NULLABLE 列 + 索引）
-- =============================================================================
--
-- Issue: https://github.com/Ayato-kosaka/nanitabeyo/issues/1551
-- 親: https://github.com/Ayato-kosaka/nanitabeyo/issues/1375
--
-- 【なぜ必要か】
-- my-dishes の並び順・カレンダーの日バケット・期間絞り込みの基準（occurredAt）は、
-- 「食べた」行では dish_reviews.created_at ＝ **記録した日時**であって食べた日ではない。
-- 過去に食べたものを後からまとめて記録すると、カレンダー上は「記録した日」に固まって並ぶ。
--
-- 【オーナー確定事項】
-- - eaten_at は最終的に NOT NULL にする
-- - 値は日付だけ（時刻は持たない）。同じ日の中の並びは第二ソートキー created_at で決める
-- - 未来日は不可
--
-- 【型が date である理由】
-- 「時刻を 00:00 にする」を timestamptz でやると、どのタイムゾーンの 00:00 かを
-- 決めなければならない。UTC の 00:00 は UTC-5 の端末では前日として表示され、
-- JST の 00:00 に固定すると海外で入力した日と表示される日がずれる。
-- date なら日付そのものを持つので、この選択自体が発生しない。
--
-- 【この migration は ① だけ】(README 規則 3: additive のみ)
--   ① expand   … NULLABLE で追加 + 索引          ← このファイル
--   ② 移行     … 書き込み側が値を入れ、読み側は COALESCE。既存行を backfill（別 PR）
--   ③ contract … SET NOT NULL                    （別 Issue・別承認）
--
-- 【既存データへの影響】
-- - NULLABLE 列の追加のみ。既存行は書き換わらない（テーブル rewrite なし）
-- - CHECK は NOT VALID → VALIDATE の 2 段なので、検証中も書き込みを止めない
-- - 索引は CONCURRENTLY なので書き込みを止めない。dish_reviews は約 964MB あるため
--   作成には時間がかかる
--
-- 【ロールバック】
--   DROP INDEX CONCURRENTLY IF EXISTS idx_dish_reviews_user_eaten_at;
--   ALTER TABLE dish_reviews DROP CONSTRAINT IF EXISTS ck_dish_reviews_eaten_at_not_future;
--   ALTER TABLE dish_reviews DROP COLUMN IF EXISTS eaten_at;
--
-- ⚠️ CREATE INDEX CONCURRENTLY はトランザクション内では実行できない。
-- scripts/apply-migration.sh は --single-transaction を付けずに \i で流す（＝ autocommit）
-- ため、このファイルは BEGIN/COMMIT で囲まずにそのまま通る。
-- =============================================================================

ALTER TABLE dish_reviews
  ADD COLUMN IF NOT EXISTS eaten_at DATE;

COMMENT ON COLUMN dish_reviews.eaten_at IS
  '食べた日（ユーザーが入力・編集できる）。NULL の間は created_at の日付として扱う。未来日は不可';

-- 未来日を禁止する。NOT VALID で追加してから VALIDATE することで、
-- 既存行の全走査中もテーブルへの書き込みを止めない
-- （この時点の既存行はすべて NULL なので、実際には即座に通る）。
ALTER TABLE dish_reviews
  DROP CONSTRAINT IF EXISTS ck_dish_reviews_eaten_at_not_future;
ALTER TABLE dish_reviews
  ADD CONSTRAINT ck_dish_reviews_eaten_at_not_future
  CHECK (eaten_at IS NULL OR eaten_at <= CURRENT_DATE) NOT VALID;
ALTER TABLE dish_reviews
  VALIDATE CONSTRAINT ck_dish_reviews_eaten_at_not_future;

-- 一覧・カレンダー・期間絞り込みの並び順（keyset ページング）を索引だけで完結させる。
-- 現行の occurredAt は created_at なので idx_dish_reviews_user_created_at が効いていたが、
-- eaten_at 基準に変えるとその索引では順序を保てず、964MB のユーザー全行走査になる。
--
-- ⚠️ 式索引にしているのは、②の移行期間に eaten_at が NULL の行と入っている行が
-- 混在するため。COALESCE を含めておけば移行中も移行後も同じ索引で足りる。
-- 第二キーが created_at なのは「同じ日の中は記録した順」という仕様（オーナー確認済み）。
--
-- ⚠️⚠️ `created_at::date` と書いてはいけない（初版がこれで落ちた。run 32724167046）。
--
--     ERROR: functions in index expression must be marked IMMUTABLE
--
-- timestamptz から date への暗黙のキャストは **セッションの TimeZone 設定に依存する**ため
-- STABLE 止まりで、索引式には使えない。ゾーンを明示した
-- `(created_at AT TIME ZONE 'UTC')::date` は IMMUTABLE なので通る
-- （PostgreSQL 16 で ①失敗 / ②成功 を実際に流して確認済み）。
--
-- UTC を選ぶことの意味: **②の backfill が終わるまでの間だけ**、eaten_at がまだ NULL の行の
-- 並び順が «UTC での日付» を基準にする。端末ローカルの日付と最大 1 日ずれうるが、
-- backfill 後は COALESCE が第 1 引数（実際の食べた日）を返すので影響は消える。
-- ③（SET NOT NULL）まで済んだら、この式索引は
-- `(user_id, eaten_at DESC, created_at DESC, id DESC)` の素の索引へ置き換えてよい。
--
-- ⚠️ 読み出し側のクエリは **この式と 1 文字違わず同じ**でなければ索引に乗らない。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dish_reviews_user_eaten_at
  ON dish_reviews (user_id, COALESCE(eaten_at, (created_at AT TIME ZONE 'UTC')::date) DESC, created_at DESC, id DESC);
