// api/src/internal/transcoder/transcoder-webhook.module.ts
//
// Transcoder Webhook 内部処理用モジュール
//

import { Module } from '@nestjs/common';
import { TranscoderWebhookController } from './transcoder-webhook.controller';
import { TranscoderWebhookService } from './transcoder-webhook.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CoreModule } from '../../core/core.module';

@Module({
  imports: [PrismaModule, CoreModule],
  controllers: [TranscoderWebhookController],
  providers: [TranscoderWebhookService],
})
export class TranscoderWebhookModule {}
