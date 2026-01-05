# Bitmap Marker Implementation - Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Map Component (DishMediaMap)                      │
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │           MarkerBitmapRendererProvider (NEW)                   │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  Context: { requestBitmap, getState, subscribe }        │  │  │
│  │  │  State: Map<string, GenerationState>                    │  │  │
│  │  │  Queue: GenerationRequest[] (priority sorted)           │  │  │
│  │  │  Concurrent Limit: 2 generations                        │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │                                                                 │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  Offscreen View (position: absolute, left: -9999)       │  │  │
│  │  │  (OUTSIDE MapView - at screen root)                     │  │  │
│  │  │                                                           │  │  │
│  │  │  ┌──────────────────────────────────────────┐           │  │  │
│  │  │  │  View (collapsable={false})              │           │  │  │
│  │  │  │  ref={renderViewRef}                     │           │  │  │
│  │  │  │                                           │           │  │  │
│  │  │  │  ┌────────────────────────────────────┐ │           │  │  │
│  │  │  │  │  BubblePinBitmap                   │ │           │  │  │
│  │  │  │  │  (current request only)            │ │           │  │  │
│  │  │  │  └────────────────────────────────────┘ │           │  │  │
│  │  │  └──────────────────────────────────────────┘           │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │                                                                 │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │                 Map Children                              │  │  │
│  │  │                                                           │  │  │
│  │  │  ┌───────────────────────────────────────────────────┐  │  │  │
│  │  │  │         AvatarBubbleMarkerBitmap #1               │  │  │  │
│  │  │  │  - Subscribe to Renderer                          │  │  │  │
│  │  │  │  - Request inactive (priority: low)               │  │  │  │
│  │  │  │  - Request active on-demand (priority: high)      │  │  │  │
│  │  │  │                                                     │  │  │  │
│  │  │  │  Renders: <Marker icon={{uri: iconUri}} />        │  │  │  │
│  │  │  └───────────────────────────────────────────────────┘  │  │  │
│  │  │                                                           │  │  │
│  │  │  ┌───────────────────────────────────────────────────┐  │  │  │
│  │  │  │         AvatarBubbleMarkerBitmap #2               │  │  │  │
│  │  │  │  - Subscribe to Renderer                          │  │  │  │
│  │  │  │  - Request inactive (priority: low)               │  │  │  │
│  │  │  │  - Request active on-demand (priority: high)      │  │  │  │
│  │  │  │                                                     │  │  │  │
│  │  │  │  Renders: <Marker icon={{uri: iconUri}} />        │  │  │  │
│  │  │  └───────────────────────────────────────────────────┘  │  │  │
│  │  │                                                           │  │  │
│  │  │  (No other Views mixed in MapView children)             │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│              MarkerBitmapRenderer Generation Flow (NEW)               │
│                                                                       │
│  1. Marker mounts & requests bitmap                                  │
│     requestBitmap({ uri, size, color, priority: "low" })            │
│     ↓                                                                 │
│  2. Check if already generating or ready                             │
│     if (state.isReady || state.isGenerating) return;                │
│     ↓                                                                 │
│  3. Add to priority queue                                            │
│     queueRef.current.push(request)                                   │
│     ↓                                                                 │
│  4. Sort queue by priority (high → low)                              │
│     ↓                                                                 │
│  5. Check concurrent generation limit                                │
│     if (generatingCount >= 2) return;                                │
│     ↓                                                                 │
│  6. Generate Cache Key (with color normalization)                    │
│     normalizeColor("rgb(52, 119, 248)") → "#3477F8"                 │
│     hash(uri|size|normalizedColor) → "a1b2c3d4e5f6g7h8"             │
│     ↓                                                                 │
│  7. Check Cache                                                       │
│     cacheDirectory/marker-icons/a1b2c3d4e5f6g7h8.png                │
│     ↓                           ↓                                     │
│  Cache Hit              Cache Miss                                    │
│     ↓                           ↓                                     │
│  Return URI          8. Render in offscreen View                     │
│     ↓                   setCurrentRequest(request)                   │
│  Done                   ↓                                             │
│                       9. Wait for ref stability                       │
│                          requestAnimationFrame()                      │
│                          requestAnimationFrame()                      │
│                          ↓                                            │
│                       10. Capture View (with retry)                   │
│                          captureRef(renderViewRef.current)           │
│                          retry up to 3 times with backoff            │
│                          ↓                                            │
│                       11. Save PNG to cache                           │
│                          FileSystem.moveAsync()                       │
│                          ↓                                            │
│                       12. Update state & notify subscribers          │
│                          updateState({ iconUri, isReady: true })     │
│                          ↓                                            │
│                       13. Trigger Cleanup (async)                     │
│                          cleanupCache()                               │
│                          ↓                                            │
│                       14. Process next in queue                       │
│                          generatingCount--                            │
│                          processQueue()                               │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      State Change Flow (IMPROVED)                     │
│                                                                       │
│  User Action: Carousel swipe to next restaurant                      │
│     ↓                                                                 │
│  currentIndex changes (e.g., 0 → 1)                                  │
│     ↓                                                                 │
│  Marker color prop changes:                                           │
│     - Previous marker: "rgb(52,119,248)" → "#FFF"                    │
│     - New marker: "#FFF" → "rgb(52,119,248)"                         │
│     ↓                                                                 │
│  AvatarBubbleMarkerBitmap switches state:                            │
│     - Previous: uses inactiveState (already cached)                  │
│     - New: uses activeState                                           │
│     ↓                                                                 │
│  New marker checks if active bitmap is ready:                        │
│     if (!activeState.isReady && !activeState.isGenerating) {         │
│       requestBitmap({ ..., priority: "high" }) // on-demand          │
│     }                                                                 │
│     ↓                                                                 │
│  High priority request jumps to front of queue                       │
│     ↓                                                                 │
│  Marker icon prop updates (PNG file path changes)                    │
│     ↓                                                                 │
│  Map renders with new bitmap icons                                   │
│     ↓                                                                 │
│  ✅ No re-capture, no flicker, optimized generation!                │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                 Generation Stability Improvements (iOS)               │
│                                                                       │
│  Problem: "Error: No view found with reactTag"                       │
│  ↓                                                                    │
│  Solutions Applied:                                                   │
│                                                                       │
│  1. collapsable={false}                                              │
│     → Prevents React Native from optimizing away the View           │
│                                                                       │
│  2. captureRef(viewRef.current, ...)                                 │
│     → Uses actual ref instance, not ref object                       │
│                                                                       │
│  3. requestAnimationFrame() × 2                                      │
│     → Waits for ref to be fully mounted and stable                   │
│                                                                       │
│  4. Retry with exponential backoff                                   │
│     → Retry up to 3 times with 500ms, 1000ms, 1500ms delays         │
│                                                                       │
│  5. isMountedRef check                                               │
│     → Prevents setState after unmount (screen navigation)            │
│                                                                       │
│  Result: ✅ Stable generation, no reactTag errors                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                  Performance Optimization (NEW)                       │
│                                                                       │
│  Initial Load Strategy:                                               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 5 markers mount simultaneously                                │   │
│  │ ↓                                                             │   │
│  │ Each requests INACTIVE bitmap (priority: "low")              │   │
│  │ ↓                                                             │   │
│  │ Queue: [inactive1, inactive2, inactive3, inactive4, inactive5] │   │
│  │ ↓                                                             │   │
│  │ Process 2 at a time (concurrent limit)                       │   │
│  │ ↓                                                             │   │
│  │ Generation: ~100-200ms per bitmap                            │   │
│  │ ↓                                                             │   │
│  │ Total: ~250-500ms for 5 markers (2 concurrent)               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  Active On-Demand Strategy:                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ User taps marker or carousel swipes                          │   │
│  │ ↓                                                             │   │
│  │ New active marker requests ACTIVE bitmap (priority: "high")  │   │
│  │ ↓                                                             │   │
│  │ High priority jumps to front of queue                        │   │
│  │ ↓                                                             │   │
│  │ Generation: ~100-200ms                                        │   │
│  │ ↓                                                             │   │
│  │ UI shows inactive immediately, active after generation       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  Color Normalization:                                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Input: "rgb(52, 119, 248)" or "#3477F8"                      │   │
│  │ ↓                                                             │   │
│  │ Normalize: "#3477F8" (always uppercase hex)                  │   │
│  │ ↓                                                             │   │
│  │ Cache key uses normalized color                              │   │
│  │ ↓                                                             │   │
│  │ Result: Higher cache hit rate                                │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      Cache Management (LRU)                           │
│                                                                       │
│  FileSystem.cacheDirectory/marker-icons/                             │
│  ├── a1b2c3d4.png (inactive, 5KB, 2024-01-04 10:00)                 │
│  ├── a1b2c3d4_active.png (active, 5KB, 2024-01-04 10:00)            │
│  ├── e5f6g7h8.png (inactive, 6KB, 2024-01-04 10:05)                 │
│  ├── e5f6g7h8_active.png (active, 6KB, 2024-01-04 10:05)            │
│  └── ... (up to 200 files or 20MB total)                             │
│                                                                       │
│  Cleanup Triggers:                                                    │
│  1. File count > 200 → Delete oldest files                           │
│  2. Total size > 20MB → Delete oldest files until under limit        │
│                                                                       │
│  Cleanup Strategy:                                                    │
│  - Sort by modificationTime (oldest first)                           │
│  - Use Set for O(1) lookup (performance optimization)                │
│  - Delete files asynchronously (non-blocking)                        │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    Platform Differences                               │
│                                                                       │
│  Android/iOS:                                                         │
│    ✅ Use bitmap icon approach                                       │
│    ✅ Generate PNGs with react-native-view-shot                      │
│    ✅ Cache PNGs in FileSystem.cacheDirectory                        │
│    ✅ tracksViewChanges={false}                                      │
│    ✅ Renderer 1個で全マーカー管理                                  │
│                                                                       │
│  Web:                                                                 │
│    ✅ Use traditional View Marker approach                           │
│    ✅ Skip PNG generation (not supported/needed)                     │
│    ✅ Render BubblePinBitmap as Marker children                      │
│    ✅ No caching needed                                               │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Improvements

### Before (Old Implementation)
❌ Offscreen views inside each Marker component  
❌ MapView contains mixed children (Markers + Views)  
❌ No generation control (all generated immediately)  
❌ No priority system  
❌ iOS reactTag errors  
❌ No concurrent generation limit  

### After (New Implementation)
✅ Single Renderer outside MapView  
✅ MapView contains ONLY Markers  
✅ Priority queue (high/low)  
✅ Concurrent generation limit (2)  
✅ Stable generation (collapsable, requestAnimationFrame × 2)  
✅ Retry mechanism (3 attempts, exponential backoff)  
✅ On-demand active bitmap generation  
✅ Color normalization for better cache hits  

## Performance Characteristics

- **Initial Load**: ~250-500ms for 5 markers (2 concurrent, inactive only)
- **Active Switch**: ~100-200ms (high priority, on-demand)
- **State Change**: <10ms (PNG file path swap only, no re-generation)
- **Memory**: Max 20MB cache (auto-cleanup)
- **Storage**: Max 200 files (auto-cleanup)
- **Network**: One-time image download per unique URL
