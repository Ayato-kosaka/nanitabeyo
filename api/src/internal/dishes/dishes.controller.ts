// api/src/internal/dishes/dishes.controller.ts
//
// ❶ Cloud Tasks からの OIDC 認証済みリクエストのみ受け付ける内部エンドポイント
// ❷ 写真の実体取得・保存と 4テーブルUPSERT を非同期実行
//

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { CreateDishMediaEntryJobPayload } from './create-dish-media-entry.interface';
import { CreateDishMediaEntryService } from './create-dish-media-entry.service';
import { OIDCGuard } from './oidc.guard';
import { AppLoggerService } from '../../core/logger/logger.service';

/**
 * 内部処理専用コントローラー
 * Cloud Tasks からの OIDC 認証済みリクエストのみ処理
 */
@Controller('internal/dishes')
@UseGuards(OIDCGuard)
export class DishesController {
  constructor(
    private readonly createDishMediaEntryService: CreateDishMediaEntryService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * POST /internal/dishes/create
   *
   * Cloud Tasks から呼び出される非同期処理エンドポイント
   * - 写真の実体取得・保存
   * - 4テーブルのUPSERT
   */
  @Post('create')
  @HttpCode(HttpStatus.NO_CONTENT)
  async createDishMediaEntry(
    @Body() payload: CreateDishMediaEntryJobPayload,
  ): Promise<void> {
    this.logger.debug('CreateDishMediaEntryStarted', 'createDishMediaEntry', {
      jobId: payload.jobId,
      idempotencyKey: payload.idempotencyKey,
      photoUriCount: payload.photoUri.length,
    });

    try {
      await this.createDishMediaEntryService.processAsyncJob(payload);

      this.logger.log('CreateDishMediaEntryCompleted', 'createDishMediaEntry', {
        jobId: payload.jobId,
        idempotencyKey: payload.idempotencyKey,
      });
    } catch (error) {
      this.logger.error('CreateDishMediaEntryError', 'createDishMediaEntry', {
        jobId: payload.jobId,
        idempotencyKey: payload.idempotencyKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Cloud Tasks のリトライに委譲するため例外を再スロー
      throw error;
    }
  }
}
