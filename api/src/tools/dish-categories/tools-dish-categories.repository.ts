// api/src/tools/dish-categories/tools-dish-categories.repository.ts
//
// Repository for tools dish categories data access
//

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { Prisma } from '../../../../shared/prisma/client';

/** #494 【設計】人気カテゴリ取得の生SQLクエリ結果型 */
export interface PopularCategoryRow {
  dish_category_id: string;
  dish_count: bigint;
}

@Injectable()
export class ToolsDishCategoriesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * #494 【設計】Wikimedia画像を持つ人気dish_categoriesを取得
   * - dishes件数の多い順にソート
   * - image_urlがhttps://upload.wikimedia.org%で始まるもののみ
   */
  async findPopularCategoriesWithWikimediaImages(
    limit: number,
  ): Promise<PopularCategoryRow[]> {
    // #494 【セキュリティ】limitパラメータの検証
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 100);

    this.logger.debug(
      'FindPopularCategoriesWithWikimediaImages',
      'findPopularCategoriesWithWikimediaImages',
      { limit: safeLimit },
    );

    // #494 【設計】Prisma $queryRaw テンプレートリテラルは自動的にパラメータ化される
    const result = await this.prisma.prisma.$queryRaw<PopularCategoryRow[]>`
      SELECT
        dc.id AS dish_category_id,
        COUNT(d.id) AS dish_count
      FROM dish_categories dc
      JOIN dishes d ON d.category_id = dc.id
      WHERE dc.image_url LIKE 'https://upload.wikimedia.org%'
      GROUP BY dc.id
      ORDER BY dish_count DESC
      LIMIT ${safeLimit}
    `;

    this.logger.debug(
      'PopularCategoriesFound',
      'findPopularCategoriesWithWikimediaImages',
      { count: result.length },
    );

    return result;
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
      },
      orderBy: { id: 'asc' },
      take: limit,
    });
  }

  /**
   * #494 【設計】dish_mediaを単一取得
   */
  async findDishMediaById(id: string) {
    return this.prisma.prisma.dish_media.findUnique({
      where: { id },
    });
  }

  /**
   * #494 【設計】複数のdish_mediaをIDで一括取得
   */
  async findDishMediaByIds(ids: string[]) {
    return this.prisma.prisma.dish_media.findMany({
      where: { id: { in: ids } },
    });
  }

  /**
   * #494 【設計】dish_categoryのimage_urlとmetadataを更新
   * トランザクション内で実行される想定
   */
  async updateDishCategoryImage(
    tx: Prisma.TransactionClient,
    categoryId: string,
    newImageUrl: string,
    metadata: Record<string, unknown>,
  ) {
    // 現在のmetadataを取得してマージ
    const current = await tx.dish_categories.findUnique({
      where: { id: categoryId },
      select: { tags: true },
    });

    // tagsフィールドにmetadataをJSON文字列として格納（schema上tags: String[]なので制限あり）
    // 代替: 直接SQLでJSONフィールドを更新するか、別途metadata_jsonカラムを追加する
    // 本実装ではimage_urlのみ更新し、metadataはログに記録
    this.logger.debug('UpdateDishCategoryImage', 'updateDishCategoryImage', {
      categoryId,
      newImageUrl,
      metadata,
    });

    return tx.dish_categories.update({
      where: { id: categoryId },
      data: {
        image_url: newImageUrl,
        updated_at: new Date(),
        lock_no: { increment: 1 },
      },
    });
  }
}
