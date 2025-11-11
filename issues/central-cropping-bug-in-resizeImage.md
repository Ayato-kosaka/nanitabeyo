### Title: Central Cropping Bug in resizeImage Function

### Description:
The `resizeImage` function fails to correctly crop images to the center vertically and horizontally. This issue is likely due to `sharp` library options for central cropping being misconfigured or missing.

### Steps to Reproduce:
1. Upload an image with dimensions differing significantly in width and height.
2. Call the `resizeImage` function with the desired dimensions set for square or inverted aspect ratios.
3. Observe that the image output is not centrally cropped.

### Expected Behavior:
The resized image should retain its central content after resizing and cropping.

### Solution Proposal:
Modify the `resize` call in `sharp` to include options:
```typescript
sharp(imageBuffer).resize(targetWidth, targetHeight, { fit: 'cover', position: 'center' })
```
Ensure proper testing with various image aspect ratios to validate the fix.