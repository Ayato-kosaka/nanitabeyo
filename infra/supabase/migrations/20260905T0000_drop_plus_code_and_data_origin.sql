-- ==============================================================================
-- 20260905T0000_drop_plus_code_and_data_origin.sql
-- #1779 / #843
-- ==============================================================================
-- 【目的】
-- 誰も読んでいない 2 列を落とす。**contract（削除）side** なので不可逆。
--
--   restaurants.plus_code   （Google 由来。ToS 3.2.3 で保持できない）
--   dishes.data_origin      （読んで分岐するコードが 1 行も無い）
--
-- 【なぜ additive の原則（規則 3）の例外にできるのか】
--
-- 規則 3 は expand → コード移行 → contract の 3 段を求めている。この 2 列は
-- **② コード移行がそもそも不要**である。値を読んでいるコードが最初から無いため。
--
-- 2026-09-05 に再測定した結果（#1681 の実測は 2026-08-28 なので数え直した）:
--
--   plus_code   … 出現 12 箇所。**全て pass-through**（SELECT してエンティティへ
--                 詰め替える / 書き込む / Pick 型に列挙する）。値で分岐する箇所ゼロ。
--                 app_expo とレスポンス型（shared/api）には参照ゼロ。
--                 ⚠️ restaurant-display-address.ts の NOISE_ONLY_TYPES に現れる
--                    'plus_code' は addressComponents の types 文字列で、この列とは別物。
--   data_origin … 出現 2 箇所。どちらも定数 'user_or_google' を **書いているだけ**。
--                 読む箇所ゼロ。
--
-- 残っている記述は «introspect で生成された型を満たすため» のもので、
-- **列を落として型を再生成すれば一緒に消える**（先に消すと型エラーになる）。
--
-- 【既存データへの影響】
-- ⚠️ **不可逆。列の中身は失われる。**
--   - plus_code は Google の Plus Code（座標から算出される値）。**座標から
--     オフラインで再計算できる**ので、失っても復元手段がある。
--   - data_origin は全行が DB 既定値の 'user_or_google' か catalog 同期の値で、
--     どちらも他の列（restaurants.created_by_source / dishes.synced_at）から
--     判別できる。
--
-- 【ロールバック】
-- 列は戻せるが **中身は戻らない**。
--   ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS plus_code JSONB;
--   ALTER TABLE dishes ADD COLUMN IF NOT EXISTS data_origin TEXT NOT NULL DEFAULT 'user_or_google';
--
-- 【適用後に必ずやること】
-- introspect で型が再生成されるので、`shared/converters` と «型を満たすための
-- 記述» が落ちる。db-migrate.yml は shared のビルドが通らないと main へ push せず
-- 退避ブランチへ逃がすので、そこから拾って追従させる（#1847 と同じ流れ）。
-- ==============================================================================

BEGIN;

-- ⚠️ IF EXISTS を付ける。退避ブランチからの再実行や、部分的に適用済みの
--    状態からの再開でも落ちないようにするため。
ALTER TABLE restaurants DROP COLUMN IF EXISTS plus_code;

ALTER TABLE dishes DROP COLUMN IF EXISTS data_origin;

COMMIT;
