// api/src/v1/dish-categories/dish-categories.service.ts
//
// Service for dish categories business logic
//

import { Injectable } from '@nestjs/common';
import { QueryDishCategoryRecommendationsDto } from '@shared/v1/dto';
import { QueryDishCategoryRecommendationsResponse } from '@shared/v1/res';

import { DishCategoriesRepository } from './dish-categories.repository';
import { ClaudeService } from '../../core/claude/claude.service';
import { AppLoggerService } from '../../core/logger/logger.service';

@Injectable()
export class DishCategoriesService {
  constructor(
    private readonly repo: DishCategoriesRepository,
    private readonly claudeService: ClaudeService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * 料理カテゴリ提案を生成
   */
  async getRecommendations(
    dto: QueryDishCategoryRecommendationsDto,
  ): Promise<QueryDishCategoryRecommendationsResponse> {
    this.logger.debug('GetRecommendations', 'getRecommendations', dto);

    // Claude API で料理カテゴリ提案を生成
    const claudeRecommendations =
      await this.claudeService.generateDishCategoryRecommendations({
        address: dto.address,
        timeSlot: dto.timeSlot,
        scene: dto.scene,
        mood: dto.mood,
        restrictions: dto.restrictions,
        languageTag: dto.languageTag,
      });

    // カテゴリ名リストを抽出
    const categoryNames = claudeRecommendations.map((rec) => rec.category);

    // データベースから該当する料理カテゴリを検索
    const dishCategories =
      await this.repo.findDishCategoriesByNames(categoryNames);

    // Claude の提案とデータベースの結果をマッピング
    const response: QueryDishCategoryRecommendationsResponse =
      claudeRecommendations.map((claudeRec) => {
        // このカテゴリ名にマッチするデータベースレコードを探す
        const matchedCategory = dishCategories.find((dbCategory) =>
          dbCategory.dish_category_variants.some(
            (variant) => variant.surface_form === claudeRec.category,
          ),
        );

        return {
          category: claudeRec.category,
          topicTitle: claudeRec.topicTitle,
          reason: claudeRec.reason,
          categoryId: matchedCategory?.id || '',
          imageUrl: matchedCategory?.image_url || '',
        };
      });

    this.logger.debug('RecommendationsReturned', 'getRecommendations', {
      count: response.length,
    });
    return response;
  }
}
