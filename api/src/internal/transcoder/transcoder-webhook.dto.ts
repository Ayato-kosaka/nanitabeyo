// api/src/internal/transcoder/transcoder-webhook.dto.ts
//
// Pub/Sub Push メッセージのバリデーション DTO
//

import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  ValidateNested,
  IsObject,
  IsOptional,
} from 'class-validator';

class PubSubMessageDto {
  @IsString()
  @IsNotEmpty()
  data: string; // Base64 encoded

  @IsString()
  @IsNotEmpty()
  messageId: string;

  @IsString()
  @IsNotEmpty()
  publishTime: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;
}

/**
 * POST /internal/transcoder/webhook リクエストボディ
 */
export class TranscoderWebhookDto {
  @ValidateNested()
  @Type(() => PubSubMessageDto)
  message: PubSubMessageDto;

  @IsString()
  @IsNotEmpty()
  subscription: string;
}
