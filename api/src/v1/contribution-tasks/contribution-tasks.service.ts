// api/src/v1/contribution-tasks/contribution-tasks.service.ts
//
// 🎯 目的
//   • 協力タスク作成のビジネスロジックを実装
//   • Repository とトランザクション管理を編成
//   • Controller から渡される DTO を Repository に橋渡し
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { CreateContributionTaskDto } from '@shared/v1/dto';
import { CreateContributionTaskResponse } from '@shared/v1/res';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { ContributionTasksRepository } from './contribution-tasks.repository';

@Injectable()
export class ContributionTasksService {
  constructor(
    private readonly repo: ContributionTasksRepository,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * POST /v1/contribution-tasks
   * 
   * ユーザー協力タスクの結果を記録
   * 
   * @param dto 協力タスクのデータ
   * @param userId 協力を行ったユーザーID（認証情報から取得）
   * @returns 作成された協力タスクの ID と作成日時
   */
  async createContributionTask(
    dto: CreateContributionTaskDto,
    userId: string,
  ): Promise<CreateContributionTaskResponse> {
    this.logger.debug('ContributionTasksService.createContributionTask', 'start', {
      userId,
      type: dto.type,
      taskKey: dto.taskKey,
    });

    const result = await this.prisma.withTransaction(
      async (tx: Prisma.TransactionClient) => {
        return this.repo.create(tx, userId, dto);
      },
    );

    this.logger.debug('ContributionTasksService.createContributionTask', 'completed', {
      id: result.id,
    });

    return {
      id: result.id,
      createdAt: result.created_at.toISOString(),
    };
  }
}
