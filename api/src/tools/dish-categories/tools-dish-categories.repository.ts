// api/src/tools/dish-categories/tools-dish-categories.repository.ts
//
// Repository for tools dish categories data access
//

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { Prisma } from '../../../../shared/prisma/client';
import { RemoteConfigService } from 'src/core/remote-config/remote-config.service';

@Injectable()
export class ToolsDishCategoriesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly remoteConfigService: RemoteConfigService,
  ) {}

  /**
   * #494 【設計】Wikimedia画像を持つ人気dish_categoriesを取得
   * - dishes件数の多い順にソート
   * - image_urlがhttps://upload.wikimedia.org%で始まるもののみ
   */
  async findPopularCategoriesWithWikimediaImages(limit: number): Promise<
    {
      dish_category_id: string;
      dish_count: number;
    }[]
  > {
    // 【セキュリティ】limitパラメータの検証
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 100);

    const EXCLUDED_CATEGORY_IDS_STRING: string =
      await this.remoteConfigService.getRemoteConfigValue(
        'TOOLS_DISH_CATEGORIES_POPULAR_EXCLUDED_CATEGORY_IDS',
      );

    // #494 【設計】Prisma $queryRaw テンプレートリテラルは自動的にパラメータ化される
    const result = await this.prisma.prisma.dishes.groupBy({
      by: ['category_id'],
      where: {
        dish_categories: {
          image_url: {
            startsWith: 'https://upload.wikimedia.org',
          },
          id: {
            notIn: EXCLUDED_CATEGORY_IDS_STRING.split(',').map((s) => s.trim()),
          },
        },
      },
      _count: {
        _all: true,
      },
      orderBy: {
        _count: {
          category_id: 'desc',
        },
      },
      take: safeLimit,
    });

    this.logger.debug(
      'PopularCategoriesFound',
      'findPopularCategoriesWithWikimediaImages',
      { count: result.length, safeLimit, EXCLUDED_CATEGORY_IDS_STRING },
    );

    return result.map((r) => ({
      dish_category_id: r.category_id,
      dish_count: r._count._all,
    }));
  }

  /**
   * #494 【設計】指定IDのdish_categoriesを取得
   */
  async findDishCategoriesByIds(ids: string[]) {
    return this.prisma.prisma.dish_categories.findMany({
      where: { id: { in: ids } },
    });
  }

  /**
   * #494 【設計】指定カテゴリIDに紐づくdish_mediaを取得
   * - dishes経由で紐づくメディア
   * - 最大limit件
   */
  async findDishMediaByCategoryId(categoryId: string, limit: number) {
    return this.prisma.prisma.dish_media.findMany({
      where: {
        dishes: {
          category_id: categoryId,
        },
        deleted_at: null, // #1513 削除済みの投稿はカテゴリ画像の候補にしない
      },
      orderBy: { id: 'asc' },
      take: limit,
    });
  }

  /**
   * #494 【設計】複数のdish_mediaをIDで一括取得
   */
  async findDishMediaByIds(ids: string[]) {
    return this.prisma.prisma.dish_media.findMany({
      where: { id: { in: ids }, deleted_at: null }, // #1513
      include: { dishes: true },
    });
  }
}
