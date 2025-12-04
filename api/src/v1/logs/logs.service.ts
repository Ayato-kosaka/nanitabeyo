// api/src/v1/logs/logs.service.ts
//
// #487 【設計】フロントログ送信経路変更（Prisma 廃止 / Cloud Logging 対応）
// フロントエンドログを AppLoggerService 経由で Cloud Logging へ出力
//

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateFrontendLogDto } from '@shared/v1/dto';
import { CreateFrontendLogResponseDto } from '@shared/v1/res';
import { AppLoggerService } from '../../core/logger/logger.service';

@Injectable()
export class LogsService {
  constructor(private readonly loggerService: AppLoggerService) {}

  /**
   * フロントエンドログを AppLoggerService 経由で Cloud Logging へ出力
   * @param dto フロントエンドログ DTO
   * @param userId 認証済みユーザーID
   * @returns 常に { received: true } を返す
   */
  async createFrontendLog(
    dto: CreateFrontendLogDto,
    userId: string,
  ): Promise<CreateFrontendLogResponseDto> {
    try {
      await this.loggerService.logFrontendEvent({
        id: randomUUID(),
        user_id: userId,
        event_name: dto.event_name,
        path_name: dto.path_name,
        payload: dto.payload,
        error_level: dto.error_level,
        created_app_version: dto.created_app_version,
        created_commit_id: dto.created_commit_id,
      });
    } catch {
      // #487 【設計】書き込み失敗時はログ出力のみ、フロントへのエラー返却なし
    }

    return { received: true };
  }
}
