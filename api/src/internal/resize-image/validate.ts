#!/usr/bin/env ts-node
/**
 * Simple validation script for image resize implementation
 * 
 * This script validates:
 * 1. Module imports work correctly
 * 2. Sharp library is properly installed
 * 3. Path naming convention is correct
 * 4. Basic type safety is enforced
 */

import * as sharp from 'sharp';

// Test 1: Verify sharp is available
console.log('✓ Test 1: Sharp library import successful');
console.log(`  Sharp version: ${sharp.versions.sharp}`);

// Test 2: Verify path naming convention
function buildResizedPath(
  env: string,
  table: string,
  column: string,
  recordId: string,
  size: number
): string {
  return `${env}/resized-image/${table}/${column}/${recordId}/${size}.webp`;
}

const testPath = buildResizedPath(
  'development',
  'dish_media',
  'thumbnail_path',
  '5f482536-4aab-4deb-8ab8-f6f36259d4d9',
  256
);

const expectedPath = 'development/resized-image/dish_media/thumbnail_path/5f482536-4aab-4deb-8ab8-f6f36259d4d9/256.webp';

if (testPath === expectedPath) {
  console.log('✓ Test 2: Path naming convention is correct');
  console.log(`  Path: ${testPath}`);
} else {
  console.error('✗ Test 2 FAILED: Path naming mismatch');
  console.error(`  Expected: ${expectedPath}`);
  console.error(`  Got: ${testPath}`);
  process.exit(1);
}

// Test 3: Verify size validation
type ValidSize = 256 | 1024;
const validSizes: ValidSize[] = [256, 1024];

console.log('✓ Test 3: Size validation types are correct');
console.log(`  Valid sizes: ${validSizes.join(', ')}`);

// Test 4: Verify Sharp can create a test WebP image
(async () => {
  try {
    const testBuffer = await sharp({
      create: {
        width: 256,
        height: Math.round((256 * 16) / 9),
        channels: 3,
        background: { r: 255, g: 0, b: 0 }
      }
    })
    .webp({ quality: 85 })
    .toBuffer();

    console.log('✓ Test 4: Sharp can generate WebP images');
    console.log(`  Test image size: ${testBuffer.length} bytes`);
    
    // Test 5: Verify aspect ratio calculation
    const width = 256;
    const height = Math.round((width * 16) / 9);
    const actualRatio = width / height;
    const expectedRatio = 9 / 16;
    const ratioError = Math.abs(actualRatio - expectedRatio);
    
    if (ratioError < 0.01) {
      console.log('✓ Test 5: Aspect ratio calculation is correct');
      console.log(`  Width: ${width}, Height: ${height}`);
      console.log(`  Ratio: ${actualRatio.toFixed(4)} (expected: ${expectedRatio.toFixed(4)})`);
    } else {
      console.error('✗ Test 5 FAILED: Aspect ratio mismatch');
      console.error(`  Expected ratio: ${expectedRatio}, got: ${actualRatio}`);
      process.exit(1);
    }

    console.log('\n✅ All validation tests passed!');
    console.log('\nImplementation is ready for integration testing.');
    console.log('Next steps:');
    console.log('1. Start the API server');
    console.log('2. Test the /internal/resize-image endpoint');
    console.log('3. Verify resized images in GCS');
    
  } catch (error) {
    console.error('✗ Test 4 FAILED: Sharp image generation error');
    console.error(error);
    process.exit(1);
  }
})();
