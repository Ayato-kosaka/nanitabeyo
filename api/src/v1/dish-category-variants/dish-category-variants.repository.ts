// api/src/v1/dish-category-variants/dish-category-variants.repository.ts
//
// Repository for dish category variants data access
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';

@Injectable()
export class DishCategoryVariantsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * 料理カテゴリ表記揺れを検索
   */
  async findDishCategoryVariants(q: string, lang?: string) {
    this.logger.debug('FindDishCategoryVariants', 'findDishCategoryVariants', {
      q,
      lang,
    });

    const result = await this.prisma.prisma.dish_categories.findMany({
      where: {
        dish_category_variants: {
          some: {
            surface_form: {
              startsWith: q,
            },
          },
        },
      },
      include: {
        dish_category_variants: {
          where: {
            surface_form: {
              startsWith: q,
            },
          },
        },
      },
      take: 20, // limit 20
    });

    this.logger.debug('DishCategoryVariantsFound', 'findDishCategoryVariants', {
      count: result.length,
    });
    return result;
  }

  /**
   * surface_form で料理カテゴリ表記揺れを検索
   */
  async findDishCategoryVariantBySurfaceForm(surfaceForm: string) {
    this.logger.debug(
      'FindVariantBySurfaceForm',
      'findDishCategoryVariantBySurfaceForm',
      {
        surfaceForm,
      },
    );

    const result = await this.prisma.prisma.dish_category_variants.findUnique({
      where: {
        surface_form: surfaceForm,
      },
      include: {
        dish_categories: true,
      },
    });

    this.logger.debug('VariantFound', 'findDishCategoryVariantBySurfaceForm', {
      found: !!result,
    });
    return result;
  }

  /**
   * 料理カテゴリ表記揺れを作成
   */
  async createDishCategoryVariant(
    tx: Prisma.TransactionClient,
    dishCategoryId: string,
    surfaceForm: string,
    source?: string,
  ) {
    this.logger.debug(
      'CreateDishCategoryVariant',
      'createDishCategoryVariant',
      {
        dishCategoryId,
        surfaceForm,
        source,
      },
    );

    const result = await tx.dish_category_variants.create({
      data: {
        dish_category_id: dishCategoryId,
        surface_form: surfaceForm,
        source: source,
      },
    });

    this.logger.debug(
      'DishCategoryVariantCreated',
      'createDishCategoryVariant',
      {
        id: result.id,
      },
    );
    return result;
  }

  /**
   * QID で料理カテゴリを検索
   */
  async findDishCategoryByQid(qid: string) {
    this.logger.debug('FindDishCategoryByQid', 'findDishCategoryByQid', {
      qid,
    });

    // まずIDとして直接検索
    let result = await this.prisma.prisma.dish_categories.findUnique({
      where: {
        id: qid,
      },
    });

    // IDで見つからない場合は、tagsでQIDを検索
    if (!result) {
      const categories = await this.prisma.prisma.dish_categories.findMany({
        where: {
          tags: {
            has: qid,
          },
        },
      });
      result = categories.length > 0 ? categories[0] : null;
    }

    this.logger.debug('DishCategoryByQidFound', 'findDishCategoryByQid', {
      found: !!result,
    });
    return result;
  }

  /**
   * 料理カテゴリ一覧を取得
   */
  async getDishCategories() {
    this.logger.debug('GetDishCategories', 'getDishCategories', {});

    const result = await this.prisma.prisma.dish_categories.findMany();

    this.logger.debug('DishCategoriesFound', 'getDishCategories', {
      count: result.length,
    });
    return result;
  }
}
