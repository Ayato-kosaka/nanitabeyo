// api/src/internal/dishes/create-dish-media-entry.service.ts
//
// ❶ Cloud Tasks から呼び出される非同期処理の実装
// ❂ 責務: 写真ダウンロード + DB登録（分割されたロジック）
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { CreateDishMediaEntryJobPayload } from './create-dish-media-entry.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../core/storage/storage.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { DishesRepository } from '../../v1/dishes/dishes.repository';
import {
  convertSupabaseToPrisma_Restaurants,
  PrismaRestaurants,
} from '../../../../shared/converters/convert_restaurants';
import { convertSupabaseToPrisma_Dishes } from '../../../../shared/converters/convert_dishes';
import {
  convertSupabaseToPrisma_DishMedia,
  PrismaDishMedia,
} from '../../../../shared/converters/convert_dish_media';
import { convertSupabaseToPrisma_DishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { CloudTasksService } from 'src/core/cloud-tasks/cloud-tasks.service';

@Injectable()
export class CreateDishMediaEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly logger: AppLoggerService,
    private readonly dishesRepository: DishesRepository,
    private readonly cloudTasksService: CloudTasksService,
  ) { }

  /**
   * 非同期ジョブの処理メイン関数
   */
  async processAsyncJob(
    payload: CreateDishMediaEntryJobPayload,
  ): Promise<void> {
    this.logger.debug('ProcessAsyncJob Started', 'processAsyncJob', {
      jobId: payload.jobId,
    });

    // 冪等性チェック: 既に処理済みかどうか確認
    const isAlreadyProcessed = await this.checkIdempotency(
      payload.idempotencyKey,
    );
    if (isAlreadyProcessed) {
      this.logger.log('JobAlreadyProcessed', 'processAsyncJob', {
        jobId: payload.jobId,
        idempotencyKey: payload.idempotencyKey,
      });
      return;
    }

    try {
      // 4テーブルのUPSERT処理
      const { restaurant, dishMedia } =
        await this.upsertDatabaseEntries(payload);

      // 画像リサイズの非同期ジョブをキューに投入
      await this.enqueueResizeImageJob(dishMedia, restaurant);

      // 冪等性キーを記録（処理完了マーク）
      await this.markJobCompleted(payload.idempotencyKey);

      this.logger.log('ProcessAsyncJob Completed', 'processAsyncJob', {
        jobId: payload.jobId,
        idempotencyKey: payload.idempotencyKey,
      });
    } catch (error) {
      this.logger.error('ProcessAsyncJob Error', 'processAsyncJob', {
        jobId: payload.jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * 画像リサイズの非同期ジョブをキューに投入
   */
  private async enqueueResizeImageJob(
    dishMedia: PrismaDishMedia,
    restaurants: PrismaRestaurants,
  ) {
    return Promise.all([
      // サムネイル画像リサイズジョブ
      this.cloudTasksService
        .enqueueResizeImage({
          table: 'dish_media',
          column: 'thumbnail_path',
          recordId: dishMedia.id,
          size: 256,
          aspectRatio: 9 / 16,
          originalPath: dishMedia.thumbnail_path,
        })
        .catch((error) => {
          this.logger.error(
            'EnqueueResizeThumbnailError',
            'createDishMediaEntry',
            {
              dishMediaId: dishMedia.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          );
          throw error;
        }),
      restaurants.image_path &&
      this.cloudTasksService
        .enqueueResizeImage({
          table: 'restaurants',
          column: 'image_path',
          recordId: restaurants.id,
          size: 256,
          aspectRatio: 9 / 16,
          originalPath: restaurants.image_path,
        })
        .catch((error) => {
          this.logger.error(
            'EnqueueResizeRestaurantImageError',
            'createDishMediaEntry',
            {
              restaurantId: restaurants.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          );
          throw error;
        }),
      restaurants.image_path &&
      this.cloudTasksService
        .enqueueResizeImage({
          table: 'restaurants',
          column: 'image_path',
          recordId: restaurants.id,
          size: 64,
          aspectRatio: 9 / 16,
          originalPath: restaurants.image_path,
        })
        .catch((error) => {
          this.logger.error(
            'EnqueueResizeRestaurantImageError',
            'createDishMediaEntry',
            {
              restaurantId: restaurants.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          );
          throw error;
        }),
    ]);
  }

  /**
   * 4テーブルのUPSERT処理（dishesRepository を使用）
   */
  private async upsertDatabaseEntries(payload: CreateDishMediaEntryJobPayload) {
    return await this.prisma.withTransaction(
      async (tx: Prisma.TransactionClient) => {
        // 1. レストラン登録
        const restaurant = await this.dishesRepository.createOrGetRestaurant(
          tx,
          convertSupabaseToPrisma_Restaurants(payload.restaurants),
          payload.restaurants.google_place_id!,
        );

        // 2. 料理登録
        const dish = await this.dishesRepository.createOrGetDishForCategory(
          tx,
          {
            ...convertSupabaseToPrisma_Dishes(payload.dishes),
            restaurant_id: restaurant.id,
          },
        );

        // 3. 料理メディア登録
        const dishMedia = await this.dishesRepository.createDishMedia(
          tx,
          convertSupabaseToPrisma_DishMedia({
            ...payload.dish_media,
            dish_id: dish.id,
          }),
        );

        // 4. 料理レビュー登録
        const dishReciews = await this.dishesRepository.createDishReviews(
          tx,
          payload.dish_reviews.map((review) => ({
            ...convertSupabaseToPrisma_DishReviews(review),
            dish_id: dish.id,
          })),
        );

        return { restaurant, dish, dishMedia, dishReciews };
      },
    );
  }

  /**
   * 冪等性チェック: 既に処理済みかどうか確認
   */
  private async checkIdempotency(idempotencyKey: string): Promise<boolean> {
    // TODO: Redis や専用テーブルで冪等性キーを管理
    // 現在は簡略化実装
    return false;
  }

  /**
   * ジョブ完了マーク
   */
  private async markJobCompleted(idempotencyKey: string): Promise<void> {
    // TODO: Redis や専用テーブルに完了マークを記録
    this.logger.debug('JobMarkCompleted', 'markJobCompleted', {
      idempotencyKey,
    });
  }
}
