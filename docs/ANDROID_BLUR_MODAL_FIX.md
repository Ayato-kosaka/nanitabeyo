# Android BlurModal Transparency Fix

## Issue

On Android devices, the feedback modal (ご意見送信画面) was appearing too transparent ("スケスケ"), allowing the profile screen behind it to show through. This affected user experience as the background content was distracting and made the modal content harder to read.

## Root Cause

The `BlurView` component from `expo-blur` behaves differently on Android compared to iOS/web:
- **iOS**: The `intensity` parameter controls actual blur effect
- **Android**: The `intensity` parameter controls fade color transparency (0-100)

Even with maximum intensity (100), the Android implementation didn't provide sufficient background obscuring.

## Solution

Added a platform-specific dark overlay for Android devices in the `useBlurModal` hook:

```tsx
{/* Android-specific dark overlay for better background obscuring */}
{Platform.OS === "android" && (
  <View
    testID="android-overlay"
    style={[
      StyleSheet.absoluteFill,
      { backgroundColor: `rgba(0, 0, 0, ${Math.max(0.3, (intensity / 100) * 0.7)})` },
    ]}
  />
)}
```

### Opacity Calculation

The overlay opacity is calculated based on the `intensity` parameter:
- **Intensity 0**: 30% opacity (minimum viable coverage)
- **Intensity 50**: 35% opacity 
- **Intensity 100**: 70% opacity (current usage across the app)

This ensures:
1. Sufficient background obscuring even at low intensities
2. Consistency with the intensity parameter
3. Better visual hierarchy and readability

## Files Modified

- `app-expo/hooks/useBlurModal.tsx`: Added Android-specific overlay

## Impact

- ✅ Fixes transparency issue on Android devices
- ✅ Maintains iOS/web behavior unchanged
- ✅ Scales with existing intensity parameter
- ✅ Minimal code change (surgical fix)
- ✅ No performance impact (simple View with background color)

## Testing

The fix can be verified by:
1. Running the feedback modal on Android
2. Confirming the background is properly obscured
3. Comparing with iOS behavior for consistency

The feedback modal is accessible via the profile screen's feedback button (ご意見送信).