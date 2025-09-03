-- バグ修正チケット: #272
-- 内容:
-- Google Maps Text Search 由来のレストラン取り込み処理にて、
--   - `plus_code` がレスポンスに存在しない正当なケースを「必須」と誤判定して弾いていた
--   - 結果として「Invalid place data」エラーが多発
-- 原因:
--   - DB スキーマ上で `restaurants.plus_code` を NOT NULL 制約として定義していたため
--   - ただし Google Places API v1 における `plusCode` フィールドは *任意項目* である
-- 対応:
--   - DB 定義から NOT NULL 制約を削除し、NULL を許容するように変更
--   - これにより API 仕様に沿ったデータを正しく登録できる
-- 影響範囲:
--   - 既存アプリケーションコード: `plus_code` が NULL の可能性を考慮する必要あり
--   - バリデーション処理: `plus_code` を必須としないよう調整が必要
--   - 移行後の確認: 既存データの一貫性には影響なし (NULL 可なので既存レコードはそのまま)

ALTER TABLE restaurants ALTER COLUMN plus_code DROP NOT NULL;
