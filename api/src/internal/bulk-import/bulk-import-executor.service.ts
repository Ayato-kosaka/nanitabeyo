// api/src/internal/bulk-import/bulk-import-executor.service.ts
//
// ❶ Cloud Tasks から呼び出される非同期処理の実装
// ❷ 写真の実体取得・保存と 4テーブルUPSERT
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { BulkImportJobPayload } from './bulk-import-job.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../core/storage/storage.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { LocationsService } from '../../v1/locations/locations.service';

@Injectable()
export class BulkImportExecutorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly logger: AppLoggerService,
    private readonly locationsService: LocationsService,
  ) {}

  /**
   * 非同期ジョブの処理メイン関数
   */
  async processAsyncJob(payload: BulkImportJobPayload): Promise<void> {
    this.logger.debug('ProcessAsyncJob Started', 'processAsyncJob', {
      jobId: payload.jobId,
      photoUrisCount: payload.photoUris.length,
    });

    // 冪等性チェック: 既に処理済みかどうか確認
    const isAlreadyProcessed = await this.checkIdempotency(payload.idempotencyKey);
    if (isAlreadyProcessed) {
      this.logger.log('JobAlreadyProcessed', 'processAsyncJob', {
        jobId: payload.jobId,
        idempotencyKey: payload.idempotencyKey,
      });
      return;
    }

    try {
      // 1. 写真の並列ダウンロード・保存
      const photoUrls = await this.downloadAndStorePhotos(payload.photoUris);

      // 2. トランザクション内で4テーブルのUPSERT
      await this.prisma.withTransaction(async (tx: Prisma.TransactionClient) => {
        await this.upsertAllData(tx, payload, photoUrls);
      });

      // 3. 冪等性キーを記録（処理完了マーク）
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
   * 写真URIを並列でダウンロードし、ストレージに保存
   */
  private async downloadAndStorePhotos(photoUris: string[]): Promise<Map<string, string>> {
    const photoUrlMap = new Map<string, string>();

    const downloadPromises = photoUris.map(async (photoUri) => {
      try {
        // Google Maps Photo API から実際のバイナリデータを取得
        const photoResponse = await this.locationsService.downloadPhotoData(photoUri);
        
        // ストレージにアップロード
        const uploadResult = await this.storage.uploadFile({
          buffer: photoResponse.data,
          mimeType: 'image/jpeg',
          resourceType: 'dish_media',
          usageType: 'bulk_import',
          identifier: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        });
        const storageUrl = uploadResult.signedUrl;
        
        photoUrlMap.set(photoUri, storageUrl);
        
        this.logger.debug('PhotoDownloadedAndStored', 'downloadAndStorePhotos', {
          originalUri: photoUri,
          storageUrl,
        });
      } catch (error) {
        this.logger.error('PhotoDownloadError', 'downloadAndStorePhotos', {
          photoUri,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // 写真のエラーは処理を停止させない
        photoUrlMap.set(photoUri, photoUri); // フォールバック: 元のURIを使用
      }
    });

    await Promise.allSettled(downloadPromises);
    return photoUrlMap;
  }

  /**
   * 4テーブルのUPSERT処理
   */
  private async upsertAllData(
    tx: Prisma.TransactionClient,
    payload: BulkImportJobPayload,
    photoUrls: Map<string, string>,
  ): Promise<void> {
    // 1. レストランテーブルのUPSERT
    for (const restaurant of payload.restaurants) {
      const finalPhotoUrl = restaurant.photo_uri 
        ? (photoUrls.get(restaurant.photo_uri) || restaurant.photo_uri)
        : null;

      await tx.restaurants.upsert({
        where: { google_place_id: restaurant.place_id },
        update: {
          name: restaurant.name,
          latitude: restaurant.location_lat || 0,
          longitude: restaurant.location_lng || 0,
          image_url: finalPhotoUrl || '',
        },
        create: {
          google_place_id: restaurant.place_id,
          name: restaurant.name,
          latitude: restaurant.location_lat || 0,
          longitude: restaurant.location_lng || 0,
          image_url: finalPhotoUrl || '',
        },
      });
    }

    // 2. 料理テーブルのUPSERT
    for (const dish of payload.dishes) {
      const restaurant = await tx.restaurants.findUnique({
        where: { google_place_id: dish.restaurant_place_id },
      });
      if (!restaurant) continue;

      await tx.dishes.upsert({
        where: {
          id: `${restaurant.id}-${dish.category_id}`, // 複合キーの代わりに仮のUUID
        },
        update: {
          name: dish.name,
        },
        create: {
          restaurant_id: restaurant.id,
          category_id: dish.category_id,
          name: dish.name,
        },
      }).catch(async () => {
        // upsert に失敗した場合は findFirst で検索して更新
        const existingDish = await tx.dishes.findFirst({
          where: {
            restaurant_id: restaurant.id,
            category_id: dish.category_id,
          },
        });
        
        if (existingDish) {
          await tx.dishes.update({
            where: { id: existingDish.id },
            data: { name: dish.name },
          });
        } else {
          await tx.dishes.create({
            data: {
              restaurant_id: restaurant.id,
              category_id: dish.category_id,
              name: dish.name,
            },
          });
        }
      });
    }

    // 3. 料理メディアテーブルのUPSERT
    for (const dishMedia of payload.dish_media) {
      const restaurant = await tx.restaurants.findUnique({
        where: { google_place_id: dishMedia.restaurant_place_id },
      });
      if (!restaurant) continue;

      const dish = await tx.dishes.findFirst({
        where: {
          restaurant_id: restaurant.id,
          category_id: dishMedia.category_id,
        },
      });
      if (!dish) continue;

      const finalPhotoUrl = photoUrls.get(dishMedia.photo_uri) || dishMedia.photo_uri;

      // dish_media テーブルは media_path, media_type, thumbnail_path が必要
      await tx.dish_media.create({
        data: {
          dish_id: dish.id,
          media_path: finalPhotoUrl,
          media_type: dishMedia.media_type,
          thumbnail_path: finalPhotoUrl, // 同じURLを使用
        },
      }).catch(() => {
        // 既に存在する場合はスキップ
      });
    }

    // 4. 料理レビューテーブルのUPSERT
    for (const dishReview of payload.dish_reviews) {
      const restaurant = await tx.restaurants.findUnique({
        where: { google_place_id: dishReview.restaurant_place_id },
      });
      if (!restaurant) continue;

      const dish = await tx.dishes.findFirst({
        where: {
          restaurant_id: restaurant.id,
          category_id: dishReview.category_id,
        },
      });
      if (!dish) continue;

      // dish_reviews テーブルは comment, original_language_code が必要
      await tx.dish_reviews.create({
        data: {
          dish_id: dish.id,
          comment: dishReview.text || '',
          rating: dishReview.rating,
          original_language_code: dishReview.original_language_code || 'en',
          imported_user_name: dishReview.author_name || 'Anonymous',
          imported_user_avatar: dishReview.profile_photo_url,
        },
      }).catch(() => {
        // 既に存在する場合はスキップ
      });
    }
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
    this.logger.debug('JobMarkCompleted', 'markJobCompleted', { idempotencyKey });
  }
}