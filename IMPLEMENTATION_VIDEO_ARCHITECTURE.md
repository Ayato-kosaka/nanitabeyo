# MVP Video Storage Architecture - Implementation Summary

## Overview

This implementation adds video upload and transcoding capabilities to the nanitabeyo food app, following the sequence diagrams specified in the issue.

## Backend Changes

### 1. DTO Updates (`shared/api/v1/dto/dish-media/create-dish-media.dto.ts`)

- Added optional `thumbnailPath` field to `CreateDishMediaDto`
- Exported `MediaType` enum (VIDEO/IMAGE) for use across the application

### 2. Transcoder Service (`api/src/core/transcoder/`)

- New `TranscoderService` using Google Cloud Video Transcoder API
- Generates HLS output with adaptive bitrate streaming:
  - 1080p @ 8000 kbps
  - 720p @ 5000 kbps
  - 480p @ 2500 kbps
  - Audio: AAC @ 128 kbps
- Outputs to: `gs://<bucket>/transcoded/dish_media/media_path/<recordId>/master.m3u8`

### 3. Cloud Tasks Integration (`api/src/core/cloud-tasks/cloud-tasks.service.ts`)

- Added `enqueueTranscodeJob()` method
- Sends jobs to `transcode-queue` for async processing

### 4. Internal Worker Endpoint (`api/src/internal/transcode/`)

- New `/internal/transcode` endpoint protected by OIDC guard
- Receives transcode jobs from Cloud Tasks
- Delegates to TranscoderService to create Transcoder API jobs

### 5. DishMedia Service Updates (`api/src/v1/dish-media/dish-media.service.ts`)

- Updated `createDishMedia()` to handle VIDEO vs IMAGE:
  - **VIDEO**: Requires thumbnailPath, enqueues transcoding job
  - **IMAGE**: thumbnailPath defaults to mediaPath if not provided
- Logs transcode job enqueueing for monitoring

## Frontend Compatibility

### FileUploader Component (`app-expo/features/uploads/components/FileUploader.tsx`)

**No changes needed** - the component already supports the required flow:

1. Component handles single file upload with signed URL
2. Returns `objectPath` via `onUploadComplete` callback
3. Calling code can use it twice for video upload flow:
   - First call: Upload video with `baseFileName: "${dishId}-media"`
   - Second call: Upload thumbnail with `baseFileName: "${dishId}-thumbnail"`
   - Then call: `POST /v1/dish-media` with both paths

## Video Upload Flow (End-to-End)

### For Video Media:

```
1. UI → Backend: POST /v1/user-uploads/signed-url { baseFileName: "${dishId}-media", mimeType: "video/mp4" }
2. Backend → UI: { putUrl, objectPath: mediaPath }
3. UI → GCS: PUT (video binary)
4. UI → Backend: POST /v1/user-uploads/signed-url { baseFileName: "${dishId}-thumbnail", mimeType: "image/jpeg" }
5. Backend → UI: { putUrl, objectPath: thumbnailPath }
6. UI → GCS: PUT (thumbnail binary)
7. UI → Backend: POST /v1/dish-media { dishId, mediaType: "VIDEO", mediaPath, thumbnailPath }
8. Backend: Creates dish_media record
9. Backend → Cloud Tasks: Enqueue transcode job
10. Cloud Tasks → Backend: POST /internal/transcode { inputUri, outputUri, recordId }
11. Backend → Transcoder API: Create HLS transcode job
12. Transcoder API: Generates HLS files asynchronously
```

### For Image Media:

```
1. UI → Backend: POST /v1/user-uploads/signed-url { baseFileName: "${dishId}-media", mimeType: "image/jpeg" }
2. Backend → UI: { putUrl, objectPath: mediaPath }
3. UI → GCS: PUT (image binary)
4. UI → Backend: POST /v1/dish-media { dishId, mediaType: "IMAGE", mediaPath, thumbnailPath: mediaPath }
   (thumbnailPath is required, set to same value as mediaPath for images)
5. Backend: Creates dish_media record with thumbnailPath = mediaPath
```

## Environment Variables

No new environment variables required. Uses existing:

- `GCP_PROJECT`: Google Cloud project ID
- `TASKS_LOCATION`: Cloud Tasks region (e.g., us-central1)
- `GCS_BUCKET_NAME`: Storage bucket name
- `CLOUD_RUN_URL`: Backend URL for Cloud Tasks callbacks

## Cloud Tasks Queue

A new queue `transcode-queue` should be created in Google Cloud Tasks:

```bash
gcloud tasks queues create transcode-queue \
  --location=us-central1 \
  --max-attempts=3 \
  --max-concurrent-dispatches=5
```

## Database Schema

No schema changes required. Existing `dish_media` table fields used:

- `media_path`: Original video URI or image URI
- `thumbnail_path`: Thumbnail image URI
- `media_type`: 'IMAGE' or 'VIDEO'

Future enhancement could add:

- `transcode_status`: PENDING, PROCESSING, READY, FAILED
- `hls_master_path`: Path to master.m3u8 file

## Testing

### Manual Testing Steps:

1. **Setup**:

   ```bash
   cd api
   # Create .env with all required variables
   pnpm dev
   ```

2. **Test Image Upload**:
   - Upload image via FileUploader
   - Call POST /v1/dish-media with mediaType: IMAGE
   - Verify record created with thumbnailPath = mediaPath

3. **Test Video Upload** (requires GCS and Transcoder API access):
   - Upload video via FileUploader
   - Upload thumbnail via FileUploader
   - Call POST /v1/dish-media with mediaType: VIDEO and both paths
   - Verify record created
   - Check Cloud Tasks console for transcode job
   - Check Transcoder API console for job execution

### Build Validation:

```bash
pnpm build      # ✅ Passes
pnpm typecheck  # ✅ Passes
```

## Future Enhancements

1. **Status Updates via Pub/Sub**:
   - Subscribe to Transcoder job completion notifications
   - Update dish_media.transcode_status when job completes

2. **CDN Integration**:
   - Add signed URL generation for HLS playback
   - Integrate with Cloud CDN for better performance

3. **Progress Tracking**:
   - Real-time transcode progress updates to UI
   - Webhook endpoint for Transcoder notifications

4. **Error Handling**:
   - Retry logic for failed transcode jobs
   - User notifications on transcode failure

## References

- Issue: 【課題】MVP の動画保存アーキテクチャ
- Google Cloud Video Transcoder API: https://cloud.google.com/transcoder/docs
- HLS Specification: https://datatracker.ietf.org/doc/html/rfc8216
