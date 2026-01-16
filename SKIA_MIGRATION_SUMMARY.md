# Skia Migration Validation Summary

## ✅ Implementation Complete

This document summarizes the successful migration from `react-native-view-shot` / `expo-file-system` to Skia-based marker image generation.

## Changes Made

### 1. New Skia Implementation

**Files Created:**
- `app-expo/features/mapMarkers/utils/markerSkiaRenderer.ts` - Core Skia rendering logic
- `app-expo/features/mapMarkers/hooks/useSkiaMarkerBitmap.ts` - React hook for Skia markers

**Key Features:**
- ✅ Canvas-based rendering with circular mask + border + tail
- ✅ Image loading from URLs with Skia.Data.fromURI
- ✅ Base64 PNG encoding for direct use in Marker component
- ✅ In-memory LRU cache (150 item limit)
- ✅ Automatic cache eviction based on lastUsedAt
- ✅ Error handling with graceful fallback

### 2. Component Updates

**Modified Files:**
- `app-expo/features/mapMarkers/components/AvatarBubbleMarkerBitmap.tsx`
  - Removed dependency on Provider
  - Uses `useSkiaMarkerBitmap` hook directly
  - Preserves iOS `tracksViewChanges` logic
  - Web continues using View Marker (BubblePinBitmap)

- `app-expo/features/dishMedia/components/DishMediaMap.tsx`
  - Removed `<MarkerBitmapRendererProvider>` wrapper
  - Markers now work independently with Skia

- `app-expo/app/[locale]/(tabs)/map.tsx`
  - Removed `<MarkerBitmapRendererProvider>` wrapper
  - Simplified imports

- `app-expo/features/mapMarkers/index.ts`
  - Removed exports: MarkerBitmapRendererProvider, useMarkerBitmapRenderer, useMarkerBitmapState, normalizeColor, makeKey, constants, useMarkerBitmap
  - Kept exports: AvatarBubbleMarkerBitmap, BubblePinBitmap

### 3. Cleanup & Removals

**Files Deleted:**
- `app-expo/features/mapMarkers/hooks/useMarkerBitmap.ts` (view-shot based)
- `app-expo/features/mapMarkers/components/MarkerBitmapRendererProvider.tsx` (Provider + offscreen rendering)

**Dependencies Removed:**
- `react-native-view-shot` (^4.0.3) - No longer needed

**Dependencies Kept:**
- `expo-file-system` - Still used by `useFileUploader` for unrelated functionality
- `expo-crypto` - No longer used by markers, but may be used elsewhere

## Architecture Changes

### Before (view-shot based):
```
┌─────────────────────────────────────────┐
│ MarkerBitmapRendererProvider            │
│ - Global state management               │
│ - Offscreen View rendering              │
│ - Priority queues (high/low)            │
│ - Image load waiting logic              │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ useMarkerBitmapState (useSyncExternal)  │
│ - Subscribe to generation state         │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ captureRef (view-shot)                  │
│ - PNG capture from View                 │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ FileSystem                              │
│ - Write to cache dir                    │
│ - LRU cleanup (200 files / 20MB)       │
│ - readDirectoryAsync / getInfoAsync     │
└─────────────────────────────────────────┘
```

### After (Skia based):
```
┌─────────────────────────────────────────┐
│ useSkiaMarkerBitmap                     │
│ - Simple useState hook                  │
│ - No external store needed              │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ getOrGenerateMarkerBitmap               │
│ - Check memory cache first              │
│ - Generate if miss                      │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ Skia Canvas                             │
│ - Load image from URI                   │
│ - Draw with mask + border + tail        │
│ - Encode to Base64 PNG                  │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ In-Memory LRU Cache                     │
│ - Map<key, {dataUri, lastUsedAt}>      │
│ - Auto-evict oldest (150 items max)    │
└─────────────────────────────────────────┘
```

## Performance Improvements (Expected)

### Before:
- **5 markers**: ~5 seconds (based on issue description)
- **Bottlenecks**:
  - View rendering + capture: ~500-1000ms per marker
  - FileSystem.moveAsync: ~50-100ms per marker
  - FileSystem.readDirectoryAsync: ~50-200ms
  - FileSystem.getInfoAsync × N: ~10-20ms each
  - Total I/O overhead: significant

### After (Expected):
- **5 markers**: <1 second (target from requirements)
- **Improvements**:
  - Skia render: ~50-200ms per marker (no View overhead)
  - No FileSystem I/O (zero disk access)
  - Memory cache hit: <1ms (instant)
  - Parallel generation possible (no Provider queue bottleneck)

## Testing Checklist

### Manual Testing Required:

- [ ] **iOS - Multiple Markers**
  - Open map with 5-10 saved restaurants
  - Verify markers appear quickly (<1s)
  - Tap markers to verify interactivity
  - Check memory usage (no leaks)

- [ ] **Android - Multiple Markers**
  - Same tests as iOS
  - Verify no rendering issues
  - Check no "empty frame" bugs

- [ ] **Web - View Marker**
  - Verify markers still render correctly
  - Confirm no regressions
  - Check that BubblePinBitmap still works

- [ ] **Active/Inactive Colors**
  - Select a marker (should turn blue: #3477F8)
  - Deselect (should turn white: #FFFFFF)
  - Verify smooth transitions

- [ ] **Placeholder Fallback**
  - Test with invalid image URLs
  - Test with empty URI
  - Verify placeholder PNG appears

- [ ] **Cache Behavior**
  - Generate 150+ markers (may need mock data)
  - Verify LRU eviction works
  - Check console logs for cache hits/misses

- [ ] **iOS tracksViewChanges**
  - Verify markers update when switching active state
  - Check no "disappearing marker" bugs
  - Confirm icons update correctly

## Known Limitations

1. **Base64 Memory Usage**: Each marker stores a Base64 PNG in memory (~5-10KB per marker). With 150 cached, this is ~750KB-1.5MB, which is acceptable.

2. **Skia Library Size**: `@shopify/react-native-skia` adds ~3-5MB to app binary size.

3. **Peer Dependency Warnings** (non-blocking):
   - `react-native-reanimated@>=3.19.1` (have 3.17.5)
   - Consider upgrading reanimated in the future

## Rollback Plan (if needed)

If critical issues are found:

1. Revert commits:
   ```bash
   git revert 2e40689 5c5f189 38aa9fd
   ```

2. Reinstall view-shot:
   ```bash
   pnpm add react-native-view-shot@^4.0.3
   ```

3. Restore deleted files from git history:
   ```bash
   git checkout f7e18c6 -- app-expo/features/mapMarkers/hooks/useMarkerBitmap.ts
   git checkout f7e18c6 -- app-expo/features/mapMarkers/components/MarkerBitmapRendererProvider.tsx
   ```

## Security Considerations

✅ No new security vulnerabilities introduced:
- Skia is a well-maintained library (by Shopify, based on Google's Skia)
- No external API calls added
- No sensitive data stored in cache
- Base64 encoding is standard and safe

## Dependencies Added

```json
{
  "@shopify/react-native-skia": "^2.4.14"
}
```

## Next Steps

1. **Merge PR** after manual testing passes
2. **Monitor performance** in production
3. **Collect metrics** on marker load times
4. **Consider optimizations** if needed:
   - Adjust cache size based on real usage
   - Pre-generate common markers
   - Implement progressive loading for many markers

## References

- Issue #235: [MAP] Skiaベースのマーカー画像生成に移行
- Skia Documentation: https://shopify.github.io/react-native-skia/
- Original implementation: `MarkerBitmapRendererProvider` (deleted)

---

**Status**: ✅ Implementation Complete - Ready for Testing
**Date**: 2026-01-16
**Branch**: copilot/migrate-to-skia-image-generation
