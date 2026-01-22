// api/src/v1/contribution-tasks/contribution-tasks.service.ts
//
// 🎯 目的
//   • 協力タスクのビジネスロジックを実装
//   • Repository とトランザクション管理を編成
//   • Controller から渡される DTO を Repository に橋渡し
//

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import {
  CreateContributionTaskDto,
  ListContributionTasksQueryDto,
  ExistsContributionTaskQueryDto,
  CompletedTargetIdsQueryDto,
} from '@shared/v1/dto';
import {
  CreateContributionTaskResponse,
  ListContributionTasksResponse,
  GetContributionTaskByIdResponse,
  ExistsContributionTaskResponse,
  CompletedTargetIdsResponse,
  ContributionTaskItem,
} from '@shared/v1/res';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import {
  ContributionTasksRepository,
  FindMineFilters,
} from './contribution-tasks.repository';
import { PrismaContributionTasks } from '../../../../shared/converters/convert_contribution_tasks';

@Injectable()
export class ContributionTasksService {
  constructor(
    private readonly repo: ContributionTasksRepository,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) { }

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
    this.logger.debug(
      'ContributionTasksService.createContributionTask',
      'start',
      {
        userId,
        type: dto.type,
        taskKey: dto.taskKey,
      },
    );

    const result = await this.prisma.withTransaction(
      async (tx: Prisma.TransactionClient) => {
        return this.repo.create(tx, userId, dto);
      },
    );

    this.logger.debug(
      'ContributionTasksService.createContributionTask',
      'completed',
      {
        id: result.id,
      },
    );

    return result;
  }

  /**
   * GET /v1/contribution-tasks
   *
   * 自分の協力タスク履歴一覧を取得
   *
   * @param query クエリパラメータ
   * @param userId ユーザーID（認証情報から取得）
   * @returns 協力タスク一覧とカーソル
   */
  async list(
    query: ListContributionTasksQueryDto,
    userId: string,
  ): Promise<ListContributionTasksResponse> {
    this.logger.debug('ContributionTasksService.list', 'start', {
      userId,
      query,
    });

    const limit = query.limit ?? 20;

    // #701 【設計】include パラメータで payload/result を含めるか判定
    const includeFields = query.include?.split(',').map(s => s.trim()) || [];
    const includePayload = includeFields.includes('payload');
    const includeResult = includeFields.includes('result');

    // #701 【設計】日付フィルタを Date オブジェクトに変換
    const filters: FindMineFilters = {
      taskKey: query.taskKey,
      type: query.type,
      targetType: query.targetType,
      targetId: query.targetId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    };

    const tasks = await this.repo.findMine(
      this.prisma.prisma,
      userId,
      filters,
      limit,
      query.cursor,
      includePayload,
      includeResult,
    );

    // #701 【設計】次ページ判定：limit+1 件取得しているので、limit を超えていれば次がある
    const hasNext = tasks.items.length > limit;
    const items = hasNext ? tasks.items.slice(0, limit) : tasks.items;

    let nextCursor: string | null = null;
    if (hasNext && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = `${lastItem.created_at.toISOString()}|${lastItem.id}`;
    }

    const response: ListContributionTasksResponse = {
      items: items.map((task) => {
        const item: ContributionTaskItem = {
          id: task.id,
          type: task.type,
          taskKey: task.task_key,
          targetType: task.target_type,
          targetId: task.target_id,
          createdAt: task.created_at.toISOString(),
        };
        if (includePayload) {
          item.payload = (task as PrismaContributionTasks).payload as Record<string, unknown>;
        }
        if (includeResult) {
          item.result = (task as PrismaContributionTasks).result as Record<string, unknown>;
        }
        return item;
      }),
      nextCursor,
    };

    this.logger.debug('ContributionTasksService.list', 'completed', {
      count: items.length,
      hasNext,
    });

    return response;
  }

  /**
   * GET /v1/contribution-tasks/:id
   *
   * 協力タスクの詳細を取得
   *
   * @param id 協力タスクID
   * @param userId ユーザーID（認証情報から取得）
   * @returns 協力タスクの詳細
   * @throws NotFoundException 見つからないか、他人のレコードの場合
   */
  async getById(
    id: string,
    userId: string,
  ): Promise<GetContributionTaskByIdResponse> {
    this.logger.debug('ContributionTasksService.getById', 'start', {
      id,
      userId,
    });

    const task = await this.repo.findMineById(this.prisma.prisma, id, userId);

    // #701 【設計】見つからない/権限なしは 404（情報露出防止）
    if (!task) {
      this.logger.debug('ContributionTasksService.getById', 'not found', {
        id,
      });
      throw new NotFoundException('Contribution task not found');
    }

    this.logger.debug('ContributionTasksService.getById', 'completed', {
      id: task.id,
    });

    return {
      id: task.id,
      type: task.type,
      taskKey: task.task_key,
      targetType: task.target_type,
      targetId: task.target_id,
      payload: task.payload as Record<string, unknown>,
      result: task.result as Record<string, unknown>,
      createdAt: task.created_at.toISOString(),
    };
  }

  /**
   * GET /v1/contribution-tasks/exists
   *
   * 自分が既に完了しているか確認（二重防止）
   *
   * @param query クエリパラメータ
   * @param userId ユーザーID（認証情報から取得）
   * @returns 存在するかどうか
   */
  async exists(
    query: ExistsContributionTaskQueryDto,
    userId: string,
  ): Promise<ExistsContributionTaskResponse> {
    this.logger.debug('ContributionTasksService.exists', 'start', {
      userId,
      query,
    });

    const task = await this.repo.existsMine(
      this.prisma.prisma,
      userId,
      query.taskKey,
      query.targetType,
      query.targetId,
      query.type,
    );

    const response: ExistsContributionTaskResponse = {
      exists: !!task,
      ...(task && {
        id: task.id,
        createdAt: task.createdAt,
      }),
    };

    this.logger.debug('ContributionTasksService.exists', 'completed', {
      exists: response.exists,
    });

    return response;
  }

  /**
   * GET /v1/contribution-tasks/completed-target-ids
   *
   * グローバルな完了済み targetId 一覧を取得
   *
   * @param query クエリパラメータ
   * @returns 完了済み targetId の集計情報
   */
  async completedTargetIds(
    query: CompletedTargetIdsQueryDto,
  ): Promise<CompletedTargetIdsResponse> {
    this.logger.debug('ContributionTasksService.completedTargetIds', 'start', {
      query,
    });

    const limit = query.limit ?? 200;
    const minCount = query.minCount ?? 1;

    const results = await this.repo.findCompletedTargetIds(
      this.prisma.prisma,
      query.taskKey,
      query.targetType,
      query.type,
      minCount,
      limit,
      query.cursor,
    );

    // #701 【設計】次ページ判定：limit+1 件取得しているので、limit を超えていれば次がある
    const hasNext = results.items.length > limit;
    const items = hasNext ? results.items.slice(0, limit) : results.items;

    let nextCursor: string | null = null;
    if (hasNext && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = `${lastItem.lastCompletedAt}|${lastItem.targetId}`;
    }

    const response: CompletedTargetIdsResponse = {
      taskKey: query.taskKey,
      targetType: query.targetType,
      ...(query.type && { type: query.type }),
      minCount,
      completed: items,
      nextCursor,
    };

    this.logger.debug(
      'ContributionTasksService.completedTargetIds',
      'completed',
      {
        count: items.length,
        hasNext,
      },
    );

    return response;
  }
}
