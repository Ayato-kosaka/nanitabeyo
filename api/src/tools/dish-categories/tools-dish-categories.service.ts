// api/src/tools/dish-categories/tools-dish-categories.service.ts
//
// Service for tools dish categories business logic
//

import { Injectable } from '@nestjs/common';
import { ToolsDishCategoriesRepository } from './tools-dish-categories.repository';
import { AppLoggerService } from '../../core/logger/logger.service';
import { StorageService } from '../../core/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateDishCategoryImagesDto } from '@shared/v1/dto';
import {
  PopularDishCategoriesWithMediaResponse,
  PopularDishCategoryWithMedia,
  UpdateDishCategoryImagesResponse,
  UpdateDishCategoryImagesErrorResponse,
} from '@shared/v1/res';
import { convertPrismaToSupabase_DishCategories } from '../../../../shared/converters/convert_dish_categories';
import { convertPrismaToSupabase_DishMedia } from '../../../../shared/converters/convert_dish_media';
import { buildResizedPath } from 'src/core/storage/storage.utils';

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
    // 1. 人気カテゴリIDと件数を取得
    const POPULAR_CATEGORY_LIMIT = 21;
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
    const CANDIDATE_MEDIA_LIMIT = 21;

    for (const row of popularRows) {
      const category = categoryMap.get(row.dish_category_id);
      if (!category) continue;

      const mediaList = await this.repo.findDishMediaByCategoryId(
        row.dish_category_id,
        CANDIDATE_MEDIA_LIMIT,
      );

      // メディアにCDN署名付きサムネイルURLを付与
      const candidateMedia = mediaList.map((media) => {
        const mediaSignedUrl = this.storage.generateCdnSignedURL(
          buildResizedPath(
            {
              table: 'dish_media',
              column: 'media_path',
              recordId: media.id,
              size: 1024,
              originalPath: media.media_path,
            },
            'cdn',
          ),
        );
        return {
          ...convertPrismaToSupabase_DishMedia(media),
          mediaSignedUrl,
        };
      });

      const Supabase_DishCategories =
        convertPrismaToSupabase_DishCategories(category);

      result.push({
        dishCategory: {
          id: Supabase_DishCategories.id,
          image_url: Supabase_DishCategories.image_url,
          name:
            Supabase_DishCategories.labels?.['ja'] ||
            Supabase_DishCategories.label_en,
        },
        dishCount: Number(row.dish_count),
        candidateMedia: candidateMedia.map((cm) => ({
          id: cm.id,
          mediaSignedUrl: cm.mediaSignedUrl,
        })),
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
        } else if (
          mediaMap.get(item.dishMediaId)?.dishes.category_id !==
          item.dishCategoryId
        ) {
          validationErrors.push(
            `dish_media ${item.dishMediaId} is not linked to category ${item.dishCategoryId}`,
          );
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

      // private バケットから public バケットへコピー
      // その後の処理でエラーが生じた場合、コピー先のオブジェクトが残るが許容する
      const updateDataList = await Promise.all(
        dto.items
          // Wikimedia画像のみ更新対象とする（後から制約を緩めてもOK）
          .filter((item) =>
            categoryMap
              .get(item.dishCategoryId)
              ?.image_url.startsWith('https://upload.wikimedia.org'),
          )
          .map(async (item) => {
            const media = mediaMap.get(item.dishMediaId)!;

            const sourcePath = buildResizedPath({
              table: 'dish_media',
              column: 'media_path',
              recordId: media.id,
              size: 1024,
              originalPath: media.media_path,
            });

            // メタデータを構築
            const transferMetadata = {
              source_type: 'dish_media',
              source_dish_media_id: item.dishMediaId,
              source_path: sourcePath,
              transferred_at: new Date().toISOString(),
            };

            const { publicUrl } = await this.storage.copyToPublic(
              sourcePath,
              `transferred/dish_categories/image_url/${item.dishCategoryId}/${media.id}/1024.webp`,
              { metadata: transferMetadata },
            );
            return { ...item, newImageUrl: publicUrl };
          }),
      );

      // トランザクションで一括更新
      const updatedCount = await this.prisma.withTransaction(async (tx) => {
        let count = 0;

        for (const item of updateDataList) {
          await this.repo.updateDishCategoryImage(
            tx,
            item.dishCategoryId,
            item.newImageUrl,
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
