// api/src/v1/dish-category-variants/dish-category-variants.service.ts
//
// Service for dish category variants business logic
//

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import {
  QueryDishCategoryVariantsDto,
  CreateDishCategoryVariantDto,
} from '@shared/v1/dto';
import { QueryDishCategoryVariantsResponse } from '@shared/v1/res';

import { DishCategoryVariantsRepository } from './dish-category-variants.repository';
import { ExternalApiService } from '../../core/external-api/external-api.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaDishCategories } from '../../../../shared/converters/convert_dish_categories';
import { AppLoggerService } from '../../core/logger/logger.service';

@Injectable()
export class DishCategoryVariantsService {
  constructor(
    private readonly repo: DishCategoryVariantsRepository,
    private readonly externalApiService: ExternalApiService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) { }

  /**
   * 料理カテゴリ表記揺れを検索
   */
  async findDishCategoryVariants(
    dto: QueryDishCategoryVariantsDto,
  ): Promise<QueryDishCategoryVariantsResponse> {
    this.logger.debug(
      'FindDishCategoryVariants',
      'findDishCategoryVariants',
      dto,
    );

    const dishCategories = await this.repo.findDishCategoryVariants(
      dto.q,
    );

    // レスポンス形式に変換 - 最大20件まで
    const response: QueryDishCategoryVariantsResponse = [];

    for (const category of dishCategories) {
      if (response.length >= 20) break;

      for (const variant of category.dish_category_variants) {
        void variant;
        if (response.length >= 20) break;

        // category.labels[lang] を使用（フォールバックあり）
        const labels = category.labels as Record<string, string>;
        const label =
          dto.lang && labels[dto.lang] ? labels[dto.lang] : category.label_en;

        response.push({
          dishCategoryId: category.id,
          label: label,
        });
      }
    }

    this.logger.debug(
      'DishCategoryVariantsReturned',
      'findDishCategoryVariants',
      {
        count: response.length,
      },
    );
    return response;
  }

  /**
   * 料理カテゴリ表記揺れを登録
   */
  async createDishCategoryVariant(
    dto: CreateDishCategoryVariantDto,
  ): Promise<PrismaDishCategories> {
    this.logger.debug(
      'CreateDishCategoryVariant',
      'createDishCategoryVariant',
      dto,
    );

    // まず直接検索
    let foundVariant = await this.repo.findDishCategoryVariantBySurfaceForm(
      dto.name,
    );

    if (foundVariant) {
      this.logger.debug('DirectMatchFound', 'createDishCategoryVariant', {});
      return foundVariant.dish_categories;
    }

    // Wikidata で検索（CLS情報を渡す）
    const wikidataResult = await this.externalApiService.searchWikidata(
      dto.name,
    );
    if (wikidataResult) {
      // Wikidata結果のQIDから対応するDish Categoryを探す
      const categoryByQid = await this.repo.findDishCategoryByQid(
        wikidataResult.qid,
      );
      if (!categoryByQid) {
        throw new InternalServerErrorException(
          `No dish category found for Wikidata QID: ${wikidataResult.qid}`,
        );
      }
      // 新しい表記揺れを登録
      await this.prisma.withTransaction(
        async (tx: Prisma.TransactionClient) => {
          await this.repo.createDishCategoryVariant(
            tx,
            categoryByQid.id,
            dto.name,
            'wikidata_qid_match',
          );
        },
      );

      return categoryByQid;
    }

    // Google Custom Search でスペルチェック（CLS情報を渡す）
    const correctedSpelling =
      await this.externalApiService.getCorrectedSpelling(dto.name);
    if (correctedSpelling) {
      foundVariant =
        await this.repo.findDishCategoryVariantBySurfaceForm(correctedSpelling);
      if (foundVariant) {
        this.logger.debug(
          'CorrectedSpellingMatchFound',
          'createDishCategoryVariant',
          {},
        );

        // 新しい表記揺れを登録
        await this.prisma.withTransaction(
          async (tx: Prisma.TransactionClient) => {
            await this.repo.createDishCategoryVariant(
              tx,
              foundVariant!.dish_categories.id,
              dto.name,
              'google_spelling_correction',
            );
          },
        );

        return foundVariant.dish_categories;
      }
    }

    // ヒットなし
    this.logger.warn('NoMatchFound', 'createDishCategoryVariant', {
      name: dto.name,
    });
    throw new InternalServerErrorException('No matching dish category found');
  }
}
