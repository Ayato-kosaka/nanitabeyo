# CDN Signed Cookie Implementation for Video Media

## Overview

This implementation adds CDN signed cookie authentication for video media playback. Videos are served via HLS (HTTP Live Streaming) which requires multiple file requests (master.m3u8 → segment playlists → .ts segments). CDN signed cookies provide path-based authentication that covers all files under a specific URL prefix, unlike single-file signed URLs.

## Architecture

### Components

1. **Environment Configuration** (`api/src/core/config/env.ts`)
   - `CDN_HOST`: CDN domain (e.g., `cdn.example.com`)
   - `CDN_KEY_NAME`: Key name for signing
   - `CDN_KEY_SECRET_B64`: Base64-encoded secret key
   - `CDN_SIGNED_COOKIE_TTL_SECONDS`: Cookie TTL (default: 600 seconds / 10 minutes)

2. **Cookie Generation** (`api/src/core/storage/storage.service.ts`)
   - `generateCdnSignedCookies()`: Generates Cloud CDN signed cookies
   - Uses HMAC-SHA1 signature with Base64 URL-safe encoding
   - Cookie format: `URLPrefix=<url>&Expires=<timestamp>&KeyName=<key>&Signature=<sig>`
   - Cookie attributes: `Domain`, `Path`, `Max-Age`, `HttpOnly`, `Secure`, `SameSite=None`

3. **Media URL Generation** (`api/src/v1/dish-media/dish-media.service.ts`)
   - `fetchDishMediaEntryItems()`: Detects video media and generates CDN URLs
   - For videos: `https://{CDN_HOST}/{env}/transcoded/dish_media/media_path/{recordId}/master.m3u8`
   - For images: Uses existing GCS signed URL logic
   - Returns both data and optional CDN cookies

4. **Controller Integration**
   - `UsersController`: Sets cookies for saved/liked dish media endpoints
   - `DishMediaController`: Sets cookies for search and query endpoints
   - `RestaurantsController`: Sets cookies for restaurant dish media endpoint
   - Uses NestJS `@Res({ passthrough: true })` to set `Set-Cookie` headers

## Cookie Format

### Cookie Structure
```
Cloud-CDN-Cookie=URLPrefix=<url>:Expires=<timestamp>:KeyName=<key>:Signature=<sig>; Domain=<cdn-host>; Path=<path>; Max-Age=<ttl>; HttpOnly; Secure; SameSite=None
```

### Example
```
Cloud-CDN-Cookie=URLPrefix=https://cdn.example.com/prod/transcoded/dish_media/media_path/abc123/:Expires=1760483243:KeyName=my-key:Signature=BnNrXpMt4ul7kQciSaqt1dUOoG4=; Domain=cdn.example.com; Path=/prod/transcoded/dish_media/media_path/abc123/; Max-Age=600; HttpOnly; Secure; SameSite=None
```

### Cookie Attributes

- **Domain**: `cdn.example.com` - Scoped to CDN domain
- **Path**: `/{env}/transcoded/dish_media/media_path/{recordId}/` - Scoped to specific video directory
- **Max-Age**: `600` - Cookie expires after TTL (default 10 minutes)
- **HttpOnly**: Prevents JavaScript access for security
- **Secure**: Requires HTTPS
- **SameSite=None**: Allows cross-site requests (required for cross-origin video playback)

## URL Path Structure

### Video Files
```
https://cdn.example.com/{env}/transcoded/dish_media/media_path/{recordId}/
├── master.m3u8          # Master playlist (returned as mediaUrl)
├── 720p.m3u8            # Resolution variant playlist
├── 480p.m3u8            # Resolution variant playlist
└── segments/
    ├── 720p_00001.ts    # Video segments
    ├── 720p_00002.ts
    └── ...
```

### Cookie Scope
The cookie's `Path` attribute is set to the directory path, allowing access to:
- `master.m3u8`
- All variant playlists (e.g., `720p.m3u8`)
- All video segments under the path

## API Endpoints

### Endpoints That Set Cookies

All endpoints that return dish media with videos will set signed cookies:

1. **GET /v1/users/me/saved-dish-media**
   - Returns saved dish media
   - Sets cookies for each video in the response

2. **GET /v1/users/me/liked-dish-media**
   - Returns liked dish media
   - Sets cookies for each video in the response

3. **GET /v1/users/:id/dish-reviews**
   - Returns dish reviews with media
   - Sets cookies for each video in the response

4. **GET /v1/dish-media?ids=...**
   - Returns dish media by IDs
   - Sets cookies for each video in the response

5. **GET /v1/dish-media/search**
   - Returns search results
   - Sets cookies for each video in the response

6. **GET /v1/restaurants/:id/dish-media**
   - Returns restaurant's dish media
   - Sets cookies for each video in the response

### Response Behavior

- Multiple `Set-Cookie` headers are returned (one per video record)
- Cookies are only set when CDN configuration is present
- Falls back to GCS signed URLs if CDN is not configured
- DTO only contains `mediaUrl` (CDN URL); cookies are in headers only

## Security Considerations

### Cookie Attributes

- **HttpOnly**: Prevents XSS attacks by making cookies inaccessible to JavaScript
- **Secure**: Ensures cookies are only sent over HTTPS
- **SameSite=None**: Required for cross-origin video playback, but requires `Secure`

### TTL Strategy

- Default TTL: 10 minutes (600 seconds)
- Short TTL limits exposure window
- Client must re-fetch media list to refresh cookies
- Natural expiration eliminates need for explicit revocation

### Signature Security

- Uses HMAC-SHA1 with secret key
- Signature covers: URLPrefix + Expires + KeyName
- Base64 URL-safe encoding (+/= → -/_)
- Invalid signatures result in 403 responses from CDN

### Path Scoping

- Each cookie is scoped to specific `recordId` path
- Users can only access videos they have permissions to view
- Path-based isolation prevents cross-record access

## Configuration

### Development Environment

```bash
# .env in api/ directory
CDN_HOST=cdn.example.com
CDN_KEY_NAME=dev-signing-key
CDN_KEY_SECRET_B64=<base64-encoded-secret>
CDN_SIGNED_COOKIE_TTL_SECONDS=600
```

### Production Environment

Set via environment variables in deployment:
- Google Cloud Run secrets
- GitHub Actions workflow variables
- Configured per environment (dev/staging/prod)

## Client Integration

### Web (React/Next.js)

```typescript
// Fetch with credentials to receive cookies
const response = await fetch('/v1/users/me/saved-dish-media', {
  credentials: 'include'
});

const data = await response.json();

// Use mediaUrl directly with HLS player
data.items.forEach(item => {
  if (item.dish_media.media_type === 'video') {
    // Browser automatically sends cookies with HLS requests
    player.src = item.dish_media.mediaUrl;
  }
});
```

### Mobile (React Native with expo-av)

```typescript
// Fetch with credentials to receive cookies
const response = await fetch('/v1/users/me/saved-dish-media', {
  credentials: 'include'
});

const data = await response.json();

// Use mediaUrl directly with Video component
data.items.forEach(item => {
  if (item.dish_media.media_type === 'video') {
    // expo-av automatically sends cookies
    <Video source={{ uri: item.dish_media.mediaUrl }} />
  }
});
```

## CDN Configuration

### Cloud CDN Setup

1. Create signing key:
```bash
# Generate key
openssl rand -base64 32 > cdn-signing-key.txt

# Store key in Secret Manager
gcloud secrets create cdn-signing-key \
  --data-file=cdn-signing-key.txt
```

2. Configure Cloud CDN with signed cookies:
```bash
# Enable signed URL/cookie support
gcloud compute backend-services update BACKEND_SERVICE \
  --signed-url-cache-max-age=600s
```

3. Add key to environment:
```bash
# Set environment variables
export CDN_HOST=cdn.example.com
export CDN_KEY_NAME=primary-key
export CDN_KEY_SECRET_B64=$(cat cdn-signing-key.txt)
```

## Testing

### Manual Testing

1. Start API server with CDN configuration
2. Fetch a media endpoint (e.g., `/v1/users/me/saved-dish-media`)
3. Verify `Set-Cookie` headers in response for video items
4. Verify cookie attributes (Domain, Path, HttpOnly, Secure, SameSite)
5. Use cookie to access `mediaUrl` and verify video plays
6. Wait for TTL expiration and verify 403 response

### Cookie Verification Script

```javascript
// See /tmp/test-cdn-cookies.js for full script
const crypto = require('crypto');

function generateCdnSignedCookies(urlPrefix, recordId) {
  // Implementation from StorageService
}

// Test cookie generation
const testRecordId = '123e4567-e89b-12d3-a456-426614174000';
const testUrl = `https://cdn.example.com/prod/transcoded/dish_media/media_path/${testRecordId}/`;
const cookies = generateCdnSignedCookies(testUrl, testRecordId);
console.log(cookies);
```

## Monitoring

### Key Metrics

- Cookie generation success/failure rate
- Cookie validation failures (403s from CDN)
- TTL expiration patterns
- Cookie count per request

### Logging

All cookie operations are logged via `AppLoggerService`:
- `CdnSignedCookiesGenerated`: Successful generation
- `CdnConfigMissing`: Missing CDN configuration
- `CdnSignedCookieError`: Generation errors

### Example Log Entry

```json
{
  "event": "CdnSignedCookiesGenerated",
  "context": "generateCdnSignedCookies",
  "data": {
    "urlPrefix": "https://cdn.example.com/prod/transcoded/dish_media/media_path/abc123/",
    "recordId": "abc123",
    "expires": "2025-10-14T23:17:23.000Z",
    "cookieCount": 1
  }
}
```

## Troubleshooting

### Issue: No cookies in response

- Verify CDN environment variables are set
- Check logs for `CdnConfigMissing` warnings
- Confirm media items have `media_type=video`

### Issue: 403 responses from CDN

- Verify cookie signature is correct
- Check cookie hasn't expired (TTL)
- Verify CDN is configured with correct signing key
- Confirm CDN domain matches cookie Domain attribute

### Issue: Cookies not sent by client

- Verify `credentials: 'include'` in fetch requests
- Check cookie attributes (Secure requires HTTPS)
- Verify cookie Domain matches request domain
- Check SameSite=None is supported by client

### Issue: Multiple cookies for same recordId

- Expected behavior for pagination
- Each page fetch generates new cookies
- Old cookies expire naturally via TTL
- Consider explicit deletion if needed: `Max-Age=0`

## Future Enhancements

1. **Cookie Rotation**: Refresh cookies before expiration
2. **Batch Optimization**: Reduce cookie count via shared paths
3. **Analytics**: Track cookie usage and expiration patterns
4. **Rate Limiting**: Limit cookie generation per user/IP
5. **Monitoring Dashboard**: Visualize cookie metrics

## References

- [Cloud CDN Signed Cookies Documentation](https://cloud.google.com/cdn/docs/using-signed-cookies)
- [HTTP Cookie Specification (RFC 6265)](https://tools.ietf.org/html/rfc6265)
- [SameSite Cookie Attribute](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite)
