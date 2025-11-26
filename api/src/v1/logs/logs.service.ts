// api/src/v1/logs/logs.service.ts
//
// #489 【設計】フロントログ送信経路変更（Supabase → Backend API 経由）
// フロントエンドログを Cloud Logging に structured log として出力する
//

import { Injectable } from '@nestjs/common';
import { CreateFrontendLogDto } from '@shared/v1/dto';
import { CreateFrontendLogResponseDto } from '@shared/v1/res';

// error_level から Cloud Logging の severity へのマッピング
const SEVERITY_MAP: Record<
  CreateFrontendLogDto['error_level'],
  'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'
> = {
  verbose: 'DEBUG',
  debug: 'DEBUG',
  log: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
};

@Injectable()
export class LogsService {
  /**
   * フロントエンドログを Cloud Logging に structured log として出力
   * @param dto フロントエンドログ DTO
   * @param userId 認証済みユーザーID（オプション）
   * @returns 常に { received: true } を返す
   */
  createFrontendLog(
    dto: CreateFrontendLogDto,
    userId?: string,
  ): CreateFrontendLogResponseDto {
    try {
      // Cloud Run で見やすい構造化ログを stdout に出力
      const entry = {
        severity: SEVERITY_MAP[dto.error_level],
        type: 'frontend',
        event_name: dto.event_name,
        path_name: dto.path_name,
        payload: dto.payload,
        error_level: dto.error_level,
        user_id: userId ?? dto.user_id ?? null,
        created_at: dto.created_at,
        created_app_version: dto.created_app_version,
        created_commit_id: dto.created_commit_id,
        timestamp: new Date().toISOString(),
      };
      console.log(JSON.stringify(entry));
    } catch {
      // #489 【設計】書き込み失敗時はログ出力のみ、フロントへのエラー返却なし
    }

    return { received: true };
  }
}
