// api/src/tools/dish-categories/tools-dish-categories.service.ts
//
// Service for tools dish categories business logic
//

import { Injectable } from '@nestjs/common';
import { ToolsDishCategoriesRepository } from './tools-dish-categories.repository';
import { AppLoggerService } from '../../core/logger/logger.service';
import { StorageService } from '../../core/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { env } from '../../core/config/env';
import { UpdateDishCategoryImagesDto } from '@shared/v1/dto';
import {
  PopularDishCategoriesWithMediaResponse,
  PopularDishCategoryWithMedia,
  UpdateDishCategoryImagesResponse,
  UpdateDishCategoryImagesErrorResponse,
} from '@shared/v1/res';
import { convertPrismaToSupabase_DishCategories } from '../../../../shared/converters/convert_dish_categories';
import { convertPrismaToSupabase_DishMedia } from '../../../../shared/converters/convert_dish_media';

/** #494 【設計】候補メディア取得上限 */
const CANDIDATE_MEDIA_LIMIT = 42;
/** #494 【設計】人気カテゴリ取得上限 */
const POPULAR_CATEGORY_LIMIT = 42;

@Injectable()
export class ToolsDishCategoriesService {
  constructor(
    private readonly repo: ToolsDishCategoriesRepository,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * #494 【設計】人気カテゴリと候補メディア一覧を取得
   */
  async getPopularCategoriesWithMedia(): Promise<PopularDishCategoriesWithMediaResponse> {
    this.logger.debug(
      'GetPopularCategoriesWithMedia',
      'getPopularCategoriesWithMedia',
      {},
    );

    // 1. 人気カテゴリIDと件数を取得
    const popularRows =
      await this.repo.findPopularCategoriesWithWikimediaImages(
        POPULAR_CATEGORY_LIMIT,
      );

    if (popularRows.length === 0) {
      return [];
    }

    // 2. カテゴリ詳細を取得
    const categoryIds = popularRows.map((r) => r.dish_category_id);
    const categories = await this.repo.findDishCategoriesByIds(categoryIds);

    // IDからカテゴリへのマップを作成
    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    // 3. 各カテゴリの候補メディアを取得
    const result: PopularDishCategoryWithMedia[] = [];

    for (const row of popularRows) {
      const category = categoryMap.get(row.dish_category_id);
      if (!category) continue;

      const mediaList = await this.repo.findDishMediaByCategoryId(
        row.dish_category_id,
        CANDIDATE_MEDIA_LIMIT,
      );

      // メディアにCDN署名付きサムネイルURLを付与
      const candidateMedia = await Promise.all(
        mediaList.map(async (media) => {
          const thumbnailUrl = this.storage.generateCdnSignedURL(
            `https://${env.CDN_HOST}/${media.thumbnail_path}`,
          );
          return {
            ...convertPrismaToSupabase_DishMedia(media),
            thumbnailUrl,
          };
        }),
      );

      result.push({
        dishCategory: convertPrismaToSupabase_DishCategories(category),
        dishCount: Number(row.dish_count),
        candidateMedia,
      });
    }

    this.logger.debug(
      'PopularCategoriesWithMediaReturned',
      'getPopularCategoriesWithMedia',
      { count: result.length },
    );

    return result;
  }

  /**
   * #494 【設計】選択されたメディアでカテゴリ画像を一括更新
   * - トランザクションで全件処理、1件でも失敗したら全ロールバック
   * - メディアのサムネイルをGCS公開バケットにコピー
   */
  async updateCategoryImages(
    dto: UpdateDishCategoryImagesDto,
  ): Promise<
    UpdateDishCategoryImagesResponse | UpdateDishCategoryImagesErrorResponse
  > {
    this.logger.debug('UpdateCategoryImages', 'updateCategoryImages', {
      itemCount: dto.items.length,
    });

    try {
      // #494 【パフォーマンス】バッチでバリデーション用データを取得
      const mediaIds = dto.items.map((item) => item.dishMediaId);
      const categoryIds = dto.items.map((item) => item.dishCategoryId);

      const [mediaList, categoryList] = await Promise.all([
        this.repo.findDishMediaByIds(mediaIds),
        this.repo.findDishCategoriesByIds(categoryIds),
      ]);

      // マップを作成して検証
      const mediaMap = new Map(mediaList.map((m) => [m.id, m]));
      const categoryMap = new Map(categoryList.map((c) => [c.id, c]));

      const validationErrors: string[] = [];

      for (const item of dto.items) {
        if (!mediaMap.has(item.dishMediaId)) {
          validationErrors.push(`dish_media not found: ${item.dishMediaId}`);
        }
        if (!categoryMap.has(item.dishCategoryId)) {
          validationErrors.push(
            `dish_category not found: ${item.dishCategoryId}`,
          );
        }
      }

      if (validationErrors.length > 0) {
        return {
          success: false,
          error: {
            message: 'Validation failed',
            detail: validationErrors,
          },
        };
      }

      // トランザクションで一括更新
      const updatedCount = await this.prisma.withTransaction(async (tx) => {
        let count = 0;

        for (const item of dto.items) {
          // 事前にバリデーション済みなのでnon-nullアサーション
          const media = mediaMap.get(item.dishMediaId)!;

          // 新しい画像URLを構築（サムネイルパスをCDN URLに変換）
          const newImageUrl = `https://${env.CDN_HOST}/${media.thumbnail_path}`;

          // メタデータを構築
          const transferMetadata = {
            image_source: {
              type: 'dish_media',
              dish_media_id: item.dishMediaId,
              original_thumbnail_path: media.thumbnail_path,
            },
            image_transfer: {
              transferred_at: new Date().toISOString(),
            },
          };

          await this.repo.updateDishCategoryImage(
            tx,
            item.dishCategoryId,
            newImageUrl,
            transferMetadata,
          );

          count++;
        }

        return count;
      });

      this.logger.debug('CategoryImagesUpdated', 'updateCategoryImages', {
        updatedCount,
      });

      return {
        success: true,
        updatedCount,
      };
    } catch (error) {
      this.logger.error('UpdateCategoryImagesError', 'updateCategoryImages', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: {
          message:
            error instanceof Error ? error.message : 'Unknown error occurred',
        },
      };
    }
  }
}
