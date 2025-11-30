// api/src/internal/transcoder/transcoder-webhook.controller.ts
//
// ❶ Pub/Sub Push からの認証済みリクエストのみ受け付ける内部エンドポイント
// ❷ Transcoder Job 完了通知を受信し、AudioMissing 時のリトライを実行
//

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { TranscoderWebhookDto } from './transcoder-webhook.dto';
import { TranscoderWebhookService } from './transcoder-webhook.service';
import { OIDCGuard } from '../oidc.guard';
import { AppLoggerService } from '../../core/logger/logger.service';
import { TranscoderJobPayload } from './transcoder-webhook.interface';

/**
 * 内部処理専用コントローラー
 * Pub/Sub Push からの OIDC 認証済みリクエストのみ処理
 */
@Controller('internal/transcoder')
@UseGuards(OIDCGuard)
export class TranscoderWebhookController {
  constructor(
    private readonly webhookService: TranscoderWebhookService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * POST /internal/transcoder/webhook
   *
   * Pub/Sub Push から呼び出される Transcoder Job 完了通知エンドポイント
   * - Job の状態を確認し、AudioMissing エラー時のリトライを実行
   */
  @Post('webhook')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async handleTranscoderWebhook(
    @Body() dto: TranscoderWebhookDto, // 中身は PubSubPushMessage 相当
  ): Promise<void> {
    const { message, subscription } = dto;

    this.logger.debug(
      'TranscoderWebhookRawReceived',
      'handleTranscoderWebhook',
      {
        messageId: message.messageId,
        subscription,
      },
    );

    if (!message.data) {
      this.logger.warn(
        'TranscoderWebhookMissingData',
        'handleTranscoderWebhook',
        {
          messageId: message.messageId,
        },
      );
      return;
    }

    // --- ここから data を decode & parse ---
    let payload: TranscoderJobPayload | any;
    try {
      const json = Buffer.from(message.data, 'base64').toString('utf8');
      payload = JSON.parse(json);
    } catch (error) {
      this.logger.error(
        'TranscoderWebhookInvalidPayload',
        'handleTranscoderWebhook',
        {
          messageId: message.messageId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
      return;
    }

    const job = payload.job ?? payload; // 念のため fallback

    const jobId: string | undefined = job?.name;
    const state: string | undefined = job?.state;

    if (!jobId || !state) {
      this.logger.warn(
        'TranscoderWebhookMissingJobFields',
        'handleTranscoderWebhook',
        {
          messageId: message.messageId,
          payload,
        },
      );
      return;
    }

    await this.webhookService.handleJobNotification(jobId, state);
  }
}
