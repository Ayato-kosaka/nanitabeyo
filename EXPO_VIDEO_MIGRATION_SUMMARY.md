# Expo Video Migration Summary

## Overview

Successfully migrated from `expo-av` Video component to `expo-video` VideoView component to address deprecation warnings in Expo SDK 53.

## Changes Made

### 1. Package Management

#### Added

- `expo-video@~2.2.2` - New video playback library

#### Retained

- `expo-av@~15.1.7` - Kept for Audio functionality (Audio.setAudioModeAsync)

#### Configuration

- Added `"expo-video"` plugin to `app-expo/app.config.ts`

### 2. Component Migrations

#### VideoPlayer.tsx (iOS/Android)

**Before:**

```typescript
import { Video, ResizeMode, AVPlaybackStatus } from "expo-av";

<Video
  source={{ uri }}
  resizeMode={ResizeMode.COVER}
  shouldPlay={shouldPlay}
  isLooping={isLooping}
  onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
/>
```

**After:**

```typescript
import { VideoView, useVideoPlayer, VideoContentFit } from "expo-video";

const player = useVideoPlayer(uri, (player) => {
  player.loop = isLooping;
  player.muted = false;
  player.volume = 1.0;
  if (shouldPlay) {
    player.play();
  }
});

<VideoView
  player={player}
  nativeControls
  contentFit={resizeMode}
/>
```

**Key Changes:**

- Replaced `Video` component with `VideoView`
- Introduced `useVideoPlayer` hook for player management
- Replaced `ResizeMode` enum with `VideoContentFit` type (`"cover"` | `"contain"` | `"fill"`)
- Changed from `shouldPlay` prop to imperative `player.play()` / `player.pause()` methods
- Replaced `onPlaybackStatusUpdate` callback with `player.addListener("statusChange", callback)`
- Changed `useNativeControls` to `nativeControls` prop

#### InitialMediaPreview.tsx

**Before:**

```typescript
import { Video, ResizeMode } from "expo-av";

<Video
  source={{ uri: media.uri }}
  useNativeControls
  resizeMode={ResizeMode.CONTAIN}
  isMuted={isMuted}
  shouldPlay
/>
```

**After:**

```typescript
import { VideoView, useVideoPlayer } from "expo-video";

const player = useVideoPlayer(media.uri, (player) => {
  player.loop = false;
  player.muted = isMuted;
});

<VideoView
  player={player}
  nativeControls
  contentFit="contain"
/>
```

**Key Changes:**

- Replaced `Video` component with `VideoView` and `useVideoPlayer` hook
- Player state managed through `useVideoPlayer` hook instead of component props
- Mute state controlled via `player.muted = newMuted` instead of `isMuted` prop
- Play/pause controlled via `player.play()` / `player.pause()` methods

#### VideoPlayer.web.tsx

**Before:**

```typescript
import { ResizeMode } from "expo-av";

resizeMode = ResizeMode.COVER;
```

**After:**

```typescript
type VideoContentFit = "contain" | "cover" | "fill";

resizeMode = "cover";
```

**Key Changes:**

- Removed dependency on `expo-av` ResizeMode enum
- Defined local `VideoContentFit` type matching web video's object-fit values

### 3. Audio Mode Configuration

**Retained from expo-av:**

```typescript
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from "expo-av";

await Audio.setAudioModeAsync({
	allowsRecordingIOS: false,
	staysActiveInBackground: false,
	playsInSilentModeIOS: true,
	interruptionModeIOS: InterruptionModeIOS.DoNotMix,
	shouldDuckAndroid: true,
	interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
	playThroughEarpieceAndroid: false,
});
```

This functionality remains in `expo-av` as it's separate from video playback.

## API Differences Summary

| expo-av Video                   | expo-video VideoView                                    |
| ------------------------------- | ------------------------------------------------------- |
| `<Video source={{ uri }} />`    | `useVideoPlayer(uri)` + `<VideoView player={player} />` |
| `shouldPlay` prop               | `player.play()` / `player.pause()` methods              |
| `isLooping` prop                | `player.loop` property                                  |
| `isMuted` prop                  | `player.muted` property                                 |
| `volume` prop                   | `player.volume` property                                |
| `resizeMode={ResizeMode.COVER}` | `contentFit="cover"`                                    |
| `useNativeControls`             | `nativeControls`                                        |
| `onPlaybackStatusUpdate`        | `player.addListener("statusChange", ...)`               |
| Component-level state           | Hook-based player management                            |

## Testing Checklist

- [x] Code compiles without errors
- [x] Build passes successfully
- [x] TypeScript types are correct
- [ ] Video thumbnail display works
- [ ] Video playback starts correctly
- [ ] Play/pause controls work
- [ ] Loop playback functions properly
- [ ] Mute/unmute toggle works
- [ ] Video loads and plays on iOS
- [ ] Video loads and plays on Android
- [ ] Video loads and plays on Web
- [ ] No deprecation warnings in logs
- [ ] Image media (non-video) still works correctly

## Benefits

1. **No Deprecation Warnings**: Resolved the `expo-av` Video deprecation warning
2. **Modern API**: Using the latest Expo video playback API
3. **Better Performance**: expo-video is optimized for modern React Native architecture
4. **Future-Proof**: Following Expo's recommended migration path
5. **Cleaner API**: Hook-based player management provides better control and lifecycle management

## References

- [Expo Video Documentation](https://docs.expo.dev/versions/latest/sdk/video/)
- [expo-av to expo-video Migration Guide](https://docs.expo.dev/versions/latest/sdk/video/#migration-from-expo-av)

## Notes

- `expo-av` is still installed and used for `Audio.setAudioModeAsync` functionality
- The Video component from `expo-av` is no longer used anywhere in the codebase
- All video playback now uses `expo-video` VideoView component
- Web implementation continues to use native `<video>` element with hls.js for non-Safari browsers
