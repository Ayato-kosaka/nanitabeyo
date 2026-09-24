-- #1779 restaurants.address_components を «書かなくても INSERT できる» 状態にする
--       （expand/contract の expand）
--
-- ## なぜ要るか
--
-- `address_components` は Google Place Details の住所の構造化データをそのまま保持する列で、
-- Places ToS 3.2.3 に反する（無期限の保存を許すのは place_id だけ）。落とすことは
-- オーナー確定済みだが、README「規則 3. migration は後方互換（additive）に限る」の
-- とおり **列削除はそのままでは流せない**。expand → コード移行 → contract の 3 段に割る。
--
-- これは 1 段目（expand）である。`address_components JSONB NOT NULL`（既定値なし）の
-- ままだと、**列を列挙しない INSERT が NOT NULL 違反で落ちる**。既定値を与えて
-- 「書かない」を先に可能にする。
--
-- ⚠️ `image_url` に対して 20260906T0000 で行ったのと **同じ形**である。あちらは
--    `DEFAULT ''`、こちらは `DEFAULT '[]'::jsonb`。読み手はもう 1 つも無い
--    （api / app-expo / shared のいずれにも参照ゼロ。#2035 / #2036 / #2042 で外した）。
--
-- ## この migration が変えないもの
--
-- 列は残る。既存行も書き換わらない（DEFAULT の追加はテーブル rewrite を起こさない）。
-- 値を作り続けているコードがもし残っていても、そのまま動き続ける。
--
-- ## ロールバック
--
--   ALTER TABLE restaurants ALTER COLUMN address_components DROP DEFAULT;

ALTER TABLE restaurants ALTER COLUMN address_components SET DEFAULT '[]'::jsonb;

COMMENT ON COLUMN restaurants.address_components IS
  '@deprecated #1779 で削除予定。国は country_code、州は subterritory_code、表示住所は address が正。新規に値を作らない。';
