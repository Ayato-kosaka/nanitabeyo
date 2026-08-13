# Image Resize Module

## Overview

This module provides on-demand image resizing functionality for `dish_media` thumbnails. Images are resized to WebP format with a 9:16 aspect ratio (portrait) to optimize loading performance on mobile devices.

## Architecture

### Components

1. **ResizeImageController** (`resize-image.controller.ts`)
   - Internal endpoint: `POST /internal/resize-image`
   - Protected by OIDC guard (Cloud Tasks authentication)
   - Accepts resize requests and delegates to service

2. **ResizeImageService** (`resize-image.service.ts`)
   - Core resize logic using Sharp library
   - Handles image download, resize, and upload to GCS
   - Implements idempotency checks

3. **StorageService Extensions**
   - `getOrQueueResizedSignedUrl()`: Check for resized image, queue resize if missing
   - `fileExists()`: Check if file exists in GCS
   - `queueResizeJob()`: Async fire-and-forget resize request

## Usage

### API Integration

The `DishMediaService` automatically uses resized images:

```typescript
// In fetchDishMediaEntryItems()
const mediaUrl = await this.storage.getOrQueueResizedSignedUrl(
  {
    table: 'dish_media',
    column: 'media_path',
    recordId: rec.dish_media.id,
    size: 1024, // Detail view
  },
  rec.dish_media.media_path,
);

const thumbnailImageUrl = await this.storage.getOrQueueResizedSignedUrl(
  {
    table: 'dish_media',
    column: 'thumbnail_path',
    recordId: rec.dish_media.id,
    size: 256, // List view
  },
  rec.dish_media.thumbnail_path,
);
```

### Workflow

1. Client requests dish media via API
2. `getOrQueueResizedSignedUrl()` checks if resized image exists
3. If exists: Return signed URL for resized WebP image
4. If not exists:
   - Queue async resize job (fire-and-forget)
   - Return signed URL for original image
5. Resize job processes in background
6. Next request returns resized image

## Configuration

### Supported Sizes

- **256px**: Thumbnail size for list views
- **1024px**: Detail view size

### Image Format

- **Output**: WebP
- **Aspect Ratio**: 9:16 (portrait)
- **Fit Mode**: `cover` with `center` positioning
- **Quality**: 85

### Path Convention

Resized images are stored at:

```
${env}/resized-image/${table}/${column}/${recordId}/${size}.webp
```

Example:

```
development/resized-image/dish_media/thumbnail_path/5f482536-4aab-4deb-8ab8-f6f36259d4d9/256.webp
```

### Cache Headers

All resized images include:

```
Cache-Control: public, max-age=31536000, immutable
```

## API Endpoint

### POST /internal/resize-image

**Request Body:**

```json
{
  "table": "dish_media",
  "column": "thumbnail_path",
  "recordId": "5f482536-4aab-4deb-8ab8-f6f36259d4d9",
  "size": 256
}
```

**Response:**

- HTTP 204 No Content (success)
- HTTP 204 No Content (**permanent failure** — #514: リトライしても成功しないので終端する)
- HTTP 400 Bad Request (validation error)
- HTTP 500 Internal Server Error (**transient** processing error — Cloud Tasks がリトライする)

**Authentication:**

- Protected by OIDC guard
- Cloud Tasks service account required in production
- Localhost bypass for development

## Error Handling

### 恒久失敗 vs 一時失敗 (#514)

Cloud Tasks は **2xx を成功、それ以外をリトライ対象**として扱う。
リトライしても決して成功しない失敗は 204 で終端し、無駄な Cloud Run 起動を止める。

| 失敗                                              | 例外                                               | HTTP | Cloud Tasks    |
| ------------------------------------------------- | -------------------------------------------------- | ---- | -------------- |
| 原本が **404 / 410**                              | `PermanentImageError` / `ORIGINAL_IMAGE_NOT_FOUND` | 204  | リトライしない |
| 再エンコードしても読めない画像                    | `PermanentImageError` / `RESIZE_PERMANENT_FAILURE` | 204  | リトライしない |
| 原本取得がその他の 4xx / 5xx / ネットワークエラー | `Error`                                            | 500  | リトライする   |
| GCS アップロード失敗など                          | `Error`                                            | 500  | リトライする   |

⚠️ **恒久扱いを「4xx 全般」へ広げないこと。** 署名付き URL は試行のたびに発行し直すため、
403（署名の期限切れ・クロックスキュー）、408 / 425（一時的なタイムアウト）、429（レート制限）は
いずれもリトライで成功しうる。恒久扱いにすると Cloud Tasks からジョブが消え、
その画像は二度とリサイズされない。判定は `PERMANENT_DOWNLOAD_STATUSES` に集約してある。

失敗した分の再実行は `POST /ops/resize-image/re-enqueue`（`api/src/ops/resize-image/`）から
recordId を明示指定して行う。全件再実行はできない（1 リクエスト最大 100 レコード）。

#### 実行前に必要な権限付与（**デプロイしただけでは使えません**）

この endpoint は `PermissionGuard` で `ops.image-resize.re-enqueue` を要求する。
このリポジトリでは `permissions` / `role_permissions` の**行をマイグレーションで管理していない**
（既存の `tools.dish-categories.popular-with-media` も同様）ため、デプロイしただけでは
**全ユーザーが `Missing permission` になる**。実行前に次を流すこと。

```sql
-- 1) 権限マスタへ登録する（既にあれば何もしない）
INSERT INTO permissions (id, name, description)
VALUES (
  gen_random_uuid(),
  'ops.image-resize.re-enqueue',
  '#514 恒久失敗としてキューから取り除いたリサイズジョブを再 enqueue する'
)
ON CONFLICT (name) DO NOTHING;

-- 2) 実行させたいロールへ割り当てる（<role-name> は運営用ロール名に置き換える）
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = '<role-name>'
  AND p.name = 'ops.image-resize.re-enqueue'
ON CONFLICT DO NOTHING;
```

**割り当て先のロールはこちらでは決めない。** `roles` の中身もリポジトリに無く、
推測で運営権限を広いロールへ付けるほうが危険なため、2) の `<role-name>` は実行者が指定すること。
付与済みかどうかは次で確認できる。

```sql
SELECT r.name AS role, p.name AS permission
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name = 'ops.image-resize.re-enqueue';
```

### 壊れた JPEG への耐性 (#514)

`performResize()` は `sharp(buffer, { failOn: 'none' })` で読む。
libvips が警告レベルとして扱う破損（`Corrupt JPEG data: N extraneous bytes before marker 0xNN`、
`Invalid SOS parameters for sequential JPEG`、`premature end of JPEG image`）は
これで読み切れることを実測済み（`resize-image.corrupt-jpeg.spec.ts`）。
画像として解釈できない入力は引き続き失敗するため、恒久失敗の検知能力は落ちていない。

### Graceful Degradation

- If resize fails: Returns original image URL
- If GCS check fails: Returns original image URL
- If async queue fails: Logs warning, continues serving original

### Idempotency

- Multiple resize requests for same image are safe
- File existence check prevents duplicate processing
- `overwriteIfExists: false` in upload prevents race conditions

## Performance Characteristics

### First Request

- Returns original image immediately
- Queues resize job in background
- Timeout: 2s (localhost), 5s (production)

### Subsequent Requests

- Returns resized WebP image
- Significantly reduced file size (typically 60-80% smaller)
- Faster loading on mobile devices

### Resize Duration

- Typical: 1-3 seconds per image
- Depends on original image size
- Runs asynchronously, doesn't block API response

## Future Enhancements

### Cloud Functions Trigger (Post-MVP)

- Automatic resize on `dish_media` creation
- Eliminates first-request delay
- Pregenerate all required sizes

### Additional Sizes

- 384px: Intermediate size for high-DPI devices
- Custom sizes per use case

### CDN Integration

- Media CDN with signed URLs
- Edge caching for global performance
- Automatic format selection (WebP/JPEG/AVIF)

## Monitoring

### Key Metrics

- **ResizeImageStarted**: Resize job initiated
- **ResizeImageCompleted**: Resize successful
- **ResizeImageAlreadyExists**: Idempotency hit
- **ResizedImageExists**: Serving existing resized image
- **ResizedImageNotFound**: Queueing new resize job
- **ResizeQueueError**: Async queue failed (non-critical)
- **DownloadOriginalImagePermanentFailure**: 原本が 4xx (#514・恒久・リトライしない)
- **DownloadOriginalImageError**: 原本取得が 5xx / ネットワークエラー (一時・リトライする)
- **ResizeAndStoreImagePermanentFailure**: 恒久失敗 (リトライしない)
- **ResizeAndStoreImageError**: 一時失敗 (リトライする)
- **ResizeImagePermanentFailureAcknowledged**: 恒久失敗を 204 で終端した (#514)
- **ReEnqueueResizeImageStarted / Completed**: 運営ツールからの再 enqueue (#514)

### Log Levels

- **DEBUG**: Resize progress, file checks
- **LOG**: Successful operations
- **WARN**: Non-critical failures (queue errors)
- **ERROR**: Critical failures (resize/upload errors)

## Testing

### Manual Testing

1. **Start API server**:

   ```bash
   cd api && pnpm dev
   ```

2. **Call dish-media endpoint**:

   ```bash
   curl http://localhost:3000/v1/dish-media?ids=<dish-media-id>
   ```

3. **Check response**:
   - First call: Returns original image URL
   - Second call (after resize): Returns resized WebP URL

4. **Verify GCS**:
   - Check `development/resized-image/` path in bucket
   - Confirm WebP files exist with correct sizes

### Integration Points

- `DishMediaService.fetchDishMediaEntryItems()`
- `StorageService.getOrQueueResizedSignedUrl()`
- `POST /internal/resize-image` endpoint
- GCS bucket operations

## Dependencies

- **sharp**: Image processing library
- **@google-cloud/storage**: GCS integration
- **class-validator**: Request validation
- **NestJS**: Framework and DI

## Security Considerations

- OIDC guard protects internal endpoint
- Only supports `dish_media` table (validated)
- Only supports `media_path` and `thumbnail_path` columns (validated)
- No user input in file paths (uses UUIDs from database)
- Signed URLs expire after 24 hours by default
