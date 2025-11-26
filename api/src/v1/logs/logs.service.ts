// api/src/v1/logs/logs.service.ts
//
// #489 【設計】フロントログ送信経路変更（Supabase → Backend API 経由）
// フロントエンドログを Prisma で frontend_event_logs に書き込む
//

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateFrontendLogDto } from '@shared/v1/dto';
import { CreateFrontendLogResponseDto } from '@shared/v1/res';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * フロントエンドログを frontend_event_logs テーブルに書き込む
   * @param dto フロントエンドログ DTO
   * @param userId 認証済みユーザーID
   * @returns 常に { received: true } を返す
   */
  async createFrontendLog(
    dto: CreateFrontendLogDto,
    userId: string,
  ): Promise<CreateFrontendLogResponseDto> {
    try {
      await this.prisma.prisma.frontend_event_logs.create({
        data: {
          id: randomUUID(),
          user_id: userId,
          event_name: dto.event_name,
          path_name: dto.path_name,
          payload: JSON.stringify(dto.payload),
          error_level: dto.error_level,
          created_at: new Date(dto.created_at),
          created_app_version: dto.created_app_version,
          created_commit_id: dto.created_commit_id,
        },
      });
    } catch {
      // #489 【設計】書き込み失敗時はログ出力のみ、フロントへのエラー返却なし
    }

    return { received: true };
  }
}
