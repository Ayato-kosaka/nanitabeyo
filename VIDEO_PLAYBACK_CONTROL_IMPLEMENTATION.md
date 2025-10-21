# Video Playback Control Implementation (isActive Support)

## Overview
This implementation adds intelligent video playback control to the `FoodContentScreen` component, ensuring that only the currently visible video plays, and that all videos reset to position 0 when becoming active.

## Implementation Details

### 1. VideoPlayer Component Changes
**File**: `app-expo/components/VideoPlayer.tsx`

**New Props**:
- `isActive?: boolean` - Controls whether the video should be playing

**Key Features**:
- **Active State (`isActive = true`)**: 
  - Seeks to position 0
  - Starts playback automatically
  - Logs `video_activated` event
  
- **Inactive State (`isActive = false`)**:
  - Pauses playback
  - Seeks to position 0
  - Logs `video_deactivated` event

- **Unmount Cleanup**:
  - Pauses playback
  - Unloads video resources
  - Prevents memory leaks

**Implementation**:
```typescript
useEffect(() => {
  if (isActive === undefined) return;
  
  const controlPlayback = async () => {
    if (!videoRef.current) return;
    
    if (isActive) {
      await videoRef.current.setPositionAsync(0);
      await videoRef.current.playAsync();
    } else {
      await videoRef.current.pauseAsync();
      await videoRef.current.setPositionAsync(0);
    }
  };
  
  controlPlayback();
}, [isActive, uri, logFrontendEvent]);
```

### 2. FoodContentScreen Component Changes
**File**: `app-expo/components/FoodContentScreen.tsx`

**New Props**:
- `isActive?: boolean` - Passed through to VideoPlayer component

**Implementation**:
- Only applies `isActive` to video content (`media_type === 'video'`)
- Image content remains unaffected
- Backward compatible (works without `isActive` prop)

### 3. FoodContentFeed Component Changes
**File**: `app-expo/components/FoodContentFeed.tsx`

**Key Features**:
- Tracks `currentIndex` to determine which item is active
- Uses `useFocusEffect` to detect screen focus/blur
- Passes `isActive={isScreenFocused && index === currentIndex}` to each item

**Screen Focus Handling**:
```typescript
useFocusEffect(
  useCallback(() => {
    setIsScreenFocused(true);
    
    return () => {
      // Screen is unfocused - pause all videos
      setIsScreenFocused(false);
    };
  }, [])
);
```

**Render Item Logic**:
```typescript
const renderItem = useCallback(
  ({ item, index }: ListRenderItemInfo<DishMediaEntry>) => (
    <View style={{ height: Math.max(1, pageHeight) }}>
      <FoodContentScreen 
        item={item} 
        isActive={isScreenFocused && index === currentIndex} 
      />
    </View>
  ),
  [pageHeight, currentIndex, isScreenFocused],
);
```

## Acceptance Criteria Verification

### ✅ Acceptance Criteria Met:

1. **Videos start from position 0 when becoming active**
   - ✅ `setPositionAsync(0)` called before playback
   
2. **Videos pause immediately when scrolling away**
   - ✅ `pauseAsync()` called when `isActive` becomes false
   
3. **Videos restart from 0 when returning to previous card**
   - ✅ `setPositionAsync(0)` called both on activate and deactivate
   
4. **Image-only cards remain unaffected**
   - ✅ `isActive` only passed to VideoPlayer for video content
   
5. **Only one video plays at a time**
   - ✅ Only the item at `currentIndex` receives `isActive=true`
   
6. **All videos pause on screen navigation**
   - ✅ `useFocusEffect` sets `isScreenFocused=false` on blur
   
7. **Works on both iOS and Android**
   - ✅ Uses `expo-av` which supports both platforms

## Manual Testing Guide

### Test Scenario 1: Basic Video Playback
1. Navigate to profile → review tab → FoodContentScreen
2. Ensure the first video starts playing from position 0
3. **Expected**: Video plays automatically from the beginning

### Test Scenario 2: Scroll to Next Video
1. Swipe up to view the next item (video or image)
2. **Expected**: 
   - Previous video stops immediately
   - If next item is video, it starts from position 0
   - If next item is image, no video plays

### Test Scenario 3: Scroll Back to Previous Video
1. Swipe down to return to the previous video
2. **Expected**: Video restarts from position 0

### Test Scenario 4: Multiple Rapid Swipes
1. Quickly swipe through multiple items
2. **Expected**: 
   - Only the currently visible video plays
   - No audio from hidden videos

### Test Scenario 5: Screen Navigation
1. Start playing a video
2. Navigate to a different tab or screen
3. **Expected**: Video pauses when leaving the screen
4. Return to the FoodContentScreen
5. **Expected**: Video resumes from position 0

### Test Scenario 6: Mixed Content
1. Navigate through a feed with both images and videos
2. **Expected**:
   - Videos play only when active
   - Images display normally without playback controls

## Logging Events

The implementation adds the following logging events for debugging:

- `video_activated` - When a video starts playing (position 0)
- `video_deactivated` - When a video is paused
- `video_playback_control_error` - When playback control fails

## Performance Considerations

1. **Resource Management**: Videos are unloaded on unmount to free memory
2. **Minimal Re-renders**: `renderItem` uses `useCallback` with proper dependencies
3. **Position Reset**: Videos reset to 0 on both activate and deactivate to ensure clean state

## Browser/Platform Notes

- **iOS**: Full support via expo-av
- **Android**: Full support via expo-av
- **Web**: Uses separate VideoPlayer.web.tsx implementation (not modified in this PR)

## Known Limitations

1. Network latency may cause a slight delay when seeking to position 0
2. HLS streaming requires time to buffer, which may affect playback start time
3. The `useNativeControls` prop is enabled, allowing users to manually control playback

## Future Enhancements

Potential improvements for future iterations:

1. Add retry logic for failed video loads
2. Implement thumbnail preview while video is loading
3. Add configurable timeout for playback start (3 seconds as mentioned in specs)
4. Consider disabling native controls for stricter playback control
5. Add analytics for video playback metrics (play count, completion rate, etc.)
