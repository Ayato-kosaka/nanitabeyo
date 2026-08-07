// api/src/ops/resize-image/ops-resize-image.service.ts
//
// #514 【設計】運用操作 - 失敗したリサイズジョブの再実行
//
// 恒久失敗（原本 404 / 壊れた JPEG）としてキューから取り除いた分を、
// 原本を差し替えた後などに再実行するための経路。
// 対象は必ず recordId で明示指定し、全件再実行はできない。
//

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import {
  ReEnqueueResizeImageDto,
  ReEnqueueResizeImageTargetDto,
} from '@shared/v1/dto';
import {
  ReEnqueueResizeImageResponse,
  ReEnqueueResizeImageResult,
} from '@shared/v1/res';

type ResizeSize = 64 | 256 | 512 | 1024;

/**
 * table/column ごとの既定サイズと aspectRatio。
 * 本番の enqueue 元（restaurants / dish-media / users / create-dish-media-entry）に合わせる。
 * ここに無い組み合わせは受け付けない。
 */
const RESIZE_TARGET_SPECS: Record<
  string,
  { sizes: ResizeSize[]; aspectRatio?: number }
> = {
  'restaurants.image_path': { sizes: [256, 64], aspectRatio: 9 / 16 },
  'dish_media.media_path': { sizes: [1024], aspectRatio: 9 / 16 },
  'dish_media.thumbnail_path': { sizes: [256], aspectRatio: 9 / 16 },
  'users.avatar_path': { sizes: [256, 64] },
};

export const SUPPORTED_RESIZE_TARGET_KEYS = Object.keys(RESIZE_TARGET_SPECS);

@Injectable()
export class OpsResizeImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudTasks: CloudTasksService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * 明示指定された recordId のリサイズジョブを再 enqueue する
   */
  async reEnqueue(
    dto: ReEnqueueResizeImageDto,
  ): Promise<ReEnqueueResizeImageResponse> {
    this.logger.log('ReEnqueueResizeImageStarted', 'reEnqueue', {
      requestedTargets: dto.targets.length,
    });

    const results: ReEnqueueResizeImageResult[] = [];

    for (const target of dto.targets) {
      results.push(await this.reEnqueueOne(target));
    }

    const enqueuedTasks = results.reduce(
      (sum, r) => sum + r.enqueuedSizes.length,
      0,
    );

    this.logger.log('ReEnqueueResizeImageCompleted', 'reEnqueue', {
      requestedTargets: dto.targets.length,
      enqueuedTasks,
      skipped: results.filter((r) => r.status !== 'enqueued').length,
    });

    return {
      requestedTargets: dto.targets.length,
      enqueuedTasks,
      results,
    };
  }

  private async reEnqueueOne(
    target: ReEnqueueResizeImageTargetDto,
  ): Promise<ReEnqueueResizeImageResult> {
    const key = `${target.table}.${target.column}`;
    const spec = RESIZE_TARGET_SPECS[key];

    const base = {
      table: target.table,
      column: target.column,
      recordId: target.recordId,
      enqueuedSizes: [] as number[],
    };

    if (!spec) {
      return {
        ...base,
        status: 'failed',
        reason: `Unsupported table/column: ${key}`,
      };
    }

    const originalPath = await this.findOriginalPath(target);

    if (originalPath === undefined) {
      return { ...base, status: 'skipped_record_not_found' };
    }
    if (!originalPath) {
      return { ...base, status: 'skipped_original_path_empty' };
    }

    // 明示指定があればそれだけ、無ければ既定サイズ一式
    const sizes = target.sizes ?? spec.sizes;

    // ⚠️ 成功したサイズを 1 件ずつ記録すること（レビュー指摘）。
    // restaurants / users の既定サイズは 2 件あるので、1 件目が成功して 2 件目が失敗すると、
    // 「Cloud Task は既に作られているのに enqueuedSizes が空」という結果になる。
    // それを見た運用者が再実行すると、成功済みのサイズまで重複投入される。
    const enqueuedSizes: number[] = [];

    try {
      for (const size of sizes) {
        await this.cloudTasks.enqueueResizeImage({
          table: target.table,
          column: target.column,
          recordId: target.recordId,
          size,
          ...(spec.aspectRatio ? { aspectRatio: spec.aspectRatio } : {}),
          originalPath,
        });
        enqueuedSizes.push(size);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('ReEnqueueResizeImageError', 'reEnqueue', {
        ...base,
        enqueuedSizes,
        remainingSizes: sizes.filter((size) => !enqueuedSizes.includes(size)),
        error: reason,
      });
      return {
        ...base,
        // 1 件も投入できていなければ完全な失敗、途中まで投入できていれば部分成功として区別する。
        // 再実行するときは remainingSizes（下の reason にも出す）だけを sizes へ指定すること
        status: enqueuedSizes.length > 0 ? 'partially_enqueued' : 'failed',
        enqueuedSizes,
        reason:
          enqueuedSizes.length > 0
            ? `${reason}（投入済み: ${enqueuedSizes.join(', ')} / 未投入: ${sizes
                .filter((size) => !enqueuedSizes.includes(size))
                .join(', ')}）`
            : reason,
      };
    }

    return { ...base, status: 'enqueued', enqueuedSizes };
  }

  /**
   * 原本パスを取得する
   * @returns undefined = レコードなし / null | '' = パス未設定 / string = パス
   */
  private async findOriginalPath(
    target: ReEnqueueResizeImageTargetDto,
  ): Promise<string | null | undefined> {
    const where = { id: target.recordId };

    switch (target.table) {
      case 'restaurants': {
        const row = await this.prisma.prisma.restaurants.findUnique({
          where,
          select: { image_path: true },
        });
        return row ? row.image_path : undefined;
      }
      case 'dish_media': {
        const row = await this.prisma.prisma.dish_media.findUnique({
          where,
          select: { media_path: true, thumbnail_path: true },
        });
        if (!row) return undefined;
        return target.column === 'media_path'
          ? row.media_path
          : row.thumbnail_path;
      }
      case 'users': {
        const row = await this.prisma.prisma.users.findUnique({
          where,
          select: { avatar_path: true },
        });
        return row ? row.avatar_path : undefined;
      }
    }
  }
}
