// api/src/internal/transcode/transcode.dto.ts
//
// DTO for transcode worker endpoint
//

import { IsString, IsUUID } from 'class-validator';

export class TranscodeDto {
  /** 入力動画の GCS URI */
  @IsString()
  inputUri!: string;

  /** 出力先の GCS URI prefix */
  @IsString()
  outputUri!: string;

  /** dish_media.id */
  @IsUUID()
  recordId!: string;
}
