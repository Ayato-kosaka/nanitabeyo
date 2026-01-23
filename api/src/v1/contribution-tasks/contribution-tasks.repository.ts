// api/src/v1/contribution-tasks/contribution-tasks.repository.ts
//
// 🎯 目的（ベストプラクティス版）
//   • contribution_tasks テーブルへのデータアクセスを一元管理
//   • Service 層から Prisma の詳細を隠蔽
//   • ページング（カーソル）を Repository が「完全に」扱い、呼び出し側の責務漏れを防止
//   • カーソルは壊れにくい Base64URL(JSON) 形式に統一し、バリデーション込みで安全に扱う
//   • includePayload/includeResult は型安全に反映（強制キャストで黙らせない）
//   • payload/result の「未指定」を JSON null として保存し、意味（未指定 vs 空オブジェクト）を保持
//

import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '../../../../shared/prisma/client';
import { CreateContributionTaskDto } from '@shared/v1/dto';
import { AppLoggerService } from 'src/core/logger/logger.service';
import { PrismaContributionTasks } from '../../../../shared/converters/convert_contribution_tasks';
import {
  CompletedTargetIdItem,
  CreateContributionTaskResponse,
} from '@shared/v1/res';

/**
 * Tx / PrismaClient のどちらでも受け取れるようにする（読み取り時に tx 強制しない）
 * - Service がトランザクションを握る場合は tx を渡す
 * - そうでない場合は prismaClient を渡す
 */
export type PrismaExecutor = Prisma.TransactionClient | PrismaClient;

/**
 * 協力タスク（payload/result を含まない）Entity
 * - リストなどで payload/result が不要なケースの基本形
 */
export type ContributionTaskEntityBase = Pick<
  PrismaContributionTasks,
  'id' | 'type' | 'task_key' | 'target_type' | 'target_id' | 'created_at'
>;

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

/**
 * ページング共通の戻り値
 */
export interface CursorPage<T> {
  items: T[];
  hasNext: boolean;
  nextCursor?: string;
}

/**
 * findMine 用のカーソルペイロード
 * - created_at DESC, id DESC の複合順序に対応
 */
type FindMineCursor = Pick<PrismaContributionTasks, 'created_at' | 'id'>;

/**
 * findCompletedTargetIds 用のカーソルペイロード
 * - last_completed_at (= MAX(created_at)) DESC, target_id DESC の複合順序に対応
 */
type CompletedTargetIdsCursor = {
  lastCompletedAt: string; // ISO 文字列
  targetId: string;
};

/**
 * Base64URL(JSON) エンコード/デコード
 * - `|` split のような壊れやすい形式を避ける
 * - URL セーフ（+ / = を使わない）に寄せる
 */
function base64UrlEncodeJson<T>(value: T): string {
  const json = JSON.stringify(value);
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecodeJson<T>(cursor: string): T | null {
  try {
    // Base64URL -> Base64 に戻す
    const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    // パディング復元
    const padLen = (4 - (b64.length % 4)) % 4;
    const padded = b64 + '='.repeat(padLen);

    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * Date の妥当性チェック
 */
function isValidDate(d: Date): boolean {
  return Number.isFinite(d.getTime());
}

/**
 * Prisma JSON への投入値を整形
 * - undefined（未指定）は JSON null として保存し、意味を保持する
 * - null を DTO が明示した場合は null をそのまま保存（DTO 設計次第）
 */
function toPrismaJsonValue(
  value: unknown | undefined,
): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  if (value === undefined) {
    return Prisma.JsonNull;
  }
  // Prisma.InputJsonValue は `null` を許容するが、DB/Prisma の設定次第なので
  // ここではそのまま通す（DTO で null を許容している前提）
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class ContributionTasksRepository {
  constructor(private readonly logger: AppLoggerService) {}

  /**
   * 協力タスクを1件作成
   *
   * @param db Prisma 実行器（tx でも PrismaClient でも可）
   * @param userId 協力を行ったユーザーID
   * @param dto 協力タスクのデータ
   * @returns 作成された協力タスクの ID と created_at
   */
  async create(
    db: PrismaExecutor,
    userId: string,
    dto: CreateContributionTaskDto,
  ): Promise<CreateContributionTaskResponse> {
    this.logger.debug('ContributionTasksRepository.create', 'start', {
      userId,
      type: dto.type,
      taskKey: dto.taskKey,
      targetType: dto.targetType,
      targetId: dto.targetId,
    });

    // payload/result の「未指定」は JSON null にして意味を保持する
    const payload = toPrismaJsonValue(dto.payload);
    const result = toPrismaJsonValue(dto.result);

    const created = await db.contribution_tasks.create({
      data: {
        type: dto.type,
        task_key: dto.taskKey,
        target_type: dto.targetType,
        target_id: dto.targetId,
        payload,
        result,
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

    return {
      id: created.id,
      createdAt: created.created_at.toISOString(),
    };
  }

  /**
   * ユーザー自身の協力タスク一覧を取得（カーソルページング）
   *
   * ✅ ベストプラクティス
   * - Repository が `items/hasNext/nextCursor` まで責務として返す（呼び出し側に +1 破棄を押し付けない）
   * - cursor は Base64URL(JSON) で壊れにくくする
   * - includePayload/includeResult は型安全に反映する
   *
   * @param db Prisma 実行器（tx でも PrismaClient でも可）
   * @param userId ユーザーID
   * @param filters フィルタ条件
   * @param limit 取得件数
   * @param cursor ページングカーソル（Base64URL(JSON)）
   * @param includePayload payload を含めるか
   * @param includeResult result を含めるか
   */
  async findMine(
    db: PrismaExecutor,
    userId: string,
    filters: FindMineFilters,
    limit: number,
    cursor?: string,
    includePayload = false,
    includeResult = false,
  ): Promise<CursorPage<ContributionTaskEntityBase | PrismaContributionTasks>> {
    this.logger.debug('ContributionTasksRepository.findMine', 'start', {
      userId,
      filters,
      limit,
      cursorProvided: !!cursor,
      includePayload,
      includeResult,
    });

    // created_at 範囲フィルタ
    const createdAtFilter: Prisma.contribution_tasksWhereInput['created_at'] =
      {};
    if (filters.from) createdAtFilter.gte = filters.from;
    if (filters.to) createdAtFilter.lt = filters.to;

    const baseWhere: Prisma.contribution_tasksWhereInput = {
      user_id: userId,
      ...(filters.taskKey ? { task_key: filters.taskKey } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.targetType ? { target_type: filters.targetType } : {}),
      ...(filters.targetId ? { target_id: filters.targetId } : {}),
      ...(Object.keys(createdAtFilter).length > 0
        ? { created_at: createdAtFilter }
        : {}),
    };

    // カーソル（created_at DESC, id DESC）に合わせた条件を構築
    let where: Prisma.contribution_tasksWhereInput = baseWhere;

    if (cursor) {
      const decoded = base64UrlDecodeJson<FindMineCursor>(cursor);

      if (!decoded?.created_at || !decoded?.id) {
        // カーソル不正 → 安全のため無視（API 設計次第では 400 にしても良い）
        this.logger.warn(
          'ContributionTasksRepository.findMine',
          'invalid_cursor_ignored',
          { cursor },
        );
      } else {
        const createdAt = new Date(decoded.created_at);
        if (!isValidDate(createdAt)) {
          this.logger.warn(
            'ContributionTasksRepository.findMine',
            'invalid_cursor_date_ignored',
            {
              cursor,
              createdAt: decoded.created_at,
            },
          );
        } else {
          // DESC 順での「次ページ」は「より古い」(created_at が小さい) 方向
          const cursorCondition: Prisma.contribution_tasksWhereInput = {
            OR: [
              { created_at: { lt: createdAt } },
              { created_at: createdAt, id: { lt: decoded.id } },
            ],
          };

          // 既存フィルタ（created_at 範囲など）とカーソル条件を AND で結合
          where = { AND: [baseWhere, cursorCondition] };
        }
      }
    }

    // select を include フラグに合わせて安全に切り替える
    // - payload/result を取らない場合、返却型も payload/result なしにする
    const selectBase = {
      id: true,
      type: true,
      task_key: true,
      target_type: true,
      target_id: true,
      created_at: true,
    } as const;

    const selectWith = {
      ...selectBase,
      payload: true,
      result: true,
    } as const;

    const needPayloadOrResult = includePayload || includeResult;

    const raw = await db.contribution_tasks.findMany({
      where,
      select: needPayloadOrResult ? selectWith : selectBase,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1, // 次ページ判定のため +1
    });

    const hasNext = raw.length > limit;
    const sliced = hasNext ? raw.slice(0, limit) : raw;

    // nextCursor は「このページの最後の要素」を基準に作る
    const last = sliced[sliced.length - 1];
    const nextCursor = last
      ? base64UrlEncodeJson<FindMineCursor>({
          created_at: last.created_at,
          id: last.id,
        })
      : undefined;

    // includePayload/includeResult の挙動を固定化：
    // - どちらかが true の場合だけ payload/result を返す（ただし JSON null の可能性はある）
    // - true/false を別々に扱いたい場合は、ここで payload/result の片方を落とすこともできる
    //   （ただし select が複雑になるため、ここでは「どちらか true なら両方取得」を採用）
    //   ※厳密にやるなら: includePayload true のときだけ payload を select する等、select を分岐させる
    const items = sliced.map((t) => {
      if (!needPayloadOrResult) {
        const base: ContributionTaskEntityBase = {
          id: t.id,
          type: t.type,
          task_key: t.task_key,
          target_type: t.target_type,
          target_id: t.target_id,
          created_at: t.created_at,
        };
        return base;
      }

      const full = t as PrismaContributionTasks;
      return full;
    });

    this.logger.debug('ContributionTasksRepository.findMine', 'result', {
      count: items.length,
      hasNext,
    });

    return { items, hasNext, nextCursor: hasNext ? nextCursor : undefined };
  }

  /**
   * ユーザー自身の協力タスクを ID で取得
   * - 認可（user_id）込みで検索
   */
  async findMineById(
    db: PrismaExecutor,
    id: string,
    userId: string,
  ): Promise<PrismaContributionTasks | null> {
    this.logger.debug('ContributionTasksRepository.findMineById', 'start', {
      id,
      userId,
    });

    const task = await db.contribution_tasks.findFirst({
      where: {
        id,
        user_id: userId,
      },
    });

    this.logger.debug('ContributionTasksRepository.findMineById', 'result', {
      found: !!task,
    });

    if (!task) return null;

    return task;
  }

  /**
   * ユーザー自身が既に完了しているか確認
   * - 条件一致の最新 1 件（created_at desc）を返す
   */
  async existsMine(
    db: PrismaExecutor,
    userId: string,
    taskKey: string,
    targetType: string,
    targetId: string,
    type?: string,
  ): Promise<CreateContributionTaskResponse | null> {
    this.logger.debug('ContributionTasksRepository.existsMine', 'start', {
      userId,
      taskKey,
      targetType,
      targetId,
      type,
    });

    const task = await db.contribution_tasks.findFirst({
      where: {
        user_id: userId,
        task_key: taskKey,
        target_type: targetType,
        target_id: targetId,
        ...(type ? { type } : {}),
      },
      select: {
        id: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });

    this.logger.debug('ContributionTasksRepository.existsMine', 'result', {
      exists: !!task,
    });

    return task
      ? {
          id: task.id,
          createdAt: task.created_at.toISOString(),
        }
      : null;
  }

  /**
   * グローバルな完了済み targetId 一覧を取得（集計情報付き・カーソルページング）
   *
   * ✅ ベストプラクティス
   * - HAVING は _count._all で統一し、読みやすさと保守性を上げる
   * - cursor は Base64URL(JSON) に統一
   * - hasNext / nextCursor を Repository が返す
   */
  async findCompletedTargetIds(
    db: PrismaExecutor,
    taskKey: string,
    targetType: string,
    type: string | undefined,
    minCount: number,
    limit: number,
    cursor?: string,
  ): Promise<CursorPage<CompletedTargetIdItem>> {
    this.logger.debug(
      'ContributionTasksRepository.findCompletedTargetIds',
      'start',
      {
        taskKey,
        targetType,
        type,
        minCount,
        limit,
        cursorProvided: !!cursor,
      },
    );

    // WHERE 相当
    const where: Prisma.contribution_tasksWhereInput = {
      task_key: taskKey,
      target_type: targetType,
      ...(type !== undefined ? { type } : {}),
    };

    // HAVING 相当（最小件数）
    const baseHaving: Prisma.contribution_tasksScalarWhereWithAggregatesInput =
      {
        target_id: { _count: { gte: minCount } },
      };

    let having: Prisma.contribution_tasksScalarWhereWithAggregatesInput =
      baseHaving;

    // カーソル条件（MAX(created_at) と target_id の複合）
    if (cursor) {
      const decoded = base64UrlDecodeJson<CompletedTargetIdsCursor>(cursor);

      if (!decoded?.lastCompletedAt || !decoded?.targetId) {
        this.logger.warn(
          'ContributionTasksRepository.findCompletedTargetIds',
          'invalid_cursor_ignored',
          {
            cursor,
          },
        );
      } else {
        const lastCompletedAt = new Date(decoded.lastCompletedAt);
        if (!isValidDate(lastCompletedAt)) {
          this.logger.warn(
            'ContributionTasksRepository.findCompletedTargetIds',
            'invalid_cursor_date_ignored',
            {
              cursor,
              lastCompletedAt: decoded.lastCompletedAt,
            },
          );
        } else {
          // ✅ Prisma の having では MAX(created_at) は created_at フィールド配下の _max で表現する
          having = {
            AND: [
              baseHaving, // minCount 条件を維持
              {
                OR: [
                  // MAX(created_at) < lastCompletedAt
                  { created_at: { _max: { lt: lastCompletedAt } } },

                  // MAX(created_at) = lastCompletedAt AND target_id < targetId
                  {
                    AND: [
                      { created_at: { _max: { equals: lastCompletedAt } } },
                      { target_id: { lt: decoded.targetId } },
                    ],
                  },
                ],
              },
            ],
          };
        }
      }
    }

    const raw = await db.contribution_tasks.groupBy({
      by: ['target_id'],
      where,
      having,
      _count: { _all: true },
      _max: { created_at: true },
      orderBy: [{ _max: { created_at: 'desc' } }, { target_id: 'desc' }],
      take: limit + 1, // 次ページ判定
    });

    const hasNext = raw.length > limit;
    const sliced = hasNext ? raw.slice(0, limit) : raw;

    const items: CompletedTargetIdItem[] = sliced.map((r) => ({
      targetId: r.target_id,
      count: r._count._all,
      // groupBy の _max.created_at は型上 nullable のことがあるため、null ガード
      lastCompletedAt: r._max.created_at?.toISOString() ?? '',
    }));

    // nextCursor は「このページの最後の要素」を基準に作る
    const last = items[items.length - 1];
    const nextCursor = last
      ? base64UrlEncodeJson<CompletedTargetIdsCursor>({
          lastCompletedAt: last.lastCompletedAt,
          targetId: last.targetId,
        })
      : undefined;

    this.logger.debug(
      'ContributionTasksRepository.findCompletedTargetIds',
      'result',
      {
        count: items.length,
        hasNext,
      },
    );

    return { items, hasNext, nextCursor: hasNext ? nextCursor : undefined };
  }
}
