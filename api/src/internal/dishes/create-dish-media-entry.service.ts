// api/src/internal/dishes/create-dish-media-entry.service.ts
//
// ❶ Cloud Tasks から呼び出される非同期処理の実装
// ❂ 責務: 写真ダウンロード + DB登録（分割されたロジック）
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { BulkImportJobPayload } from './bulk-import-job.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../core/storage/storage.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { DishesRepository } from '../../v1/dishes/dishes.repository';

@Injectable()
export class CreateDishMediaEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly logger: AppLoggerService,
    private readonly dishesRepository: DishesRepository,
  ) {}

  /**
   * 非同期ジョブの処理メイン関数
   */
  async processAsyncJob(payload: BulkImportJobPayload): Promise<void> {
    this.logger.debug('ProcessAsyncJob Started', 'processAsyncJob', {
      jobId: payload.jobId,
      photoUriCount: payload.photoUri.length,
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
      // 写真のダウンロードと保存を並列処理
      await this.downloadAndStorePhotos(payload);

      // 4テーブルのUPSERT処理
      await this.upsertDatabaseEntries(payload);

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
   * 写真のダウンロードと保存を並列処理
   */
  private async downloadAndStorePhotos(payload: BulkImportJobPayload): Promise<void> {
    const downloadPromises = payload.photoUri.map(async (photoUri, index) => {
      try {
        // 写真データを取得
        const response = await fetch(photoUri);
        if (!response.ok) {
          throw new Error(`Failed to download photo: ${response.status}`);
        }
        
        const buffer = Buffer.from(await response.arrayBuffer());
        
        // ストレージに保存
        const uploadResult = await this.storage.uploadFile({
          buffer,
          mimeType: 'image/jpeg',
          resourceType: 'dish_media',
          usageType: 'bulk_import',
          identifier: `${payload.jobId}-${index}`,
        });

        this.logger.debug('PhotoDownloaded', 'downloadAndStorePhotos', {
          originalUri: photoUri,
          uploadedPath: uploadResult.signedUrl,
        });

        return uploadResult.signedUrl;
      } catch (error) {
        this.logger.error('PhotoDownloadError', 'downloadAndStorePhotos', {
          photoUri,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // エラーでもフォールバックとして元のURIを返す
        return photoUri;
      }
    });

    await Promise.allSettled(downloadPromises);
  }

  /**
   * 4テーブルのUPSERT処理（dishesRepository を使用）
   */
  private async upsertDatabaseEntries(payload: BulkImportJobPayload): Promise<void> {
    await this.prisma.withTransaction(
      async (tx: Prisma.TransactionClient) => {
        // 1. レストラン登録（update: {} で既存データを保持）
        const restaurant = await this.dishesRepository.createOrGetRestaurant(
          tx,
          {
            id: payload.restaurants.google_place_id,
            displayName: { text: payload.restaurants.name },
            location: {
              latitude: payload.restaurants.latitude,
              longitude: payload.restaurants.longitude,
            }
          } as any,
          payload.restaurants.image_url,
        );

        // 2. 料理登録
        const dish = await this.dishesRepository.createOrGetDishForCategory(
          tx,
          restaurant.id,
          payload.dishes.category_id,
          payload.dishes.name || 'Unknown Dish',
        );

        // 3. 料理メディア登録
        if (payload.dish_media.media_path) {
          const dishMedia = await this.dishesRepository.createDishMedia(
            tx,
            dish.id,
            payload.dish_media.media_path,
          );
        }

        // 4. 料理レビュー登録
        for (const reviewData of payload.dish_reviews) {
          await this.dishesRepository.createDishReview(
            tx,
            dish.id,
            null, // dish_media_id は null でも可
            {
              text: { text: reviewData.comment },
              rating: reviewData.rating,
              originalText: { languageCode: reviewData.original_language_code },
              authorAttribution: {
                displayName: reviewData.imported_user_name || 'Anonymous',
                photoUri: reviewData.imported_user_avatar,
              },
            } as any,
          );
        }
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
