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
- **Fit Mode**: `cover` with `attention` positioning
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
- HTTP 400 Bad Request (validation error)
- HTTP 500 Internal Server Error (processing error)

**Authentication:**

- Protected by OIDC guard
- Cloud Tasks service account required in production
- Localhost bypass for development

## Error Handling

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
