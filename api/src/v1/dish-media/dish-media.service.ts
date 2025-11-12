// api/src/modules/dish-media/dish-media.service.ts
//
// ❶ Controller から渡される DTO を受け取り Repository・Storage・Notifier を編成
// ❷ 1 メソッド = 1 ユースケース（トランザクション／ロギング込み）
// ❸ “副作用” は出来るだけ Service で完結させ、Controller は薄く保つ
//

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';

import {
  CreateDishMediaDto,
  CreateDishMediaViewDto,
  DishMediaImpressionBodyDto,
  ReactionActionType,
  SearchDishMediaDto,
} from '@shared/v1/dto';

import { DishMediaRepository } from './dish-media.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { TranscoderService } from '../../core/transcoder/transcoder.service';
import { env } from '../../core/config/env';
import { convertPrismaToSupabase_DishMedia } from '../../../../shared/converters/convert_dish_media';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import {
  buildTranscodedPath,
  isValidUserUploadedPath,
} from 'src/core/storage/storage.utils';
import { DishMediaAssembler } from './dish-media.assembler';
import { DishMediaEntry } from '@shared/v1/res';

@Injectable()
export class DishMediaService {
  constructor(
    private readonly repo: DishMediaRepository,
    private readonly assembler: DishMediaAssembler,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly transcoder: TranscoderService,
    private readonly cloudTasks: CloudTasksService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                     GET /v1/dish-media/search                      */
  /* ------------------------------------------------------------------ */
  async findByCriteria(dto: SearchDishMediaDto, userId: string) {
    this.logger.debug('FindByCriteria', 'findByCriteria', {
      location: dto.location,
      radius: dto.radius,
      categoryId: dto.categoryId,
      userId,
    });

    const dishMediaIds = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.findDishMediaIds(tx, dto, userId),
    );

    const result = await this.fetchDishMediaEntryItems(dishMediaIds, {
      userId,
    });

    this.logger.debug('FindByCriteriaResult', 'findByCriteria', {
      count: result.items.length,
    });
    return result;
  }

  /* ------------------------------------------------------------------ */
  /*                    GET /v1/dish-media?ids=...                      */
  /* ------------------------------------------------------------------ */
  async findByIds(ids: string[], viewerId?: string) {
    this.logger.debug('FindByIds', 'findByIds', {
      count: ids.length,
      viewer: viewerId ?? 'anon',
    });

    const result = await this.fetchDishMediaEntryItems(ids, {
      userId: viewerId,
    });

    const foundSet = new Set(result.items.map((item) => item.dish_media.id));
    const notFound = ids.filter((id) => !foundSet.has(id));

    this.logger.debug('FindByIdsResult', 'findByIds', {
      count: result.items.length,
      notFound: notFound.length,
    });

    return { items: result.items, notFound };
  }

  /**
   * dishMediaIds から DishMediaEntryItem[] を取得し、
   * 署名付き URL, CDN URL郡 を付与
   */
  public async fetchDishMediaEntryItems(
    dishMediaIds: string[],
    option: {
      userId?: string;
      reviewLimit?: number;
    },
  ): Promise<{ items: DishMediaEntry[] }> {
    if (!dishMediaIds.length) return { items: [] };

    const dishMediaEntries = await this.repo.getDishMediaEntriesByIds(
      dishMediaIds,
      option,
    );

    return this.assembler.toDishMediaEntry(dishMediaEntries);
  }

  /* ------------------------------------------------------------------ */
  /*                     POST /v1/dish-media (投稿)                     */
  /* ------------------------------------------------------------------ */
  async createDishMedia(dto: CreateDishMediaDto, creatorId: string) {
    this.logger.debug('CreateDishMedia', 'createDishMedia', {
      dishId: dto.dishId,
      userId: creatorId,
      mediaType: dto.mediaType,
    });

    // dishId が存在するか簡易バリデーション
    const dishExists = await this.repo.dishExists(dto.dishId);
    if (!dishExists) {
      this.logger.warn('DishNotFound', 'createDishMedia', {
        dishId: dto.dishId,
      });
      throw new NotFoundException('Dish not found');
    }

    // #セキュリティ 【検証】ユーザーアップロード領域に限る
    if (!isValidUserUploadedPath(dto.mediaPath, creatorId))
      throw new NotFoundException('Invalid mediaPath');

    // トランザクションで dish_media + 付随レコード作成
    const result = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.createDishMedia(tx, dto, creatorId, dto.thumbnailPath),
    );

    this.logger.log('DishMediaCreated', 'createDishMedia', {
      mediaId: result.id,
      dishId: dto.dishId,
      mediaType: dto.mediaType,
    });

    if (dto.mediaType === 'video') {
      // video の場合、トランスコードジョブを直接作成
      const inputUri = `gs://${env.GCS_BUCKET_NAME}/${dto.mediaPath}`;
      const outputUri = `gs://${buildTranscodedPath({
        table: 'dish_media',
        column: 'media_path',
        recordId: result.id,
        originalPath: dto.mediaPath,
      }).replace(/\/master\.m3u8$/, '/')}`; // ディレクトリパスにするため末尾の master.m3u8 を削除

      await this.transcoder.createTranscodeJob({
        inputUri,
        outputUri,
        recordId: result.id,
      });

      this.logger.log('TranscodeJobCreated', 'createDishMedia', {
        mediaId: result.id,
        inputUri: dto.mediaPath,
        outputUri,
      });
    } else {
      // 画像のリサイズと保存を実行（投稿メディアのフルスクリーン表示用）
      await this.cloudTasks.enqueueResizeImage({
        table: 'dish_media',
        column: 'media_path',
        recordId: result.id,
        size: 1024,
        aspectRatio: 9 / 16,
        originalPath: dto.mediaPath,
      });
    }

    // 画像のリサイズと保存を実行（サムネイル用）
    await this.cloudTasks.enqueueResizeImage({
      table: 'dish_media',
      column: 'thumbnail_path',
      recordId: result.id,
      size: 256,
      aspectRatio: 9 / 16,
      originalPath: dto.thumbnailPath,
    });

    return convertPrismaToSupabase_DishMedia(result);
  }

  /* ------------------------------------------------------------------ */
  /*                     POST /v1/dish-media/view                       */
  /* ------------------------------------------------------------------ */
  async createDishMediaView(
    dish_media_id: string,
    dto: CreateDishMediaViewDto,
    user_id: string,
  ) {
    // Validation: cannot be both completed and skipped
    if (dto.is_completed && dto.is_skipped) {
      throw new Error('View cannot be both completed and skipped');
    }

    const result = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.createDishMediaView(tx, {
          impression_id: dto.impression_id,
          dish_media_id,
          user_id,
          started_at: dto.started_at,
          watch_ms: dto.watch_ms,
          is_completed: dto.is_completed,
          is_skipped: dto.is_skipped,
          rewatch_count: dto.rewatch_count,
        }),
    );

    return {
      id: result.id,
      dish_media_id: result.dish_media_id,
      impression_id: result.impression_id,
      stored: true,
      analysis_applied: true,
    };
  }

  /* ------------------------------------------------------------------ */
  /*              POST /v1/dish-media/:id/reaction                      */
  /* ------------------------------------------------------------------ */
  async addReaction(
    dishMediaId: string,
    actionType: ReactionActionType,
    userId: string,
    isAnonymous: boolean,
  ) {
    await this.prisma.withTransaction((tx: Prisma.TransactionClient) =>
      this.repo.toggleReaction(tx, true, isAnonymous, {
        target_id: dishMediaId,
        action_type: actionType,
        user_id: userId,
      }),
    );

    // #通知機能 【設計】like/save 成功時に Cloud Tasks にジョブ投入（匿名ユーザーは除外）
    if (!isAnonymous && (actionType === 'like' || actionType === 'save')) {
      const idempotencyKey = `dish_media:${actionType}:${dishMediaId}`;
      this.cloudTasks
        .enqueueNotification({
          actionType,
          targetTable: 'dish_media',
          targetId: dishMediaId,
          actorId: userId,
          idempotencyKey,
        })
        .catch((error) => {
          this.logger.error('EnqueueNotificationFailed', 'addReaction', {
            dishMediaId,
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      this.logger.debug('NotificationJobEnqueued', 'addReaction', {
        actionType,
        dishMediaId,
        userId,
        idempotencyKey,
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /*              DELETE /v1/dish-media/:id/reaction                    */
  /* ------------------------------------------------------------------ */
  async removeReaction(
    dishMediaId: string,
    actionType: ReactionActionType,
    userId: string,
    isAnonymous: boolean,
  ) {
    await this.prisma.withTransaction((tx: Prisma.TransactionClient) =>
      this.repo.toggleReaction(tx, false, isAnonymous, {
        target_id: dishMediaId,
        action_type: actionType,
        user_id: userId,
      }),
    );
  }

  /* ------------------------------------------------------------------ */
  /*              POST /v1/dish-media/:id/impression                    */
  /* ------------------------------------------------------------------ */
  async addImpression(
    dish_media_id: string,
    user_id: string,
    dto: DishMediaImpressionBodyDto,
  ) {
    await this.prisma.withTransaction((tx: Prisma.TransactionClient) =>
      this.repo.addImpression(tx, { ...dto, dish_media_id, user_id }),
    );
  }
}
