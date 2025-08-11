// api/src/internal/bulk-import/bulk-import-executor.service.ts
//
// ❶ Cloud Tasks から呼び出される非同期処理の実装（シンプル化）
// ❂ 責務: 写真ダウンロード + 基本的な4テーブルUPSERT
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
      placesCount: payload.places.length,
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
      // Google Places データを並列処理
      await this.processPlaces(payload);

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
   * Google Places データを処理（写真ダウンロード + DB登録）
   */
  private async processPlaces(payload: BulkImportJobPayload): Promise<void> {
    const processPromises = payload.places.map(async (place, index) => {
      try {
        // 1. 写真をダウンロード・保存
        let finalPhotoUrl = '';
        const photoName = payload.contextualContents?.[index]?.photos?.[0]?.name;
        if (photoName) {
          const photoMedia = await this.locationsService.getPhotoMedia(photoName);
          if (photoMedia) {
            try {
              const photoResponse = await this.locationsService.downloadPhotoData(photoMedia.photoUri);
              const uploadResult = await this.storage.uploadFile({
                buffer: photoResponse.data,
                mimeType: 'image/jpeg',
                resourceType: 'dish_media',
                usageType: 'bulk_import',
                identifier: `${payload.jobId}-${place.id}`,
              });
              finalPhotoUrl = uploadResult.signedUrl;
            } catch (error) {
              this.logger.error('PhotoDownloadError', 'processPlaces', {
                placeId: place.id,
                photoName,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
              // 写真エラーでも処理は継続
              finalPhotoUrl = photoMedia.photoUri; // フォールバック
            }
          }
        }

        // 2. データベース登録（トランザクション内）
        await this.prisma.withTransaction(async (tx: Prisma.TransactionClient) => {
          // レストラン登録
          const restaurant = await tx.restaurants.upsert({
            where: { google_place_id: place.id },
            update: {
              name: place.displayName?.text || 'Unknown Restaurant',
              latitude: place.location?.latitude || 0,
              longitude: place.location?.longitude || 0,
              image_url: finalPhotoUrl,
            },
            create: {
              google_place_id: place.id,
              name: place.displayName?.text || 'Unknown Restaurant',
              latitude: place.location?.latitude || 0,
              longitude: place.location?.longitude || 0,
              image_url: finalPhotoUrl,
            },
          });

          // 料理登録
          let dish = await tx.dishes.findFirst({
            where: {
              restaurant_id: restaurant.id,
              category_id: payload.categoryId,
            },
          });

          if (dish) {
            dish = await tx.dishes.update({
              where: { id: dish.id },
              data: { name: payload.categoryName },
            });
          } else {
            dish = await tx.dishes.create({
              data: {
                restaurant_id: restaurant.id,
                category_id: payload.categoryId,
                name: payload.categoryName,
              },
            });
          }

          // 料理メディア登録
          if (finalPhotoUrl) {
            await tx.dish_media.create({
              data: {
                dish_id: dish.id,
                media_path: finalPhotoUrl,
                media_type: 'photo',
                thumbnail_path: finalPhotoUrl,
              },
            }).catch(() => {
              // 既に存在する場合はスキップ
            });
          }

          // 料理レビュー登録
          if (place.reviews && place.reviews.length > 0) {
            for (const review of place.reviews) {
              await tx.dish_reviews.create({
                data: {
                  dish_id: dish.id,
                  comment: review.text?.text || '',
                  rating: review.rating || 0,
                  original_language_code: review.originalText?.languageCode || payload.languageCode,
                  imported_user_name: review.authorAttribution?.displayName || 'Anonymous',
                  imported_user_avatar: review.authorAttribution?.photoUri,
                },
              }).catch(() => {
                // 既に存在する場合はスキップ
              });
            }
          }
        });

        this.logger.debug('PlaceProcessed', 'processPlaces', {
          placeId: place.id,
          photoUrl: finalPhotoUrl,
        });
      } catch (error) {
        this.logger.error('PlaceProcessError', 'processPlaces', {
          placeId: place.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // 個別のplace処理エラーは全体を停止させない
      }
    });

    await Promise.allSettled(processPromises);
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