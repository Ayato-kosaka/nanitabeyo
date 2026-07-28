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
    await this.writeFrontendLog(dto, userId);
    return { received: true };
  }

  /**
   * フロントエンドログを配列で受け取り、1件ずつ AppLoggerService 経由で Cloud Logging へ出力
   * #1011 【設計】件中1件の書き込みに失敗しても、他の件の記録は継続する（単発エンドポイントと同じ「失敗時は黙殺」方針を各件に適用）
   * @param dtos フロントエンドログ DTO の配列
   * @param userId 認証済みユーザーID
   * @returns 常に { received: true } を返す
   */
  async createFrontendLogBatch(
    dtos: CreateFrontendLogDto[],
    userId: string,
  ): Promise<CreateFrontendLogResponseDto> {
    for (const dto of dtos) {
      await this.writeFrontendLog(dto, userId);
    }

    return { received: true };
  }

  private async writeFrontendLog(
    dto: CreateFrontendLogDto,
    userId: string,
  ): Promise<void> {
    try {
      await this.loggerService.logFrontendEvent({
        id: randomUUID(),
        user_id: userId,
        event_name: dto.event_name,
        path_name: dto.path_name,
        payload: dto.payload,
        error_level: dto.error_level,
        created_at: dto.created_at,
        created_app_version: dto.created_app_version,
        created_commit_id: dto.created_commit_id,
      });
    } catch {
      // #487 【設計】書き込み失敗時はログ出力のみ、フロントへのエラー返却なし
    }
  }
}
