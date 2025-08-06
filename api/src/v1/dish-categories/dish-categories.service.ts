// api/src/v1/dish-categories/dish-categories.service.ts
//
// Service for dish categories business logic
//

import { Injectable, Logger } from '@nestjs/common';
import { QueryDishCategoryRecommendationsDto } from '@shared/v1/dto';
import { QueryDishCategoryRecommendationsResponse } from '@shared/v1/res';

import { DishCategoriesRepository } from './dish-categories.repository';
import { ClaudeService } from '../../core/claude/claude.service';

@Injectable()
export class DishCategoriesService {
  private readonly logger = new Logger(DishCategoriesService.name);

  constructor(
    private readonly repo: DishCategoriesRepository,
    private readonly claudeService: ClaudeService,
  ) { }

  /**
   * 料理カテゴリ提案を生成
   */
  async getRecommendations(
    dto: QueryDishCategoryRecommendationsDto,
  ): Promise<QueryDishCategoryRecommendationsResponse> {
    this.logger.debug('Getting dish category recommendations', dto);

    // Claude API で料理カテゴリ提案を生成
    const claudeRecommendations = await this.claudeService.generateDishCategoryRecommendations({
      location: dto.location,
      timeSlot: dto.timeSlot,
      scene: dto.scene,
      mood: dto.mood,
      restrictions: dto.restrictions,
      distance: dto.distance,
      budgetMin: dto.budgetMin,
      budgetMax: dto.budgetMax,
    });

    // カテゴリ名リストを抽出
    const categoryNames = claudeRecommendations.map(rec => rec.category);

    // データベースから該当する料理カテゴリを検索
    const dishCategories = await this.repo.findDishCategoriesByNames(categoryNames);

    // Claude の提案とデータベースの結果をマッピング
    const response: QueryDishCategoryRecommendationsResponse = claudeRecommendations.map(claudeRec => {
      // このカテゴリ名にマッチするデータベースレコードを探す
      const matchedCategory = dishCategories.find(dbCategory =>
        dbCategory.dish_category_variants.some(variant =>
          variant.surface_form === claudeRec.category
        )
      );

      return {
        category: claudeRec.category,
        topicTitle: claudeRec.topicTitle,
        reason: claudeRec.reason,
        categoryId: matchedCategory?.id || '',
        imageUrl: matchedCategory?.image_url || '',
      };
    });

    this.logger.debug(`Returning ${response.length} recommendations`);
    return response;
  }
}