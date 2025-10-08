// api/src/internal/resize-image/resize-image.dto.ts
//
// DTO for resize-image endpoint request validation
//

import { IsString, IsInt, IsIn, IsNotEmpty } from 'class-validator';

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
  @IsIn([256, 1024])
  size: 256 | 1024;
}
