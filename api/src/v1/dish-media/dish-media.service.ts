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
  QueryDishMediaDto,
} from '@shared/v1/dto';

import { DishMediaRepository } from './dish-media.repository';
import { StorageService } from '../../core/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotifierService } from '../../core/notifier/notifier.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { reverse } from 'dns';
import { DishMediaEntryItem } from './dish-media.mapper';

@Injectable()
export class DishMediaService {
  constructor(
    private readonly repo: DishMediaRepository,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly notifier: NotifierService,
    private readonly logger: AppLoggerService,
  ) { }

  /* ------------------------------------------------------------------ */
  /*                         GET /v1/dish-media                         */
  /* ------------------------------------------------------------------ */
  async findByCriteria(dto: QueryDishMediaDto, viewerId?: string) {
    this.logger.debug('FindByCriteria', 'findByCriteria', {
      location: dto.location,
      radius: dto.radius,
      categoryId: dto.categoryId,
      viewer: viewerId ?? 'anon',
    });

    const dishMediaIds = await this.repo.findDishMediaIds(dto, viewerId);

    const dishMediaEntryItems = await this.fetchDishMediaEntryItems(dishMediaIds, viewerId);

    this.logger.debug('FindByCriteriaResult', 'findByCriteria', {
      count: dishMediaEntryItems.length,
    });
    return dishMediaEntryItems;
  }

  /**
   * dishMediaIds から DishMediaEntryItem[] を取得し署名付き URL を付与
   */
  async fetchDishMediaEntryItems(
    dishMediaIds: string[],
    viewerId?: string,
  ): Promise<DishMediaEntryItem[]> {
    if (!dishMediaIds.length) return [];

    const dishMediaEntries = await this.repo.getDishMediaEntriesByIds(dishMediaIds, { userId: viewerId });

    const dishMediaEntryItems = await Promise.all<DishMediaEntryItem>(
      dishMediaEntries.map(async (rec) => {
        const mediaUrl = await this.storage.generateSignedUrl(rec.dish_media.media_path);
        const thumbnailImageUrl = await this.storage.generateSignedUrl(rec.dish_media.thumbnail_path);
        return {
          ...rec,
          dish_media: {
            ...rec.dish_media,
            mediaUrl,
            thumbnailImageUrl,
          },
        };
      }),
    ).then(list => list.filter((v): v is NonNullable<typeof v> => !!v));

    return dishMediaEntryItems;
  }

  /* ------------------------------------------------------------------ */
  /*            POST /v1/dish-media/:id/likes/:userId (いいね)           */
  /* ------------------------------------------------------------------ */
  async likeDishMedia({ id, userId }: LikeDishMediaParamsDto) {
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

  /* --------------------- DELETE /v1/dish-media/:id/likes/:userId ------------------ */
  async unlikeDishMedia({ id, userId }: LikeDishMediaParamsDto) {
    this.logger.verbose('UnlikeDishMedia', 'unlikeDishMedia', { id, userId });
    await this.repo.unlikeDishMedia(id, userId);
  }

  /* --------------------- POST /v1/dish-media/:id/save/:userId --------------------- */
  async saveDishMedia({ id, userId }: SaveDishMediaParamsDto) {
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
        this.repo.createDishMedia(
          tx,
          dto,
          creatorId,
          dto.mediaPath, // TODO: video の場合は差胸を作る
        ),
    );

    this.logger.log('DishMediaCreated', 'createDishMedia', {
      mediaId: result.id,
      dishId: dto.dishId,
    });
  }
}
