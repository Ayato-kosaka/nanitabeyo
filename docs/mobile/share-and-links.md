# Share Functionality with Universal Links / App Links

This document describes the implementation of the Share functionality with Universal Links (iOS) and App Links (Android) support for the nanitabeyo food app.

## Overview

The share functionality allows users to share content from the app with URLs that:

- Open in web browsers as a fallback
- Open in the app when it's installed on the device (via Universal Links/App Links)
- Support all platforms: iOS, Android, and Web

## Implementation

### 1. Core Share Functionality

**File**: `app-expo/lib/share.ts`

- `generateShareUrl(pathname)`: Generates shareable URLs based on current pathname
- `handleShare(url, title, onSuccess, onError)`: Platform-specific sharing logic
  - **Web**: Uses Web Share API if available, falls back to clipboard
  - **iOS/Android**: Uses native sharing, falls back to clipboard

### 2. Environment Variables

Add these environment variables to your deployment:

```bash
EXPO_PUBLIC_WEB_BASE_URL=https://your-domain.com
```

**Files updated**:

- `app-expo/app.config.ts`: Added environment variables to `extra` section
- `app-expo/constants/Env.ts`: Added `WEB_BASE_URL` and `LINK_HOST` constants

### 3. App Configuration

**File**: `app-expo/app.config.ts`

**Changes**:

- `scheme`: Changed from "myapp" to "nanitabeyo"
- `ios.associatedDomains`: Added for Universal Links
- `android.intentFilters`: Added for App Links

### 4. Universal Links / App Links Files

**iOS Universal Links**:

- **File**: `app-expo/public/apple-app-site-association`
- **Deployment**: Must be served at `https://your-domain.com/apple-app-site-association`
- **Content-Type**: `application/json`
- **Note**: Replace `TEAMID.com.nanitabeyo` with your actual Team ID + Bundle ID

**Android App Links**:

- **File**: `app-expo/public/.well-known/assetlinks.json`
- **Deployment**: Must be served at `https://your-domain.com/.well-known/assetlinks.json`
- **Note**: Replace the SHA256 fingerprint with your app's actual certificate fingerprint

### 5. FoodContentScreen Integration

**File**: `app-expo/components/FoodContentScreen.tsx`

**Changes**:

- Added imports for share functionality
- Added `handleSharePress()` function with comprehensive logging
- Connected Share button to the new handler
- Added pathname detection using `usePathname()`

### 6. Translations

**Files**: `app-expo/locales/en-US.json`, `app-expo/locales/ja-JP.json`

Added `FoodContentScreen.share.title` for share dialog titles.

## Setup Instructions

### 1. Environment Variables

Set these in your deployment environment:

```bash
# Example for production
EXPO_PUBLIC_WEB_BASE_URL=https://nanitabeyo.com

# Example for staging
EXPO_PUBLIC_WEB_BASE_URL=https://staging.nanitabeyo.com
```

### 2. Deploy Universal Links / App Links Files

Deploy the following files to your web server:

- `apple-app-site-association` → `https://your-domain.com/apple-app-site-association`
- `assetlinks.json` → `https://your-domain.com/.well-known/assetlinks.json`

**Important**:

- Serve `apple-app-site-association` with `Content-Type: application/json`
- No file extension for the AASA file
- Update the Team ID and SHA256 fingerprints with your actual values

### 3. Update Certificate Information

**For iOS (AASA file)**:
Replace `TEAMID` in `apple-app-site-association` with your Apple Developer Team ID.

**For Android (assetlinks.json)**:
Replace the SHA256 fingerprint with your app's certificate fingerprint:

```bash
# Get SHA256 fingerprint for debug build
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android

# Get SHA256 fingerprint for release build
keytool -list -v -keystore /path/to/your/release.keystore -alias your-alias
```

## Verification

### iOS Universal Links

1. **AASA Validator**: Use Apple's validator (search for "Apple App Site Association validator")
2. **Device Testing**:
   - Install the app on a physical device
   - Open Safari and navigate to `https://your-domain.com/en/spot/123`
   - Should show an app banner or automatically open the app

### Android App Links

1. **Google Validator**: Use [Google's Digital Asset Links validator](https://developers.google.com/digital-asset-links/tools/generator)
2. **adb Testing**:
   ```bash
   adb shell pm verify-app-links com.nanitabeyo
   ```

### Web Testing

1. **Chrome/Edge**: Should show native share dialog
2. **Firefox/Safari**: Should copy to clipboard with notification

## Troubleshooting

### Universal Links Not Working

1. **AASA file issues**:
   - Ensure it's served with `Content-Type: application/json`
   - No redirects in the URL path
   - Check Team ID and Bundle ID are correct

2. **Caching**: Apple caches AASA files aggressively
   - Wait several hours after deployment
   - Or deploy to a new path and update the domain

### App Links Not Working

1. **Digital Asset Links issues**:
   - Verify SHA256 fingerprint is correct
   - Check package name matches exactly
   - Ensure assetlinks.json is properly formatted

2. **Intent Filter issues**:
   - Verify the host matches your domain exactly
   - Check autoVerify is set to true

### Share Functionality Issues

1. **URL generation**:
   - Check environment variables are set correctly
   - Verify pathname is being captured correctly

2. **Platform-specific**:
   - iOS/Android: Ensure expo-sharing is properly installed
   - Web: Check browser support for Web Share API

## Supported URL Patterns

The current implementation supports these URL patterns:

- `/[locale]/spot/[id]` - Individual dish/spot pages
- `/[locale]/restaurant/[id]` - Restaurant pages
- `/[locale]/profile/[id]` - User profile pages
- `/[locale]/topic/[id]` - Topic pages
- `/` - Root page

Add more patterns to the AASA and assetlinks.json files as needed.
