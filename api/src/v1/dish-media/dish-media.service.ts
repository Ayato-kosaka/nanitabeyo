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
import { TranscoderService } from '../../core/transcoder/transcoder.service';
import { env } from '../../core/config/env';
import { convertPrismaToSupabase_DishMedia } from '../../../../shared/converters/convert_dish_media';

@Injectable()
export class DishMediaService {
  constructor(
    private readonly repo: DishMediaRepository,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly notifier: NotifierService,
    private readonly logger: AppLoggerService,
    private readonly transcoder: TranscoderService,
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

    const result = await this.fetchDishMediaEntryItems(dishMediaIds, {
      userId: viewerId,
    });

    this.logger.debug('FindByCriteriaResult', 'findByCriteria', {
      count: result.items.length,
      hasCookies: !!result.cdnCookies,
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
      hasCookies: !!result.cdnCookies,
    });

    return { items: result.items, notFound, cdnCookies: result.cdnCookies };
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
  ): Promise<{ items: DishMediaEntryItem[]; cdnCookies?: string[] }> {
    if (!dishMediaIds.length) return { items: [] };

    const dishMediaEntries = await this.repo.getDishMediaEntriesByIds(
      dishMediaIds,
      option,
    );

    const cdnCookies: string[] = [];

    const dishMediaEntryItems = await mapWithConcurrency(
      dishMediaEntries,
      async (rec) => {
        const getMediaUrl = async () => {
          // For video media, generate CDN URL and collect cookies
          if (rec.dish_media.media_type === 'video') {
            // Build CDN URL for master.m3u8
            const cdnUrlPrefix = `https://${env.CDN_HOST}/${env.API_NODE_ENV}/transcoded/dish_media/media_path/${rec.dish_media.id}/`;

            // Generate and collect signed cookies
            const cookies = this.storage.generateCdnSignedCookies(
              cdnUrlPrefix,
              rec.dish_media.id,
            );
            if (cookies) {
              cdnCookies.push(...cookies);
            }

            return `${cdnUrlPrefix}master.m3u8`;
          } else {
            // For images, use existing resized image logic
            return await this.storage.getOrQueueResizedSignedUrl(
              {
                table: 'dish_media',
                column: 'media_path',
                recordId: rec.dish_media.id,
                size: 1024,
              },
              rec.dish_media.media_path,
            );
          }
        };
        const [mediaUrl, thumbnailImageUrl] = await Promise.all([
          getMediaUrl(),
          this.storage.getOrQueueResizedSignedUrl(
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

    return {
      items: dishMediaEntryItems,
      cdnCookies: cdnCookies.length > 0 ? cdnCookies : undefined,
    };
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

    // video の場合のみトランスコードジョブを直接作成
    if (dto.mediaType === 'video') {
      const inputUri = `gs://${env.GCS_BUCKET_NAME}/${dto.mediaPath}`;
      const outputUri = `gs://${env.GCS_BUCKET_NAME}/${env.API_NODE_ENV}/transcoded/dish_media/media_path/${result.id}/`;

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
    }

    return convertPrismaToSupabase_DishMedia(result);
  }

  /* ------------------------------------------------------------------ */
  /*                     POST /v1/dish-media/view                       */
  /* ------------------------------------------------------------------ */
  async createDishMediaView(dto: {
    impression_id?: string | null;
    dish_media_id: string;
    user_id?: string | null;
    started_at?: string;
    watch_ms: number;
    is_completed: boolean;
    is_skipped: boolean;
    rewatch_count: number;
  }) {
    this.logger.debug('CreateDishMediaView', 'createDishMediaView', {
      dish_media_id: dto.dish_media_id,
      user_id: dto.user_id,
      watch_ms: dto.watch_ms,
      is_completed: dto.is_completed,
      is_skipped: dto.is_skipped,
    });

    // Validation: cannot be both completed and skipped
    if (dto.is_completed && dto.is_skipped) {
      throw new Error('View cannot be both completed and skipped');
    }

    const result = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.createDishMediaView(tx, {
          impression_id: dto.impression_id,
          dish_media_id: dto.dish_media_id,
          user_id: dto.user_id,
          started_at: dto.started_at ? new Date(dto.started_at) : undefined,
          watch_ms: dto.watch_ms,
          is_completed: dto.is_completed,
          is_skipped: dto.is_skipped,
          rewatch_count: dto.rewatch_count,
        }),
    );

    this.logger.log('DishMediaViewCreated', 'createDishMediaView', {
      viewId: result.id,
      dish_media_id: dto.dish_media_id,
    });

    return {
      id: result.id,
      dish_media_id: result.dish_media_id,
      impression_id: result.impression_id,
      stored: true,
      analysis_applied: true,
    };
  }
}
