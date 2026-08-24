# 画像リサイズ endpoint

`POST /internal/resize-image` の**外部契約と運用手順**。処理の流れはこのディレクトリのコードを読むこと。

## リクエスト

DTO の正は `resize-image.dto.ts`。

```json
{
  "table": "dish_media",
  "column": "thumbnail_path",
  "recordId": "5f482536-4aab-4deb-8ab8-f6f36259d4d9",
  "originalPath": "development/dish_media/....jpg",
  "size": 256,
  "aspectRatio": 0.5625
}
```

- `size` は `64 | 256 | 512 | 1024` のいずれか。`originalPath` は必須、`aspectRatio` は任意（既定 9:16）
- 認証は OIDC guard。本番は Cloud Tasks のサービスアカウントを要求し、localhost は bypass する

## 出力

- 形式: WebP / quality 85 / `cover` + `center`
- 保存先: `${env}/resized-image/${table}/${column}/${recordId}/${拡張子を除いた原本ファイル名}/${size}.webp`
- `Cache-Control: public, max-age=31536000, immutable`
- 配信 URL の組み立ては `buildResizedPath()`（`api/src/core/storage/storage.utils.ts`）。
  参照側は `dish_media.thumbnail_processing_status` を見て、completed のときだけリサイズ済みパスを使う

## ステータスコードの契約（#514）

Cloud Tasks は **2xx を成功、それ以外をリトライ対象**として扱う。
リトライしても成功しない失敗は 204 で終端し、無駄な Cloud Run 起動を止める。

| 失敗                                                         | HTTP | Cloud Tasks    |
| ------------------------------------------------------------ | ---- | -------------- |
| 原本が 404 / 410（`ORIGINAL_IMAGE_NOT_FOUND`）               | 204  | リトライしない |
| 再エンコードしても読めない画像（`RESIZE_PERMANENT_FAILURE`） | 204  | リトライしない |
| 原本取得のその他 4xx / 5xx / ネットワークエラー              | 500  | リトライする   |
| GCS アップロード失敗など                                     | 500  | リトライする   |
| バリデーションエラー                                         | 400  | —              |

**恒久扱いを「4xx 全般」へ広げないこと。** 署名付き URL は試行のたびに発行し直すため、
403（署名の期限切れ・クロックスキュー）、408 / 425、429 はいずれもリトライで成功しうる。
恒久扱いにすると Cloud Tasks からジョブが消え、その画像は二度とリサイズされない。
判定は `PERMANENT_DOWNLOAD_STATUSES` に集約してある。

## 失敗した分の再実行

`POST /ops/resize-image/re-enqueue`（`api/src/ops/resize-image/`）に recordId を明示指定する。
全件再実行はできない（1 リクエスト最大 100 レコード）。

### 実行前に必要な権限付与（デプロイしただけでは使えない）

この endpoint は `PermissionGuard` で `ops.image-resize.re-enqueue` を要求するが、
`permissions` / `role_permissions` の行は**マイグレーションで管理していない**。
そのためデプロイ直後は全ユーザーが `Missing permission` になる。実行前に次を流すこと。

```sql
-- 1) 権限マスタへ登録する（既にあれば何もしない）
INSERT INTO permissions (id, name, description)
VALUES (gen_random_uuid(), 'ops.image-resize.re-enqueue',
        '#514 恒久失敗としてキューから取り除いたリサイズジョブを再 enqueue する')
ON CONFLICT (name) DO NOTHING;

-- 2) 実行させたいロールへ割り当てる（<role-name> は運営用ロール名に置き換える）
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = '<role-name>' AND p.name = 'ops.image-resize.re-enqueue'
ON CONFLICT DO NOTHING;
```

**割り当て先のロールはこちらでは決めない。** `roles` の中身もリポジトリに無く、
推測で運営権限を広いロールへ付けるほうが危険なため、`<role-name>` は実行者が指定すること。

```sql
-- 付与済みか確認する
SELECT r.name AS role, p.name AS permission
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name = 'ops.image-resize.re-enqueue';
```
