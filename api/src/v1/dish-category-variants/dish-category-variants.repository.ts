// api/src/v1/dish-category-variants/dish-category-variants.repository.ts
//
// Repository for dish category variants data access
//

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DishCategoryVariantsRepository {
  private readonly logger = new Logger(DishCategoryVariantsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 料理カテゴリ表記揺れを検索
   */
  async findDishCategoryVariants(q: string, lang?: string) {
    this.logger.debug(`Finding dish category variants for: ${q}, lang: ${lang}`);

    const result = await this.prisma.dish_categories.findMany({
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

    this.logger.debug(`Found ${result.length} dish category variants`);
    return result;
  }

  /**
   * surface_form で料理カテゴリ表記揺れを検索
   */
  async findDishCategoryVariantBySurfaceForm(surfaceForm: string) {
    this.logger.debug(`Finding dish category variant by surface form: ${surfaceForm}`);

    const result = await this.prisma.dish_category_variants.findUnique({
      where: {
        surface_form: surfaceForm,
      },
      include: {
        dish_categories: true,
      },
    });

    this.logger.debug(`Found variant: ${result ? 'yes' : 'no'}`);
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
    this.logger.debug(`Creating dish category variant: ${surfaceForm} -> ${dishCategoryId}`);

    const result = await tx.dish_category_variants.create({
      data: {
        dish_category_id: dishCategoryId,
        surface_form: surfaceForm,
        source: source,
      },
    });

    this.logger.debug(`Created variant: ${result.id}`);
    return result;
  }

  /**
   * 料理カテゴリ一覧を取得
   */
  async getDishCategories() {
    this.logger.debug('Getting dish categories');

    const result = await this.prisma.dish_categories.findMany();

    this.logger.debug(`Found ${result.length} dish categories`);
    return result;
  }
}