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
   * - message.attributes から Job ID とステータスを取得
   * - Job ステータスに応じた処理（成功/失敗/AudioMissing リトライ）
   */
  @Post('webhook')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async handleTranscoderWebhook(
    @Body() dto: TranscoderWebhookDto,
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

    // attributes から jobId と state を取得
    const attributes = message.attributes || {};
    const jobId = attributes['jobId'];
    const state = attributes['state'];

    if (!jobId || !state) {
      this.logger.warn(
        'TranscoderWebhookMissingAttributes',
        'handleTranscoderWebhook',
        {
          messageId: message.messageId,
          attributes,
        },
      );
      return;
    }

    await this.webhookService.handleJobNotification(jobId, state);
  }
}
