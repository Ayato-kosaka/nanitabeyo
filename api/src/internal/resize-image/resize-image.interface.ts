// api/src/internal/resize-image/resize-image.interface.ts
//
// Interfaces for resize-image service
//

/**
 * Parameters for resizing an image
 */
export interface ResizeImageParams {
  /** Database table name */
  table: string;
  /** Database column name */
  column: string;
  /** Record ID (UUID) */
  recordId: string;
  /** Target size in pixels (64=sm, 256=md, 512=lg, 1024=xl) */
  size: 64 | 256 | 512 | 1024;
}

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
