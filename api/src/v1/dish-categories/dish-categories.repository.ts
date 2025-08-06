// api/src/v1/dish-categories/dish-categories.repository.ts
//
// Repository for dish categories data access
//

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DishCategoriesRepository {
  private readonly logger = new Logger(DishCategoriesRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * カテゴリ名リストから料理カテゴリを検索
   */
  async findDishCategoriesByNames(categoryNames: string[]) {
    this.logger.debug(`Finding dish categories for: ${categoryNames.join(', ')}`);

    const result = await this.prisma.dish_categories.findMany({
      where: {
        dish_category_variants: {
          some: {
            surface_form: {
              in: categoryNames,
            },
          },
        },
      },
      include: {
        dish_category_variants: {
          where: {
            surface_form: {
              in: categoryNames,
            },
          },
        },
      },
    });

    this.logger.debug(`Found ${result.length} dish categories`);
    return result;
  }
}