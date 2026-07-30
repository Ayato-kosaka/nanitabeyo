// api/src/v1/logs/logs.service.ts
//
// #487 【設計】フロントログ送信経路変更（Prisma 廃止 / Cloud Logging 対応）
// フロントエンドログを AppLoggerService 経由で Cloud Logging へ出力
//

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CreateFrontendLogDto,
  UNKNOWN_BUILD_META_SERVER,
} from '@shared/v1/dto';
import {
  CreateFrontendLogBatchResponseDto,
  CreateFrontendLogResponseDto,
} from '@shared/v1/res';
import { AppLoggerService } from '../../core/logger/logger.service';
import type { RejectedFrontendLogSummary } from './frontend-log-batch.pipe';

/**
 * #1079 値の出現回数を数える。
 * lodash 本体は api の依存に含まれない（lodash.chunk のみ）ため、
 * 新規依存を足さずに必要な countBy 相当だけをここで実装する。
 */
const countBy = (values: string[]): Record<string, number> =>
  values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

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
   * #1079 【設計】検証は FrontendLogBatchValidationPipe が要素単位で済ませており、
   *       ここへ来るのは受理分のみ。棄却分は要約だけを受け取ってバックエンドログへ残す。
   * @param dtos 検証を通過したフロントエンドログ DTO の配列
   * @param userId 認証済みユーザーID
   * @param rejected 検証に失敗して落とした要素の要約（値は含まない）
   * @returns { received: true, accepted, rejected }
   */
  async createFrontendLogBatch(
    dtos: CreateFrontendLogDto[],
    userId: string,
    rejected: RejectedFrontendLogSummary[] = [],
  ): Promise<CreateFrontendLogBatchResponseDto> {
    for (const dto of dtos) {
      await this.writeFrontendLog(dto, userId);
    }

    if (rejected.length > 0) {
      // #1079 部分受理した場合の棄却件数・理由をバックエンドログへ残す。
      // 1 リクエストにつき 1 行だけ出す（要素ごとには出さない）。
      // payload / path_name / event_name などログ本文由来の値は一切載せない。
      this.loggerService.warn(
        'frontend_log_batch_rejected',
        'LogsService.createFrontendLogBatch',
        {
          received: dtos.length + rejected.length,
          accepted: dtos.length,
          rejected: rejected.length,
          // フィールド名 → 件数（例: { created_commit_id: 12, payload: 1 }）
          rejected_fields: countBy(rejected.flatMap((r) => r.fields)),
          // 制約名 → 件数（例: { isString: 12, isObject: 1 }）
          rejected_constraints: countBy(rejected.flatMap((r) => r.constraints)),
          // 位置のみ。数値なので PII になり得ない
          rejected_indices: rejected.map((r) => r.index),
        },
      );
    }

    return { received: true, accepted: dtos.length, rejected: rejected.length };
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
        // #1078 DTO を @IsOptional() にしたぶん、BigQuery 側が NULL にならないようここで埋める。
        // 空文字も欠落として扱うため ?? ではなく || を使う。
        // 単発・バッチ両経路がこの writeFrontendLog を通るので、補完は 1 箇所で足りる。
        created_app_version:
          dto.created_app_version || UNKNOWN_BUILD_META_SERVER,
        created_commit_id: dto.created_commit_id || UNKNOWN_BUILD_META_SERVER,
      });
    } catch {
      // #487 【設計】書き込み失敗時はログ出力のみ、フロントへのエラー返却なし
    }
  }
}
