-- #1779 Google 由来の列と、設計が成立していない列を落とす（expand/contract の contract）
--
-- ⚠️ **この migration は不可逆である。** 列の中身は失われる。流す前に下の «失うもの» を読むこと。
--
-- ## 落とす列
--
-- | 列 | なぜ落とすか |
-- | --- | --- |
-- | restaurants.image_url | Google Places の写真 URI。ToS 3.2.3 で保持できない。表示は image_path 由来の imageUrls |
-- | restaurants.plus_code | Open Location Code。読み手が 1 つも無い。緯度経度から再計算できる |
-- | restaurants.address_components | Google の住所の構造化データ。ToS 3.2.3 で保持できない。国は country_code、州は subterritory_code、表示住所は address |
-- | dishes.name | «その店でのその料理の呼び名»。読み手が無い（表示は #1901 でカテゴリのローカライズ表記へ移行済み） |
-- | dishes.data_origin | 読んで分岐するコードが 1 行も無い。@@unique([restaurant_id, category_id]) でユーザーとパイプラインが同じ行を共有するため、行に単一の出所を持たせること自体が成立しない（#1645）。同じ区別は synced_at で付く（dev 実測で 1 対 1） |
--
-- ## 失うもの（dev 実測 / 2026-09-24 / run 35963398137）
--
-- | 失うもの | 行数 | 落ちた先 |
-- | --- | ---: | --- |
-- | 確認ページの住所の初期値 | 1,675（0.27%） | 空欄。ユーザーが 1 から書く |
-- | 料理の命名に使う国コード | 12 | 'en' へ落ちる |
-- | 州（言語が変わる 7 か国のみ） | 27 | その国の第 1 言語（GB→en / ES→es 等） |
-- | Google の写真 URI | 2,337 | 表示は image_path 由来（2,453 行が保有）。#1780 で «画像が無ければ店アイコン» になっている |
-- | Google 以外の image_url | 102 | 同上 |
-- | plus_code | 2,425 | 緯度経度から再計算できる |
--
-- ⚠️ **1,675 行はオープンデータでは埋まらない。** catalog 側で住所が空の 1,666 行は
--    全部 `existing_pg`（その行自身）が出所という閉じた輪だった（9_1 を流して 0 行）。
--    埋まるのは確認ページをユーザーが通ったとき（#1671 の fillMissingAddress）だけである。
--
-- ## 流す前に満たしていること（すべて main にマージ済み）
--
-- - api / app-expo / shared に読み手も書き手も無い（#2035 / #2036 / #2042）
-- - converters は列が無くても動く（#2040。キーが無いオブジェクトを渡すテストつき）
-- - 9_1 は値 UPDATE でこれらを書かない（#2041）
-- - expand が当たっている（20260906T0000 の image_url / 20260924T0000 の address_components）
--
-- ## ロールバック
--
-- 列は戻せるが **中身は戻らない**。
--
--   ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';
--   ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS plus_code JSONB;
--   ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS address_components JSONB NOT NULL DEFAULT '[]'::jsonb;
--   ALTER TABLE dishes ADD COLUMN IF NOT EXISTS name TEXT;
--   ALTER TABLE dishes ADD COLUMN IF NOT EXISTS data_origin TEXT NOT NULL DEFAULT 'user_or_google';
--
-- ⚠️ IF EXISTS を付ける。apply-migration.sh は from_file 以降を毎回全部流すので、
--    退避ブランチからの再実行でも落ちないようにするため（README 規則 5）。

ALTER TABLE restaurants DROP COLUMN IF EXISTS image_url;
ALTER TABLE restaurants DROP COLUMN IF EXISTS plus_code;
ALTER TABLE restaurants DROP COLUMN IF EXISTS address_components;

ALTER TABLE dishes DROP COLUMN IF EXISTS name;
ALTER TABLE dishes DROP COLUMN IF EXISTS data_origin;
