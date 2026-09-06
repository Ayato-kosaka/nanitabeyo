-- #1779 restaurants.image_url を «書かなくても INSERT できる» 状態にする（expand/contract の expand）
--
-- ## なぜ要るか
--
-- `image_url` は Google Places の写真 URI をそのまま保持する列で、Places ToS 3.2.3 に反する。
-- 落とすことはオーナー確定済みだが、README「規則 3. migration は後方互換（additive）に限る」の
-- とおり **列削除はそのままでは流せない**。expand → コード移行 → contract の 3 段に割る。
--
-- これは 1 段目（expand）である。`image_url TEXT NOT NULL`（既定値なし）のままだと、
-- コード側が値を作るのをやめた瞬間に INSERT が NOT NULL 違反で落ちる。
-- 既定値を与えて **「書かない」を先に可能にする**。
--
-- ## この migration が変えないもの
--
-- 列は残る。既存行も書き換わらない（DEFAULT の追加はテーブル rewrite を起こさない）。
-- 値を作り続けている今のコードは、そのまま動き続ける。
--
-- ## ロールバック
--
--   ALTER TABLE restaurants ALTER COLUMN image_url DROP DEFAULT;

ALTER TABLE restaurants ALTER COLUMN image_url SET DEFAULT '';

COMMENT ON COLUMN restaurants.image_url IS
  '@deprecated #1779 で削除予定。店の画像は image_path 由来の imageUrls から取る。新規に値を作らない。';
