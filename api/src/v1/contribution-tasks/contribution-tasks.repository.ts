// api/src/v1/contribution-tasks/contribution-tasks.repository.ts
//
// 🎯 目的
//   • contribution_tasks テーブルへのデータアクセスを一元管理
//   • ユーザー協力タスクの事実ログ保存を担当
//   • Service 層から Prisma の詳細を隠蔽
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { CreateContributionTaskDto } from '@shared/v1/dto';
import { AppLoggerService } from 'src/core/logger/logger.service';

/**
 * 協力タスクの保存結果を表す Entity
 */
export interface ContributionTaskEntity {
  id: string;
  created_at: Date;
}

@Injectable()
export class ContributionTasksRepository {
  constructor(private readonly logger: AppLoggerService) {}

  /**
   * 協力タスクを1件作成
   *
   * @param tx Prisma トランザクションクライアント
   * @param userId 協力を行ったユーザーID
   * @param dto 協力タスクのデータ
   * @returns 作成された協力タスクの ID と created_at
   */
  async create(
    tx: Prisma.TransactionClient,
    userId: string,
    dto: CreateContributionTaskDto,
  ): Promise<ContributionTaskEntity> {
    this.logger.debug('ContributionTasksRepository.create', 'create', {
      userId,
      type: dto.type,
      taskKey: dto.taskKey,
      targetType: dto.targetType,
      targetId: dto.targetId,
    });

    // #669 【設計】payload/result が未指定の場合は空オブジェクトを設定
    const payload = dto.payload ?? {};
    const result = dto.result ?? {};

    const created = await tx.contribution_tasks.create({
      data: {
        type: dto.type,
        task_key: dto.taskKey,
        target_type: dto.targetType,
        target_id: dto.targetId,
        payload: payload as Prisma.InputJsonValue,
        result: result as Prisma.InputJsonValue,
        user_id: userId,
      },
      select: {
        id: true,
        created_at: true,
      },
    });

    this.logger.debug('ContributionTasksRepository.create', 'created', {
      id: created.id,
    });

    return created;
  }
}
