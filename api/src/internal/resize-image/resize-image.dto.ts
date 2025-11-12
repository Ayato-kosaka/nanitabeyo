// api/src/internal/resize-image/resize-image.dto.ts
//
// DTO for resize-image endpoint request validation
//

import { Type } from 'class-transformer';
import { IsString, IsInt, IsIn, IsNotEmpty, IsOptional } from 'class-validator';

/**
 * DTO for POST /internal/resize-image request
 */
export class ResizeImageDto {
  /** Database table name */
  @IsString()
  @IsNotEmpty()
  table: string;

  /** Database column name */
  @IsString()
  @IsNotEmpty()
  column: string;

  /** Record ID (UUID) */
  @IsString()
  @IsNotEmpty()
  recordId: string;

  /** Target size in pixels */
  @IsInt()
  @IsIn([64, 256, 512, 1024])
  size: 64 | 256 | 512 | 1024;

  /** Optional aspect ratio (width / height), e.g. 9/16 = 0.5625 */
  @IsOptional()
  @Type(() => Number)
  aspectRatio?: number;

  /** Original image path override */
  @IsString()
  @IsNotEmpty()
  originalPath!: string;
}
