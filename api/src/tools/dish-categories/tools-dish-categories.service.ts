// api/src/tools/dish-categories/tools-dish-categories.service.ts
//
// Service for tools dish categories business logic
//

import { Injectable } from '@nestjs/common';
import { ToolsDishCategoriesRepository } from './tools-dish-categories.repository';
import { AppLoggerService } from '../../core/logger/logger.service';
import { StorageService } from '../../core/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PopularDishCategoriesWithMediaResponse,
  PopularDishCategoryWithMedia,
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
      const candidateMedia = mediaList
        .map((media) => {
          // #1395 render_type='external_embed' の行は media_path が NULL で、
          // 自ストレージにリサイズ済みの実体が無い。署名 URL を作れないので
          // 代表画像の候補から外す
          if (media.media_path === null) return null;
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
        })
        .filter((cm): cm is NonNullable<typeof cm> => cm !== null);

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
}
