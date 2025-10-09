# Video Upload Architecture - Quick Reference

## What Was Implemented

This PR implements the MVP video upload and transcoding architecture as specified in issue 【課題】MVP の動画保存アーキテクチャ.

## Key Changes

### 1. DTO Enhancement
- **File**: `shared/api/v1/dto/dish-media/create-dish-media.dto.ts`
- Added optional `thumbnailPath` field
- Exported `MediaType` enum (VIDEO/IMAGE)

### 2. Video Transcoding Service
- **Directory**: `api/src/core/transcoder/`
- HLS transcoding with 3 quality levels (1080p, 720p, 480p)
- Google Cloud Video Transcoder API integration
- Output: `gs://<bucket>/transcoded/dish_media/media_path/<recordId>/master.m3u8`

### 3. Cloud Tasks Integration
- **File**: `api/src/core/cloud-tasks/cloud-tasks.service.ts`
- New method: `enqueueTranscodeJob()`
- Queue: `transcode-queue`

### 4. Worker Endpoint
- **Directory**: `api/src/internal/transcode/`
- Endpoint: `POST /internal/transcode`
- Protected by OIDC guard for Cloud Tasks

### 5. Business Logic Update
- **File**: `api/src/v1/dish-media/dish-media.service.ts`
- Video: Requires thumbnailPath, enqueues transcoding
- Image: thumbnailPath defaults to mediaPath

## Usage Example

### Frontend - Video Upload
```typescript
// 1. Upload video
const videoPath = await uploadFile(videoFile, `${dishId}-media`);

// 2. Upload thumbnail
const thumbnailPath = await uploadFile(thumbnailFile, `${dishId}-thumbnail`);

// 3. Create dish media
await createDishMedia({
  dishId,
  mediaType: 'VIDEO',
  mediaPath: videoPath,
  thumbnailPath: thumbnailPath
});
// Backend automatically enqueues transcoding job
```

### Frontend - Image Upload
```typescript
// 1. Upload image
const imagePath = await uploadFile(imageFile, `${dishId}-media`);

// 2. Create dish media
await createDishMedia({
  dishId,
  mediaType: 'IMAGE',
  mediaPath: imagePath
  // thumbnailPath is optional and defaults to mediaPath
});
```

## Infrastructure Setup

### Create Cloud Tasks Queue
```bash
gcloud tasks queues create transcode-queue \
  --location=us-central1 \
  --max-attempts=3 \
  --max-concurrent-dispatches=5
```

### Enable APIs
```bash
gcloud services enable videotranscoder.googleapis.com
gcloud services enable cloudtasks.googleapis.com
```

## Testing

### Build & Typecheck (Passing ✅)
```bash
pnpm build      # All packages compile successfully
pnpm typecheck  # No type errors
pnpm format     # Code formatted
```

### Manual Testing
1. Start API server: `cd api && pnpm dev`
2. Test image upload flow (should work immediately)
3. Test video upload flow (requires GCS and Transcoder API access)

## Architecture Diagrams

### Video Upload Flow
```
┌─────────┐                  ┌─────────┐                  ┌──────────┐
│   UI    │                  │ Backend │                  │   GCS    │
└────┬────┘                  └────┬────┘                  └────┬─────┘
     │                            │                            │
     │ 1. Get signed URL (video)  │                            │
     ├───────────────────────────>│                            │
     │ 2. Return signed URL        │                            │
     │<───────────────────────────┤                            │
     │ 3. Upload video binary      │                            │
     ├─────────────────────────────────────────────────────────>│
     │                            │                            │
     │ 4. Get signed URL (thumb)  │                            │
     ├───────────────────────────>│                            │
     │ 5. Return signed URL        │                            │
     │<───────────────────────────┤                            │
     │ 6. Upload thumbnail binary  │                            │
     ├─────────────────────────────────────────────────────────>│
     │                            │                            │
     │ 7. POST /v1/dish-media     │                            │
     ├───────────────────────────>│                            │
     │                            │ 8. Create DB record        │
     │                            ├────┐                       │
     │                            │    │                       │
     │                            │<───┘                       │
     │                            │ 9. Enqueue transcode job   │
     │                            ├────────────────┐           │
     │                            │   Cloud Tasks  │           │
     │                            │<───────────────┘           │
     │<───────────────────────────┤                            │
     │                            │                            │
     
     Later (async):
     
     ┌─────────────┐              ┌────────────┐
     │ Cloud Tasks │              │ Transcoder │
     └──────┬──────┘              └─────┬──────┘
            │                           │
            │ POST /internal/transcode  │
            ├──────────────>│           │
            │               │ Create    │
            │               │ HLS Job   │
            │               ├──────────>│
            │               │           │ (Generates HLS files)
            │               │           ├────────────────────>│
```

### Image Upload Flow
```
┌─────────┐                  ┌─────────┐                  ┌──────────┐
│   UI    │                  │ Backend │                  │   GCS    │
└────┬────┘                  └────┬────┘                  └────┬─────┘
     │                            │                            │
     │ 1. Get signed URL (image)  │                            │
     ├───────────────────────────>│                            │
     │ 2. Return signed URL        │                            │
     │<───────────────────────────┤                            │
     │ 3. Upload image binary      │                            │
     ├─────────────────────────────────────────────────────────>│
     │                            │                            │
     │ 4. POST /v1/dish-media     │                            │
     ├───────────────────────────>│                            │
     │                            │ 5. Create DB record        │
     │                            │    (thumbnail=media)       │
     │                            ├────┐                       │
     │                            │    │                       │
     │                            │<───┘                       │
     │ 6. Success response        │                            │
     │<───────────────────────────┤                            │
```

## Files Changed

### New Files
- `api/src/core/transcoder/transcoder.service.ts` - Transcoder API client
- `api/src/core/transcoder/transcoder.module.ts` - Module definition
- `api/src/internal/transcode/transcode.controller.ts` - Worker endpoint
- `api/src/internal/transcode/transcode.service.ts` - Worker logic
- `api/src/internal/transcode/transcode.module.ts` - Module definition
- `api/src/internal/transcode/transcode.dto.ts` - DTO for worker
- `api/src/internal/transcode/transcode-job.interface.ts` - Job payload interface
- `IMPLEMENTATION_VIDEO_ARCHITECTURE.md` - Detailed documentation

### Modified Files
- `shared/api/v1/dto/dish-media/create-dish-media.dto.ts` - Added thumbnailPath
- `shared/api/v1/dto/index.ts` - Export MediaType enum
- `api/src/v1/dish-media/dish-media.service.ts` - Video/image logic
- `api/src/v1/dish-media/dish-media.module.ts` - Added dependencies
- `api/src/core/cloud-tasks/cloud-tasks.service.ts` - Added transcode queue
- `api/src/core/core.module.ts` - Added TranscoderModule
- `api/src/internal/internal.module.ts` - Added TranscodeModule
- `api/package.json` - Added @google-cloud/video-transcoder

## Next Steps

1. **Deploy**: Push to production and create Cloud Tasks queue
2. **Monitor**: Set up logging/alerting for transcode jobs
3. **Optimize**: Consider Pub/Sub for status updates
4. **Enhance**: Add retry logic and error notifications

## Questions?

See `IMPLEMENTATION_VIDEO_ARCHITECTURE.md` for full documentation including:
- Detailed API specifications
- Environment configuration
- Testing strategies
- Future enhancements
