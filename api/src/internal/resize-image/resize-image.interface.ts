// api/src/internal/resize-image/resize-image.interface.ts
//
// Interfaces for resize-image service
//

/**
 * Result of resize operation
 */
export interface ResizeImageResult {
  /** Path to the resized image in GCS */
  path: string;
  /** Signed URL to access the resized image */
  signedUrl: string;
  /** Whether the image was newly created or already existed */
  alreadyExisted: boolean;
}
