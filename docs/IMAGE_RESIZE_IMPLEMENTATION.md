# On-Demand Image Resize Implementation

This document describes the on-demand image resizing feature implementation for optimizing dish media loading performance.

## Overview

The on-demand image resize feature addresses the performance issue where original full-size images (several MB) were being served for thumbnails in saved/liked item lists, causing extremely slow initial rendering on mobile devices, especially over 4G connections.

## Problem Statement

- **Before**: `dish_media` thumbnails served original full-size images directly from GCS
- **Impact**: Multi-MB images caused slow loading on mobile (4G networks)
- **User Experience**: Poor UX with delayed list rendering and high data consumption

## Solution: On-Demand Resize (MVP Approach)

### Architecture

The implementation uses an on-demand generation approach with async background processing:

1. **First Request**: Returns original image URL immediately, queues resize job in background
2. **Subsequent Requests**: Returns optimized resized WebP image
3. **Idempotency**: Multiple requests for same image don't trigger duplicate processing

### Key Components

#### 1. Resize Endpoint (`/internal/resize-image`)

New internal endpoint for processing resize requests:

- **Controller**: `api/src/internal/resize-image/resize-image.controller.ts`
- **Service**: `api/src/internal/resize-image/resize-image.service.ts`
- **Protected**: OIDC guard (Cloud Tasks authentication)
- **Request Body**:
  ```json
  {
  	"table": "dish_media",
  	"column": "thumbnail_path",
  	"recordId": "uuid",
  	"size": 256
  }
  ```

#### 2. Storage Service Extensions

Added new methods to `StorageService`:

- **`getOrQueueResizedSignedUrl()`**: Main method for getting optimized image URLs
  - Checks if resized image exists in GCS
  - Returns resized URL if available
  - Queues async resize and returns original URL if not ready
  - Graceful error handling with fallback to original

- **`fileExists()`**: Helper to check file existence in GCS

- **`queueResizeJob()`**: Fire-and-forget async resize request
  - Short timeout (2s localhost, 5s production)
  - Non-blocking, doesn't affect API response time

#### 3. DishMediaService Integration

Modified `fetchDishMediaEntryItems()` to use resized images:

```typescript
// Detail view (1024px)
const mediaUrl = await this.storage.getOrQueueResizedSignedUrl(
	{ table: "dish_media", column: "media_path", recordId: rec.dish_media.id, size: 1024 },
	rec.dish_media.media_path,
);

// List view thumbnails (256px)
const thumbnailImageUrl = await this.storage.getOrQueueResizedSignedUrl(
	{ table: "dish_media", column: "thumbnail_path", recordId: rec.dish_media.id, size: 256 },
	rec.dish_media.thumbnail_path,
);
```

## Technical Specifications

### Image Processing

- **Library**: Sharp (high-performance Node.js image processing)
- **Output Format**: WebP (iOS/Android optimized, smaller file sizes)
- **Aspect Ratio**: 9:16 (vertical portrait)
- **Crop Method**: `fit: 'cover', position: 'attention'` (smart cropping)
- **Quality**: 85 (balance between size and quality)

### Supported Sizes

| Size   | Use Case    | Dimensions         |
| ------ | ----------- | ------------------ |
| 256px  | List view   | 256 × 455 (9:16)   |
| 1024px | Detail view | 1024 × 1820 (9:16) |

### Path Naming Convention

Resized images follow a consistent naming pattern:

```
${env}/resized-image/${table}/${column}/${recordId}/${size}.webp
```

**Example**:

```
development/resized-image/dish_media/thumbnail_path/5f482536-4aab-4deb-8ab8-f6f36259d4d9/256.webp
```

### Cache Configuration

All resized images include optimal cache headers:

```
Cache-Control: public, max-age=31536000, immutable
```

- **public**: CDN cacheable
- **max-age=31536000**: Cache for 1 year
- **immutable**: Never revalidate (content-addressed by UUID)

## Performance Impact

### Expected Improvements

- **File Size Reduction**: 60-80% smaller than originals
- **Loading Time**: 3-5x faster on 4G connections
- **Data Usage**: Significant reduction for mobile users
- **UX**: Much smoother list scrolling and rendering

### First vs. Subsequent Requests

| Request Type | Image Served | Processing   | Response Time            |
| ------------ | ------------ | ------------ | ------------------------ |
| First        | Original     | Queued async | Normal (unchanged)       |
| Subsequent   | Resized WebP | Already done | Normal + faster download |

## Implementation Details

### Idempotency & Race Conditions

- File existence check before processing
- `overwriteIfExists: false` in uploads
- Multiple concurrent requests are safe
- No duplicate processing

### Error Handling

Graceful degradation at every level:

1. **GCS Check Fails**: Falls back to original image
2. **Resize Job Fails**: Logs warning, serves original
3. **Queue Fails**: Logs warning, serves original
4. **Download Fails**: Returns error to resize endpoint

All errors are logged but don't break the user experience.

### Security

- OIDC guard protects internal endpoint
- Only `dish_media` table supported (validated)
- Only `media_path` and `thumbnail_path` columns supported (validated)
- No user input in file paths (uses database UUIDs)
- Signed URLs expire after 24 hours

## Database Changes

**None required** - This is a pure backend optimization that:

- Works with existing `dish_media.thumbnail_path` and `media_path` columns
- Stores resized images in GCS (not database)
- Transparent to existing API contracts

## Testing

### Manual Testing Steps

1. Start API server:

   ```bash
   cd api && pnpm dev
   ```

2. Request dish media (first time):

   ```bash
   curl http://localhost:3000/v1/dish-media?ids=<dish-media-id>
   ```

   - Returns original image URLs
   - Resize jobs queued in background

3. Wait 2-5 seconds for resize completion

4. Request again:

   ```bash
   curl http://localhost:3000/v1/dish-media?ids=<dish-media-id>
   ```

   - Returns resized WebP URLs

5. Verify in GCS:
   - Check `development/resized-image/` path
   - Confirm WebP files with correct naming

## Monitoring & Observability

### Key Log Events

| Event                      | Level | Description                       |
| -------------------------- | ----- | --------------------------------- |
| `ResizeImageStarted`       | DEBUG | Resize job initiated              |
| `ResizeImageCompleted`     | LOG   | Resize successful                 |
| `ResizeImageAlreadyExists` | DEBUG | Idempotency hit                   |
| `ResizedImageExists`       | DEBUG | Serving existing resized image    |
| `ResizedImageNotFound`     | DEBUG | Queueing new resize job           |
| `ResizeQueueError`         | WARN  | Async queue failed (non-critical) |
| `ResizeImageError`         | ERROR | Critical resize failure           |

## Future Enhancements (Post-MVP)

### 1. Cloud Functions Trigger

- Automatic resize on `dish_media` creation
- Eliminates first-request delay
- Pregenerate all required sizes
- Fully automated workflow

### 2. Additional Sizes

- **384px**: Medium size for high-DPI devices
- **512px**: Alternative detail view
- Device DPI-aware size selection

### 3. CDN Integration

- Media CDN with signed URLs
- Global edge caching
- Automatic format selection (WebP/AVIF/JPEG based on client)
- Further performance improvements

### 4. Advanced Features

- Dynamic size generation based on viewport
- Art direction cropping (face detection)
- Progressive image loading (LQIP)
- Responsive image srcsets

## Migration Path

### Current Implementation (MVP)

✅ On-demand generation via internal endpoint
✅ Fire-and-forget async processing
✅ Idempotent and race-condition safe
✅ Graceful degradation

### Future State

🔲 Cloud Functions trigger on upload
🔲 Automatic pre-generation
🔲 CDN integration
🔲 Advanced optimization

**Seamless transition**: MVP implementation is compatible with future enhancements. No breaking changes required.

## Dependencies Added

- **sharp**: ^0.34.4 (image processing)

## Files Modified

### New Files

- `api/src/internal/resize-image/resize-image.controller.ts`
- `api/src/internal/resize-image/resize-image.service.ts`
- `api/src/internal/resize-image/resize-image.module.ts`
- `api/src/internal/resize-image/resize-image.dto.ts`
- `api/src/internal/resize-image/resize-image.interface.ts`
- `api/src/internal/resize-image/README.md`

### Modified Files

- `api/src/internal/internal.module.ts` (added ResizeImageModule)
- `api/src/core/storage/storage.service.ts` (added new methods)
- `api/src/core/storage/storage.types.ts` (added new interfaces)
- `api/src/v1/dish-media/dish-media.service.ts` (use resized URLs)
- `api/package.json` (added sharp dependency)

## Documentation

Detailed module documentation available at:

- [`api/src/internal/resize-image/README.md`](api/src/internal/resize-image/README.md)

## Validation

✅ TypeScript compilation passes
✅ Project build succeeds
✅ Code formatting applied
✅ No breaking changes to existing APIs
✅ Backward compatible
✅ Error handling tested

## Impact Summary

This implementation provides significant performance improvements for mobile users while maintaining backward compatibility and graceful degradation. The MVP approach allows immediate deployment with a clear path to future enhancements.

**Key Benefits**:

- ✅ Faster loading times (3-5x improvement expected)
- ✅ Reduced data usage (60-80% smaller files)
- ✅ Better mobile UX
- ✅ No breaking changes
- ✅ Future-proof architecture
