# Android Image Preloading 403 Fix

## Problem
Android clients were experiencing HTTP 403 errors when trying to preload topic images and dish images using `Image.prefetch`. This was happening because the database stored Wikimedia Commons redirect URLs in the format:
```
https://commons.wikimedia.org/wiki/Special:FilePath/filename.jpg
```

These URLs are meant for browser redirects, but Android's OkHttp/Fresco client triggers Wikimedia's bot protection, resulting in 403 errors.

## Solution
Modified the ETL pipeline to store actual image URLs instead of redirect URLs:
```
https://upload.wikimedia.org/wikipedia/commons/8/8b/filename.jpg
```

### Changes Made

#### 1. SPARQL Query (`scripts/generate-dish-categories/dishes_with_tags.rq`)
- **Before**: Extracted full redirect URL using `IRI(REPLACE(STR(?imageRaw), "^http:", "https:"))`
- **After**: Extract filename using `STRAFTER(STR(?imageRaw), "Special:FilePath/")`
- Changed output column from `?image_url` to `?image_title`

#### 2. URL Resolution Script (`scripts/generate-dish-categories/resolve_commons_url.py`)
New Python script that:
- Takes CSV with `image_title` column (filenames)
- Generates actual upload.wikimedia.org URLs using MD5-based directory structure
- Handles edge cases: URL encoding/decoding, empty values, Unicode characters
- Outputs CSV with `image_url` column containing resolved URLs

#### 3. ETL Pipeline (`scripts/generate-dish-categories/index.sh`)
- Updated CSV column mapping from `image` to `image_title` in Step 2
- Added Step 2.5 to run `resolve_commons_url.py`
- Database schema unchanged (still uses `image_url` column)

### How Wikimedia Commons URLs Work
Wikimedia Commons uses MD5 hashing to organize files:
1. Calculate MD5 hash of filename: `"Sushi.jpg"` → `"8bd5b7..."`
2. Use first character for directory: `8`
3. Use first two characters for subdirectory: `8b`
4. Final URL: `https://upload.wikimedia.org/wikipedia/commons/8/8b/Sushi.jpg`

### Testing
The solution handles all edge cases:
- Normal filenames: `Sushi.jpg`
- Files with spaces: `Japanese curry rice.jpg`
- URL-encoded filenames: `File%20with%20spaces.png`
- Unicode characters: `ファイル名.jpg`
- Empty/NULL values

### Benefits
- ✅ Android `Image.prefetch` works without 403 errors
- ✅ Consistent image loading across all platforms (Web, iOS, Android)
- ✅ Direct access to image files without redirects
- ✅ Better UX with faster image loading

### Impact
- Database `dish_categories.image_url` now contains actual image URLs
- No client-side changes needed
- Backward compatible (existing URLs still work, just not optimal)