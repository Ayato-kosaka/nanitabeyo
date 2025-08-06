// api/src/v1/dish-category-variants/dish-category-variants.service.ts
//
// Service for dish category variants business logic
//

import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import {
  QueryDishCategoryVariantsDto,
  CreateDishCategoryVariantDto,
} from '@shared/v1/dto';
import {
  QueryDishCategoryVariantsResponse,
  CreateDishCategoryVariantResponse,
} from '@shared/v1/res';

import { DishCategoryVariantsRepository } from './dish-category-variants.repository';
import { ExternalApiService } from '../../core/external-api/external-api.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DishCategoryVariantsService {
  private readonly logger = new Logger(DishCategoryVariantsService.name);

  constructor(
    private readonly repo: DishCategoryVariantsRepository,
    private readonly externalApiService: ExternalApiService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 料理カテゴリ表記揺れを検索
   */
  async findDishCategoryVariants(
    dto: QueryDishCategoryVariantsDto,
  ): Promise<QueryDishCategoryVariantsResponse> {
    this.logger.debug('Finding dish category variants', dto);

    const dishCategories = await this.repo.findDishCategoryVariants(dto.q, dto.lang);

    // レスポンス形式に変換 - 最大20件まで
    const response: QueryDishCategoryVariantsResponse = [];
    
    for (const category of dishCategories) {
      if (response.length >= 20) break;
      
      for (const variant of category.dish_category_variants) {
        if (response.length >= 20) break;
        
        // category.labels[lang] を使用（フォールバックあり）
        const labels = category.labels as Record<string, string>;
        const label = dto.lang && labels[dto.lang] ? labels[dto.lang] : category.label_en;
        
        response.push({
          dishCategoryId: category.id,
          label: label,
        });
      }
    }

    this.logger.debug(`Returning ${response.length} variants`);
    return response;
  }

  /**
   * 料理カテゴリ表記揺れを登録
   */
  async createDishCategoryVariant(
    dto: CreateDishCategoryVariantDto,
  ): Promise<CreateDishCategoryVariantResponse> {
    this.logger.debug('Creating dish category variant', dto);

    // まず直接検索
    let foundVariant = await this.repo.findDishCategoryVariantBySurfaceForm(dto.name);
    
    if (foundVariant) {
      this.logger.debug('Direct match found');
      return [foundVariant.dish_categories];
    }

    // Wikidata で検索
    const wikidataResult = await this.externalApiService.searchWikidata(dto.name);
    if (wikidataResult) {
      foundVariant = await this.repo.findDishCategoryVariantBySurfaceForm(wikidataResult.label);
      if (foundVariant) {
        this.logger.debug('Wikidata match found');
        return [foundVariant.dish_categories];
      }
      
      // Wikidata結果のQIDから対応するDish Categoryを探す
      const categoryByQid = await this.repo.findDishCategoryByQid(wikidataResult.qid);
      if (categoryByQid) {
        this.logger.debug('Creating variant for QID match');
        
        // 新しい表記揺れを登録
        await this.prisma.withTransaction(async (tx: Prisma.TransactionClient) => {
          await this.repo.createDishCategoryVariant(
            tx,
            categoryByQid.id,
            dto.name,
            'wikidata_qid_match'
          );
        });
        
        return [categoryByQid];
      }
    }

    // Google Custom Search でスペルチェック
    const correctedSpelling = await this.externalApiService.getCorrectedSpelling(dto.name);
    if (correctedSpelling) {
      foundVariant = await this.repo.findDishCategoryVariantBySurfaceForm(correctedSpelling);
      if (foundVariant) {
        this.logger.debug('Corrected spelling match found');
        
        // 新しい表記揺れを登録
        await this.prisma.withTransaction(async (tx: Prisma.TransactionClient) => {
          await this.repo.createDishCategoryVariant(
            tx,
            foundVariant!.dish_categories.id,
            dto.name,
            'google_spelling_correction'
          );
        });

        return [foundVariant.dish_categories];
      }
    }

    // ヒットなし
    this.logger.warn(`No match found for: ${dto.name}`);
    throw new InternalServerErrorException('No matching dish category found');
  }
}