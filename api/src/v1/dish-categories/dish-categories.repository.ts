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
  ) { }

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
              in: categoryNames.map(name => name.toLowerCase()), // Ensure case-insensitive search
            },
          },
        },
      },
      include: {
        dish_category_variants: {
          where: {
            surface_form: {
              in: categoryNames.map(name => name.toLowerCase()), // Ensure case-insensitive search
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
}
