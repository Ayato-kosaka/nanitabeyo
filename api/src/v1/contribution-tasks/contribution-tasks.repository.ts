// api/src/v1/contribution-tasks/contribution-tasks.repository.ts
//
// 🎯 目的
//   • contribution_tasks テーブルへのデータアクセスを一元管理
//   • ユーザー協力タスクの事実ログ保存・取得を担当
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

/**
 * 協力タスクの完全な情報を表す Entity
 */
export interface ContributionTaskFullEntity {
  id: string;
  type: string;
  task_key: string;
  target_type: string;
  target_id: string;
  payload: unknown;
  result: unknown;
  created_at: Date;
}

/**
 * 完了済みtargetIdの集計結果
 */
export interface CompletedTargetIdEntity {
  target_id: string;
  count: number;
  last_completed_at: Date;
}

/**
 * リスト取得のフィルタ条件
 */
export interface FindMineFilters {
  taskKey?: string;
  type?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
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

  /**
   * ユーザー自身の協力タスク一覧を取得
   *
   * @param tx Prisma トランザクションクライアント
   * @param userId ユーザーID
   * @param filters フィルタ条件
   * @param limit 取得件数
   * @param cursor カーソル（createdAt|id 形式）
   * @param includePayload payload を含めるか
   * @param includeResult result を含めるか
   * @returns 協力タスクの配列
   */
  async findMine(
    tx: Prisma.TransactionClient,
    userId: string,
    filters: FindMineFilters,
    limit: number,
    cursor?: string,
    includePayload: boolean = false,
    includeResult: boolean = false,
  ): Promise<ContributionTaskFullEntity[]> {
    this.logger.debug('ContributionTasksRepository.findMine', 'start', {
      userId,
      filters,
      limit,
      cursor,
    });

    // #701 【設計】WHERE条件を構築
    const createdAtCondition: Prisma.DateTimeFilter | undefined =
      filters.from || filters.to
        ? {
            ...(filters.from && { gte: filters.from }),
            ...(filters.to && { lt: filters.to }),
          }
        : undefined;
    const createdAtFilter: Prisma.contribution_tasksWhereInput['created_at'] = {};
    if (filters.from) {
      createdAtFilter.gte = filters.from;
    }
    if (filters.to) {
      createdAtFilter.lt = filters.to;
    }

    const baseWhere: Prisma.contribution_tasksWhereInput = {
      user_id: userId,
      ...(filters.taskKey && { task_key: filters.taskKey }),
      ...(filters.type && { type: filters.type }),
      ...(filters.targetType && { target_type: filters.targetType }),
      ...(filters.targetId && { target_id: filters.targetId }),
      ...(Object.keys(createdAtFilter).length > 0 && { created_at: createdAtFilter }),
    };

    let where: Prisma.contribution_tasksWhereInput = baseWhere;

    // #701 【設計】カーソルページング：cursor がある場合は created_at + id で絞り込み
    if (cursor) {
      const [createdAtStr, id] = cursor.split('|');
      const createdAt = new Date(createdAtStr);
      const cursorCondition: Prisma.contribution_tasksWhereInput = {
        OR: [
          { created_at: { lt: createdAt } },
          { created_at: createdAt, id: { lt: id } },
        ],
      };

      // #701 【バグ】created_at フィルタとカーソル条件を AND で結合して範囲を正しく適用
      where = {
        AND: [baseWhere, cursorCondition],
      };
    }

    const tasks = await tx.contribution_tasks.findMany({
      where,
      select: {
        id: true,
        type: true,
        task_key: true,
        target_type: true,
        target_id: true,
        payload: includePayload,
        result: includeResult,
        created_at: true,
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1, // #701 【設計】次ページ判定のため +1 件取得
    });

    this.logger.debug('ContributionTasksRepository.findMine', 'found', {
      count: tasks.length,
    });

    return tasks as ContributionTaskFullEntity[];
  }

  /**
   * ユーザー自身の協力タスクを ID で取得
   *
   * @param tx Prisma トランザクションクライアント
   * @param id 協力タスクID
   * @param userId ユーザーID
   * @returns 協力タスク（見つからない場合や他人の場合は null）
   */
  async findMineById(
    tx: Prisma.TransactionClient,
    id: string,
    userId: string,
  ): Promise<ContributionTaskFullEntity | null> {
    this.logger.debug('ContributionTasksRepository.findMineById', 'start', {
      id,
      userId,
    });

    // #701 【設計】自分のレコードのみ取得（認可チェック）
    const task = await tx.contribution_tasks.findFirst({
      where: {
        id,
        user_id: userId,
      },
      select: {
        id: true,
        type: true,
        task_key: true,
        target_type: true,
        target_id: true,
        payload: true,
        result: true,
        created_at: true,
      },
    });

    this.logger.debug('ContributionTasksRepository.findMineById', 'result', {
      found: !!task,
    });

    return task as ContributionTaskFullEntity | null;
  }

  /**
   * ユーザー自身が既に完了しているか確認
   *
   * @param tx Prisma トランザクションクライアント
   * @param userId ユーザーID
   * @param taskKey タスクキー
   * @param targetType 対象タイプ
   * @param targetId 対象ID
   * @param type タイプ（任意）
   * @returns 存在する場合は { id, created_at }、存在しない場合は null
   */
  async existsMine(
    tx: Prisma.TransactionClient,
    userId: string,
    taskKey: string,
    targetType: string,
    targetId: string,
    type?: string,
  ): Promise<ContributionTaskEntity | null> {
    this.logger.debug('ContributionTasksRepository.existsMine', 'start', {
      userId,
      taskKey,
      targetType,
      targetId,
      type,
    });

    // #701 【設計】自分のレコードで条件に一致するものを1件取得
    const task = await tx.contribution_tasks.findFirst({
      where: {
        user_id: userId,
        task_key: taskKey,
        target_type: targetType,
        target_id: targetId,
        ...(type && { type }),
      },
      select: {
        id: true,
        created_at: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    this.logger.debug('ContributionTasksRepository.existsMine', 'result', {
      exists: !!task,
    });

    return task;
  }

  /**
   * グローバルな完了済み targetId 一覧を取得（集計情報付き）
   *
   * @param tx Prisma トランザクションクライアント
   * @param taskKey タスクキー
   * @param targetType 対象タイプ
   * @param type タイプ（任意）
   * @param minCount 最小完了回数
   * @param limit 取得件数
   * @param cursor カーソル（lastCompletedAt|targetId 形式）
   * @returns 完了済み targetId の集計配列
   */
  async findCompletedTargetIds(
    tx: Prisma.TransactionClient,
    taskKey: string,
    targetType: string,
    type: string | undefined,
    minCount: number,
    limit: number,
    cursor?: string,
  ): Promise<CompletedTargetIdEntity[]> {
    this.logger.debug(
      'ContributionTasksRepository.findCompletedTargetIds',
      'start',
      {
        taskKey,
        targetType,
        type,
        minCount,
        limit,
        cursor,
      },
    );

    // #701 【設計】GROUP BY + HAVING を使った集計クエリを構築
    // 注意：Prismaでは直接 GROUP BY + HAVING が難しいので、rawクエリを使用
    let cursorCondition = '';
    const params: any[] = [taskKey, targetType];
    let paramIndex = 3;

    // type パラメータの処理
    if (type !== undefined) {
      params.push(type);
      paramIndex++;
    }

    // カーソル条件の構築
    if (cursor) {
      const [lastCompletedAtStr, targetId] = cursor.split('|');
      const lastCompletedAt = new Date(lastCompletedAtStr);
      params.push(lastCompletedAt, targetId);
      cursorCondition = `
        AND (
          MAX(created_at) < $${paramIndex}
          OR (MAX(created_at) = $${paramIndex} AND target_id < $${paramIndex + 1})
        )
      `;
      paramIndex += 2;
    }

    params.push(minCount);
    const minCountParam = `$${paramIndex}`;
    paramIndex++;

    params.push(limit + 1); // 次ページ判定のため +1
    const limitParam = `$${paramIndex}`;

    const typeCondition = type !== undefined ? `AND type = $3` : '';

    const query = `
      SELECT 
        target_id,
        COUNT(*)::int as count,
        MAX(created_at) as last_completed_at
      FROM "dev".contribution_tasks
      WHERE task_key = $1
        AND target_type = $2
        ${typeCondition}
        ${cursorCondition}
      GROUP BY target_id
      HAVING COUNT(*) >= ${minCountParam}
      ORDER BY last_completed_at DESC, target_id DESC
      LIMIT ${limitParam}
    `;

    this.logger.debug(
      'ContributionTasksRepository.findCompletedTargetIds',
      'query',
      {
        query,
        params,
      },
    );

    const results = await tx.$queryRawUnsafe<
      Array<{
        target_id: string;
        count: number;
        last_completed_at: Date;
      }>
    >(query, ...params);

    this.logger.debug(
      'ContributionTasksRepository.findCompletedTargetIds',
      'result',
      {
        count: results.length,
      },
    );

    return results.map((r) => ({
      target_id: r.target_id,
      count: r.count,
      last_completed_at: r.last_completed_at,
    }));
  }
}
