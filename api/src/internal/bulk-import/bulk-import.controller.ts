// api/src/internal/bulk-import/bulk-import.controller.ts
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
import { BulkImportJobPayload } from './bulk-import-job.interface';
import { BulkImportExecutorService } from './bulk-import-executor.service';
import { OIDCGuard } from './oidc.guard';
import { AppLoggerService } from '../../core/logger/logger.service';

/**
 * 内部処理専用コントローラー
 * Cloud Tasks からの OIDC 認証済みリクエストのみ処理
 */
@Controller('internal/bulk-import')
@UseGuards(OIDCGuard)
export class BulkImportController {
  constructor(
    private readonly executorService: BulkImportExecutorService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * POST /internal/bulk-import/execute
   * 
   * Cloud Tasks から呼び出される非同期処理エンドポイント
   * - 写真の実体取得・保存
   * - 4テーブルのUPSERT
   */
  @Post('execute')
  @HttpCode(HttpStatus.NO_CONTENT)
  async executeBulkImport(
    @Body() payload: BulkImportJobPayload,
  ): Promise<void> {
    this.logger.debug('BulkImportExecuteStarted', 'executeBulkImport', {
      jobId: payload.jobId,
      idempotencyKey: payload.idempotencyKey,
      placesCount: payload.places.length,
    });

    try {
      await this.executorService.processAsyncJob(payload);
      
      this.logger.log('BulkImportExecuteCompleted', 'executeBulkImport', {
        jobId: payload.jobId,
        idempotencyKey: payload.idempotencyKey,
      });
    } catch (error) {
      this.logger.error('BulkImportExecuteError', 'executeBulkImport', {
        jobId: payload.jobId,
        idempotencyKey: payload.idempotencyKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      // Cloud Tasks のリトライに委譲するため例外を再スロー
      throw error;
    }
  }
}