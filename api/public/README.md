# API Public Static Files

This directory contains static files served by the API server for Universal Links and App Links.

## Files

### Apple App Site Association (AASA)

- `apple-app-site-association`
- `.well-known/apple-app-site-association`

**Purpose**: Enables iOS Universal Links  
**URL**:

- `https://app.nanitabeyo.net/apple-app-site-association`
- `https://app.nanitabeyo.net/.well-known/apple-app-site-association`

**Content-Type**: `application/json`

### Android App Links

- `.well-known/assetlinks.json`

**Purpose**: Enables Android App Links  
**URL**: `https://app.nanitabeyo.net/.well-known/assetlinks.json`

**Content-Type**: `application/json`

**⚠️ IMPORTANT**: Before deploying to production, replace `REPLACE_WITH_RELEASE_SHA256_FINGERPRINT` with the actual SHA256 fingerprint from your release certificate.

To get the SHA256 fingerprint:

```bash
# For EAS Build
eas credentials --platform android

# For local keystore
keytool -list -v -keystore /path/to/release.keystore -alias release-key
```

## Configuration

These files are served by `api/src/main.ts` using `app.useStaticAssets()`.

See `docs/mobile/UNIVERSAL_LINKS_IMPLEMENTATION.md` for complete setup and validation instructions.
