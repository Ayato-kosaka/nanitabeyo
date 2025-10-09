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
  LikeDishMediaParamsDto,
  SaveDishMediaParamsDto,
  SearchDishMediaDto,
} from '@shared/v1/dto';

import { DishMediaRepository } from './dish-media.repository';
import { StorageService } from '../../core/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotifierService } from '../../core/notifier/notifier.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { DishMediaEntryItem } from './dish-media.mapper';
import { mapWithConcurrency } from 'src/core/utils/backend-utils';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import { MediaType } from '@shared/v1/dto';
import { env } from '../../core/config/env';

@Injectable()
export class DishMediaService {
  constructor(
    private readonly repo: DishMediaRepository,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly notifier: NotifierService,
    private readonly logger: AppLoggerService,
    private readonly cloudTasks: CloudTasksService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                     GET /v1/dish-media/search                      */
  /* ------------------------------------------------------------------ */
  async findByCriteria(dto: SearchDishMediaDto, viewerId?: string) {
    this.logger.debug('FindByCriteria', 'findByCriteria', {
      location: dto.location,
      radius: dto.radius,
      categoryId: dto.categoryId,
      viewer: viewerId ?? 'anon',
    });

    const dishMediaIds = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.findDishMediaIds(tx, dto, viewerId),
    );

    const dishMediaEntryItems = await this.fetchDishMediaEntryItems(
      dishMediaIds,
      {
        userId: viewerId,
      },
    );

    this.logger.debug('FindByCriteriaResult', 'findByCriteria', {
      count: dishMediaEntryItems.length,
    });
    return dishMediaEntryItems;
  }

  /* ------------------------------------------------------------------ */
  /*                    GET /v1/dish-media?ids=...                      */
  /* ------------------------------------------------------------------ */
  async findByIds(ids: string[], viewerId?: string) {
    this.logger.debug('FindByIds', 'findByIds', {
      count: ids.length,
      viewer: viewerId ?? 'anon',
    });

    const items = await this.fetchDishMediaEntryItems(ids, {
      userId: viewerId,
    });

    const foundSet = new Set(items.map((item) => item.dish_media.id));
    const notFound = ids.filter((id) => !foundSet.has(id));

    this.logger.debug('FindByIdsResult', 'findByIds', {
      count: items.length,
      notFound: notFound.length,
    });

    return { items, notFound };
  }

  /**
   * dishMediaIds から DishMediaEntryItem[] を取得し署名付き URL を付与
   */
  public async fetchDishMediaEntryItems(
    dishMediaIds: string[],
    option: {
      userId?: string;
      reviewLimit?: number;
    },
  ): Promise<DishMediaEntryItem[]> {
    if (!dishMediaIds.length) return [];

    const dishMediaEntries = await this.repo.getDishMediaEntriesByIds(
      dishMediaIds,
      option,
    );

    const dishMediaEntryItems = await mapWithConcurrency(
      dishMediaEntries,
      async (rec) => {
        const [mediaUrl, thumbnailImageUrl] = await Promise.all([
          await this.storage.getOrQueueResizedSignedUrl(
            {
              table: 'dish_media',
              column: 'media_path',
              recordId: rec.dish_media.id,
              size: 1024,
            },
            rec.dish_media.media_path,
          ),
          await this.storage.getOrQueueResizedSignedUrl(
            {
              table: 'dish_media',
              column: 'thumbnail_path',
              recordId: rec.dish_media.id,
              size: 256,
            },
            rec.dish_media.thumbnail_path,
          ),
        ]);
        return {
          ...rec,
          dish_media: {
            ...rec.dish_media,
            mediaUrl,
            thumbnailImageUrl,
          },
        };
      },
      12, // concurrency
    ).then((list) => list.filter((v): v is NonNullable<typeof v> => !!v));

    return dishMediaEntryItems;
  }

  /* ------------------------------------------------------------------ */
  /*            POST /v1/dish-media/:id/likes (いいね)                   */
  /* ------------------------------------------------------------------ */
  async likeDishMedia({ id }: LikeDishMediaParamsDto, userId: string) {
    this.logger.verbose('LikeDishMedia', 'likeDishMedia', { id, userId });
    await this.repo.likeDishMedia(id, userId);

    // 非同期通知（失敗してもレスポンスに影響させない）
    // TODO: 通知系見直し
    // this.notifier
    //     .sendPush(id, userId)
    //     .catch((err) =>
    //         this.logger.warn(`Push like notification failed: ${err.message}`),
    // );
  }

  /* --------------------- DELETE /v1/dish-media/:id/likes ------------------ */
  async unlikeDishMedia({ id }: LikeDishMediaParamsDto, userId: string) {
    this.logger.verbose('UnlikeDishMedia', 'unlikeDishMedia', { id, userId });
    await this.repo.unlikeDishMedia(id, userId);
  }

  /* --------------------- POST /v1/dish-media/:id/save --------------------- */
  async saveDishMedia({ id }: SaveDishMediaParamsDto, userId: string) {
    this.logger.verbose('SaveDishMedia', 'saveDishMedia', { id, userId });
    await this.repo.saveDishMedia(id, userId);

    // TODO: 通知系見直し
    // this.notifier
    //     .pushSaveNotification(id, userId)
    //     .catch((err) =>
    //         this.logger.warn(`Push save notification failed: ${err.message}`),
    //     );
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

    // thumbnailPath の決定
    let thumbnailPath: string;

    if (dto.mediaType === MediaType.VIDEO) {
      // VIDEO の場合: thumbnailPath は必須
      if (!dto.thumbnailPath) {
        throw new Error('thumbnailPath is required for VIDEO media type');
      }
      thumbnailPath = dto.thumbnailPath;
    } else {
      // IMAGE の場合: thumbnailPath が省略されていれば mediaPath を使用
      thumbnailPath = dto.thumbnailPath || dto.mediaPath;
    }

    // トランザクションで dish_media + 付随レコード作成
    const result = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.createDishMedia(tx, dto, creatorId, thumbnailPath),
    );

    this.logger.log('DishMediaCreated', 'createDishMedia', {
      mediaId: result.id,
      dishId: dto.dishId,
      mediaType: dto.mediaType,
    });

    // VIDEO の場合のみトランスコードジョブをキューに投入
    if (dto.mediaType === MediaType.VIDEO) {
      const outputUri = `gs://${env.GCS_BUCKET_NAME}/transcoded/dish_media/media_path/${result.id}/`;

      await this.cloudTasks.enqueueTranscodeJob({
        inputUri: dto.mediaPath,
        outputUri,
        recordId: result.id,
      });

      this.logger.log('TranscodeJobEnqueued', 'createDishMedia', {
        mediaId: result.id,
        inputUri: dto.mediaPath,
        outputUri,
      });
    }
  }
}
