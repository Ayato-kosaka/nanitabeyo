// api/src/v1/dish-categories/dish-categories.repository.ts
//
// Repository for dish categories data access
//

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';

@Injectable()
export class DishCategoriesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  async findDishCategoryById(id: string) {
    this.logger.debug('FindDishCategoryById', 'findDishCategoryById', { id });

    const result = await this.prisma.prisma.dish_categories.findUnique({
      where: { id },
    });

    return result;
  }

  /**
   * カテゴリ名リストから料理カテゴリを検索
   */
  async findDishCategoriesByNames(categoryNames: string[]) {
    this.logger.debug(
      'FindDishCategoriesByNames',
      'findDishCategoriesByNames',
      {
        categoryNames,
      },
    );

    const result = await this.prisma.prisma.dish_categories.findMany({
      where: {
        dish_category_variants: {
          some: {
            surface_form: {
              in: categoryNames.map((name) => name.toLowerCase()), // Ensure case-insensitive search
            },
          },
        },
      },
      include: {
        dish_category_variants: {
          where: {
            surface_form: {
              in: categoryNames.map((name) => name.toLowerCase()), // Ensure case-insensitive search
            },
          },
        },
      },
    });

    this.logger.debug('DishCategoriesFound', 'findDishCategoriesByNames', {
      count: result.length,
    });
    return result;
  }

  /**
   * ユーザーが保存した料理カテゴリを取得 (moved from UsersRepository)
   */
  async findDishCategoriesBySavedUser(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: Awaited<
      ReturnType<typeof this.prisma.prisma.dish_categories.findMany>
    >;
    nextCursor: string | null;
  }> {
    this.logger.debug(
      'findDishCategoriesBySavedUser',
      'findDishCategoriesBySavedUser',
      { userId, cursor, limit },
    );

    const whereClause: any = {
      user_id: userId,
      target_type: 'dish_categories',
      action_type: 'save',
    };
    if (cursor) {
      whereClause.created_at = { lt: new Date(cursor) };
    }

    const savedEntries = await this.prisma.prisma.reactions.findMany({
      where: whereClause,
      orderBy: { created_at: 'desc' },
      take: limit + 1,
    });

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = savedEntries.length > limit;
    const entries = hasMore ? savedEntries.slice(0, limit) : savedEntries;
    const nextCursor =
      hasMore && entries.length > 0
        ? entries[entries.length - 1].created_at.toISOString()
        : null;

    const categoryIds = entries.map((e) => e.target_id);
    const result = await this.prisma.prisma.dish_categories.findMany({
      where: { id: { in: categoryIds } },
    });

    this.logger.debug(
      'UserSavedDishCategoriesFound',
      'findDishCategoriesBySavedUser',
      { count: result.length, hasMore },
    );

    return { items: result, nextCursor };
  }
}
