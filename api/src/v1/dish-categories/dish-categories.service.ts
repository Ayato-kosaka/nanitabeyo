// api/src/v1/dish-categories/dish-categories.service.ts
//
// Service for dish categories business logic
//

import { Injectable, BadRequestException } from '@nestjs/common';
import { QueryDishCategoryRecommendationsDto } from '@shared/v1/dto';
import {
  QueryDishCategoryRecommendationsResponse,
  DishCategoryRecommendationItem,
} from '@shared/v1/res';

import { DishCategoriesRepository } from './dish-categories.repository';
import { ClaudeService } from '../../core/claude/claude.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaDishCategoryLocalizedText } from '../../../../shared/converters/convert_dish_category_localized_text';
import {
  DishCategoryCandidateNormalizedInput,
  DishCategoryCandidateWithScores,
} from './dish-categories.interface';
import { shuffle } from 'src/core/utils/backend-utils';

// #533 【定数】候補取得上限数
const CANDIDATE_LIMIT = 200;

// #533 【定数】スレート構成の目標件数
const TARGET_SLATE_SIZE = 6;
const CORE_SIZE = 3;
const VARIETY_SIZE = 3;
const EXPLORE_SIZE = 0;

// #533 【定数】Explore選出用パーセンタイル
const EXPLORE_LOW_PCT = 0.1; // 上位10%は除外
const EXPLORE_HIGH_PCT = 0.4; // 上位40%までは許可

@Injectable()
export class DishCategoriesService {
  constructor(
    private readonly repo: DishCategoriesRepository,
    private readonly claudeService: ClaudeService,
    private readonly logger: AppLoggerService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * #533 【仕様】料理カテゴリ提案を生成（オンライン処理）
   */
  async getRecommendations(
    dto: QueryDishCategoryRecommendationsDto,
  ): Promise<QueryDishCategoryRecommendationsResponse> {
    this.logger.debug('GetRecommendations', 'getRecommendations', {
      address: dto.address,
      timeSlot: dto.timeSlot,
      scene: dto.scene,
      mood: dto.mood,
      taste: dto.taste,
      languageTag: dto.languageTag,
    });

    try {
      // #533 【仕様】Step 1: 入力正規化
      const normalized = this.normalizeInput(dto);

      // #533 【仕様】Step 2: 候補取得＋スレート構成＋ローカライズ
      // Step 2-1: 候補取得（SQL scoring）
      const candidates = await this.repo.findCategoryCandidatesWithScores({
        addressTokens: normalized.addressTokens,
        regionTokens: normalized.regionTokens,
        regionFallbackKeys: normalized.regionFallbackKeys,
        timeSlotKey: normalized.timeSlotKey,
        sceneKey: normalized.sceneKey,
        satietyKey: normalized.satietyKey,
        tasteKey: normalized.tasteKey,
        candidateLimit: CANDIDATE_LIMIT,
      });

      // #533 【フォールバック】候補0件の場合はClaude経路へ
      if (candidates.length === 0) {
        this.logger.log('FallbackToClaude', 'getRecommendations', {
          reason: 'no_candidates',
        });
        return this.fallbackToClaude(dto);
      }

      // Step 2-2: スレート構成（Core/Variety/Explore）
      const selectedCandidates = this.constructSlate(candidates);

      // #533 【フォールバック】6件未満の場合はClaude経路へ
      if (selectedCandidates.length < TARGET_SLATE_SIZE) {
        this.logger.log('FallbackToClaude', 'getRecommendations', {
          reason: 'insufficient_candidates',
          count: selectedCandidates.length,
        });
        return this.fallbackToClaude(dto);
      }

      // Step 2-3: ローカライズ文言取得
      const categoryIds = selectedCandidates.map((c) => c.category_id);
      const localizedTexts = await this.repo.findLocalizedTexts(
        categoryIds,
        normalized.langCandidates,
      );

      // Step 2-4: カテゴリ情報を取得
      const categories = await this.prisma.prisma.dish_categories.findMany({
        where: { id: { in: categoryIds } },
      });

      // Step 2-5: レスポンス構築
      const items = this.buildResponseItems(
        selectedCandidates,
        localizedTexts,
        categories,
        dto.localLanguageCode,
      );

      return items;
    } catch (error) {
      // #533 【フォールバック】例外発生時はClaude経路へ
      this.logger.error('ExceptionInGetRecommendations', 'getRecommendations', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      return await this.fallbackToClaude(dto);
    }
  }

  /**
   * #533 【仕様】入力正規化ロジック
   */
  private normalizeInput(
    dto: QueryDishCategoryRecommendationsDto,
  ): DishCategoryCandidateNormalizedInput {
    // #533 【仕様】addressのパース
    const addressTokens = dto.address
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    if (addressTokens.length === 0) {
      throw new BadRequestException('address must not be empty');
    }

    // #533 【仕様】regionTokens生成
    const regionTokens = addressTokens.map((token) => `region:${token}`);

    // #533 【仕様】regionFallbackKeys生成（狭い地域→広い地域→global）
    const regionFallbackKeys = [...regionTokens].reverse().concat('global');

    // #533 【仕様】空文字をnullに正規化
    const timeSlotKey = dto.timeSlot || null;
    const sceneKey = dto.scene || null;
    // #533 【仕様】moodをsatietyKeyに変換（内部処理用）
    const satietyKey = dto.mood || null;
    const tasteKey = dto.taste || null;

    // #533 【仕様】langCandidates生成（exact→base→en）
    const langCandidates: string[] = [];
    if (dto.languageTag) {
      langCandidates.push(dto.languageTag);
      const baseCodeMatch = dto.languageTag.match(/^([a-z]{2,3})-/);
      if (baseCodeMatch) {
        const baseCode = baseCodeMatch[1];
        if (!langCandidates.includes(baseCode)) {
          langCandidates.push(baseCode);
        }
      }
    }
    if (!langCandidates.includes('en')) {
      langCandidates.push('en');
    }

    return {
      addressTokens,
      regionTokens,
      regionFallbackKeys,
      timeSlotKey,
      sceneKey,
      satietyKey,
      tasteKey,
      langCandidates,
    };
  }

  /**
   * #533 【仕様】スレート構成ロジック（Core/Variety/Explore）
   */
  private constructSlate(candidates: DishCategoryCandidateWithScores[]): Array<{
    category_id: string;
    macro_genre: string | null;
    rel_score: number;
    final_score: number;
  }> {
    const selected: (DishCategoryCandidateWithScores & {
      selected_reason: 'core' | 'variety' | 'explore' | 'fillup';
    })[] = [];
    const selectedCategoryIds = new Set<string>();
    const usedGenres = new Set<string>();

    // #533 【設計】Core: 3件（macro_genre重複なし）
    for (const candidate of candidates) {
      if (selected.length >= CORE_SIZE) break;
      const genre = candidate.macro_genre;
      if (genre && usedGenres.has(genre)) continue;
      selected.push({ ...candidate, selected_reason: 'core' });
      selectedCategoryIds.add(candidate.category_id);
      genre && usedGenres.add(genre);
    }

    // #533 【設計】Variety: 1件（未使用macro_genre）
    if (selected.length < TARGET_SLATE_SIZE) {
      for (const candidate of candidates) {
        if (selected.length >= CORE_SIZE + VARIETY_SIZE) break;
        const genre = candidate.macro_genre;
        if (selectedCategoryIds.has(candidate.category_id)) continue;
        if (genre && usedGenres.has(genre)) continue;
        selected.push({ ...candidate, selected_reason: 'variety' });
        selectedCategoryIds.add(candidate.category_id);
        genre && usedGenres.add(genre);
      }
    }

    // #533 【設計】Explore: 2件
    if (selected.length < TARGET_SLATE_SIZE) {
      const exploreSelected = this.pickExploreFromMidBand(
        candidates,
        EXPLORE_SIZE,
        selectedCategoryIds,
        usedGenres,
      );

      for (const candidate of exploreSelected) {
        if (selected.length >= TARGET_SLATE_SIZE) break;
        selected.push({ ...candidate, selected_reason: 'explore' });
        selectedCategoryIds.add(candidate.category_id);
        candidate.macro_genre && usedGenres.add(candidate.macro_genre);
      }
    }

    // Step 2: macro_genre重複を許容してfinal_score上位から埋める
    if (selected.length < TARGET_SLATE_SIZE) {
      for (const candidate of candidates) {
        if (selected.length >= TARGET_SLATE_SIZE) break;
        if (!selectedCategoryIds.has(candidate.category_id)) {
          selected.push({ ...candidate, selected_reason: 'fillup' });
          selectedCategoryIds.add(candidate.category_id);
        }
      }
    }

    // #533 同じような並びにならないように表示順をシャッフルして返す
    // fillup を末尾固定
    const middleItems = selected.filter((c) => c.selected_reason !== 'fillup');
    const fillupItems = selected.filter((c) => c.selected_reason === 'fillup');

    const finalSelected = [...shuffle(middleItems), ...fillupItems];

    this.logger.debug('ConstructedSlate', 'constructSlate', {
      selectedCount: finalSelected.length,
      // ログ設計のリスクがあるため、安定したら項目を減らす
      selectedDetails: finalSelected,
    });

    return finalSelected.map((value) => ({
      category_id: value.category_id,
      macro_genre: value.macro_genre,
      rel_score: value.rel_score,
      final_score: value.final_score,
    }));
  }

  /**
   * #533 【仕様】Explore選出ロジック（mid-band一様ランダム選出）
   */
  private pickExploreFromMidBand<
    T extends { category_id: string; macro_genre: string | null },
  >(
    candidatesInSqlOrder: T[],
    count: number,
    selectedCategoryIds: Set<string>,
    usedGenres: Set<string>,
  ): T[] {
    // 1) 全 candidates を中位帯に切る（順位ベース）
    const n = candidatesInSqlOrder.length;
    if (n === 0) return [];
    const from = Math.floor(n * EXPLORE_LOW_PCT);
    const to = Math.max(from + 1, Math.floor(n * EXPLORE_HIGH_PCT)); // 空にならない保険
    const midBand = candidatesInSqlOrder.slice(from, to);

    // 2) 未選択＆未使用ジャンルに絞る
    const midBandFiltered = midBand.filter((c) => {
      if (selectedCategoryIds.has(c.category_id)) return false;
      if (c.macro_genre && usedGenres.has(c.macro_genre)) return false;
      return true;
    });

    // 3) midBand から一様ランダムで without replacement
    const picked: T[] = [];
    const arr = [...midBandFiltered];
    while (picked.length < count && arr.length > 0) {
      const idx = Math.floor(Math.random() * arr.length);
      const c = arr.splice(idx, 1)[0];
      picked.push(c);
    }
    return picked;
  }

  /**
   * #533 【仕様】レスポンスアイテム構築
   */
  private buildResponseItems(
    selectedCandidates: Array<{
      category_id: string;
      macro_genre: string | null;
      rel_score: number;
      final_score: number;
    }>,
    localizedTexts: PrismaDishCategoryLocalizedText[],
    categories: Array<{
      id: string;
      label_en: string;
      labels: any;
      image_url: string;
      macro_genre_qid: string | null;
    }>,
    localLanguageCode: string,
  ): DishCategoryRecommendationItem[] {
    const items: DishCategoryRecommendationItem[] = [];

    for (const candidate of selectedCandidates) {
      const category = categories.find((c) => c.id === candidate.category_id);
      if (!category) continue;

      const localizedText = localizedTexts.find(
        (lt) => lt.dish_category_id === candidate.category_id,
      );
      if (!localizedText) {
        this.logger.warn('MissingLocalizedText', 'buildResponseItems', {
          categoryId: candidate.category_id,
        });
      }

      // #533 【設計】category名はlocalLanguageCodeで取得
      let categoryName = category.label_en;
      if (localLanguageCode && category.labels) {
        try {
          const labels = category.labels as Record<string, string>;
          categoryName =
            labels[localLanguageCode] || labels['en'] || category.label_en;
        } catch (error) {
          this.logger.warn('LabelsParsingError', 'buildResponseItems', {
            categoryId: category.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // #533 【設計】ローカライズテキストがない場合はカテゴリ名をフォールバック
      const topicTitle = localizedText
        ? localizedText.topic_title
        : categoryName;
      // #533 【設計】taglineをreasonとして使用（内部でtaglineだが、APIレスポンスではreason）
      const reason = localizedText ? localizedText.tagline : '';

      items.push({
        category: categoryName,
        topicTitle,
        reason,
        categoryId: category.id,
        imageUrl: category.image_url,
      });
    }

    return items;
  }

  /**
   * #533 【フォールバック】Claude経路（既存実装）
   */
  private async fallbackToClaude(
    dto: QueryDishCategoryRecommendationsDto,
  ): Promise<QueryDishCategoryRecommendationsResponse> {
    try {
      // #533 【設計】ClaudeへはDTOのみを渡す
      const claudeRecommendations =
        await this.claudeService.generateDishCategoryRecommendations({
          address: dto.address,
          timeSlot: dto.timeSlot,
          scene: dto.scene,
          mood: dto.mood,
          languageTag: dto.languageTag,
        });

      const categoryNames = claudeRecommendations.map((rec) => rec.category);

      const dishCategories =
        await this.repo.findDishCategoriesByNames(categoryNames);

      const items: DishCategoryRecommendationItem[] = claudeRecommendations.map(
        (claudeRec) => {
          const matchedCategory = dishCategories.find((dbCategory) =>
            dbCategory.dish_category_variants.some(
              (variant) =>
                variant.surface_form === claudeRec.category.toLowerCase(),
            ),
          );

          let categoryName = claudeRec.category;
          if (dto.localLanguageCode && matchedCategory?.labels) {
            try {
              const labels = matchedCategory.labels as Record<string, string>;
              categoryName =
                labels[dto.localLanguageCode] ||
                labels['en'] ||
                matchedCategory.label_en ||
                claudeRec.category;
            } catch (error) {
              this.logger.warn('LabelsParsingError', 'fallbackToClaude', {
                categoryId: matchedCategory.id,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
              categoryName = matchedCategory.label_en || claudeRec.category;
            }
          }

          return {
            category: categoryName,
            topicTitle: claudeRec.topicTitle,
            reason: claudeRec.reason,
            categoryId: matchedCategory?.id || '',
            imageUrl: matchedCategory?.image_url || '',
          };
        },
      );

      return items;
    } catch (error) {
      this.logger.error('ClaudeFallbackFailed', 'fallbackToClaude', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // #533 【設計】Claudeも失敗した場合は空配列を返す
      return [];
    }
  }
}
