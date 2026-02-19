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
import { RemoteConfigService } from '../../core/remote-config/remote-config.service';
import { PrismaDishCategoryLocalizedText } from '../../../../shared/converters/convert_dish_category_localized_text';
import {
  DishCategoryCandidateNormalizedInput,
  DishCategoryCandidateWithScores,
  DishCategoryPenaltyFeatureSet,
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
    private readonly remoteConfigService: RemoteConfigService,
  ) {}

  /**
   * #533 【仕様】料理カテゴリ提案を生成（オンライン処理）
   */
  async getRecommendations(
    dto: QueryDishCategoryRecommendationsDto,
    userId: string,
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
        userId,
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
        return this.fallbackToClaude(dto, userId);
      }

      // #757 【設計】Step 2-2: 特徴量取得（core_ingredient / cooking_method）
      const candidateIds = candidates.map((c) => c.category_id);
      const penaltyFeatureSets =
        await this.repo.findCategoryPenaltyFeatures(candidateIds);

      // #757 【設計】Step 2-2.5: ペナルティ重み取得
      const [penaltyWeightCoreIngredient, penaltyWeightCookingMethod] =
        await this.remoteConfigService
          .getRemoteConfigValues([
            'dish_category_recommendation_penalty_weight_core_ingredient',
            'dish_category_recommendation_penalty_weight_cooking_method',
          ])
          .then((values) =>
            values.map((v) => {
              const float = parseFloat(v);
              if (isNaN(float) || float < 0) {
                throw new BadRequestException(
                  `Invalid penalty weight value in remote config: ${v}`,
                );
              }
              return float;
            }),
          );

      // #757 【設計】Step 2-3: 逐次最適化でスレート構成
      const selectedCandidates = this.selectWithSequentialOptimization(
        candidates,
        penaltyFeatureSets,
        penaltyWeightCoreIngredient,
        penaltyWeightCookingMethod,
      );

      // #533 【フォールバック】6件未満の場合はClaude経路へ
      if (selectedCandidates.length < TARGET_SLATE_SIZE) {
        this.logger.log('FallbackToClaude', 'getRecommendations', {
          reason: 'insufficient_candidates',
          count: selectedCandidates.length,
        });
        return this.fallbackToClaude(dto, userId);
      }

      // Step 2-4: ローカライズ文言取得
      const categoryIds = selectedCandidates.map((c) => c.category_id);
      const localizedTexts = await this.repo.findLocalizedTexts(
        categoryIds,
        normalized.langCandidates,
      );

      // Step 2-5: カテゴリ情報を取得
      const categories = await this.prisma.prisma.dish_categories.findMany({
        where: { id: { in: categoryIds } },
      });

      // Step 2-6: レスポンス構築
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

      return await this.fallbackToClaude(dto, userId);
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
   * #757 【仕様】逐次最適化による6枚選抜（Greedy + 重複ペナルティ）
   *
   * @description
   * final_score を尊重しつつ、core_ingredient / cooking_method の重複を抑制する。
   * 1枚目は order_score 上位から選択（既存の jitter 尊重）。
   * 2〜6枚目は、S(i) = final_score - penalty(i) で再スコアリングして選択。
   * penalty(i) = Σ (weight_f * featureScore * count(key)^2)
   *
   * macro_genre の重複抑制も可能な限り維持する。
   */
  private selectWithSequentialOptimization(
    candidates: DishCategoryCandidateWithScores[],
    penaltyFeatureSets: DishCategoryPenaltyFeatureSet[],
    penaltyWeightCoreIngredient: number,
    penaltyWeightCookingMethod: number,
  ): Array<{
    category_id: string;
    macro_genre: string | null;
    rel_score: number;
    final_score: number;
  }> {
    // #757 【設計】特徴量マップを構築（高速アクセス）
    const penaltyFeatureMap = new Map<string, DishCategoryPenaltyFeatureSet>();
    for (const pfs of penaltyFeatureSets) {
      penaltyFeatureMap.set(pfs.category_id, pfs);
    }

    // #757 【設計】選択済みカテゴリと使用済みジャンル
    const selected: Array<{
      category_id: string;
      macro_genre: string | null;
      rel_score: number;
      final_score: number;
    }> = [];
    const selectedCategoryIds = new Set<string>();
    const usedGenres = new Set<string>();

    // #757 【設計】特徴量の出現カウント（重複ペナルティ用）
    const penaltyFeatureCounts = new Map<string, number>();

    // #757 【設計】1枚目: order_score 上位（既存の jitter を尊重）
    if (candidates.length > 0) {
      const first = candidates[0];
      selected.push({
        category_id: first.category_id,
        macro_genre: first.macro_genre,
        rel_score: first.rel_score,
        final_score: first.final_score,
      });
      selectedCategoryIds.add(first.category_id);
      if (first.macro_genre) usedGenres.add(first.macro_genre);

      // 特徴量カウント更新
      this.updatePenaltyFeatureCounts(
        penaltyFeatureCounts,
        penaltyFeatureMap.get(first.category_id),
      );

      this.logger.debug(
        'SequentialOptimization',
        'selectWithSequentialOptimization',
        {
          step: 1,
          selected: first.category_id,
          base_score: first.final_score,
          penalty: 0,
          adjusted_score: first.final_score,
        },
      );
    }

    // #757 【設計】2〜6枚目: 逐次最適化選抜
    while (
      selected.length < TARGET_SLATE_SIZE &&
      selectedCategoryIds.size < candidates.length
    ) {
      let bestCandidate: DishCategoryCandidateWithScores | null = null;
      let bestScore = -Infinity;
      let bestPenalty = 0;

      for (const candidate of candidates) {
        // 既選択済みはスキップ
        if (selectedCategoryIds.has(candidate.category_id)) continue;

        // #757 【設計】macro_genre 重複抑制（可能な限り）
        // 候補が多い場合は重複を避ける、少ない場合は許容して6件充足を優先
        const hasUnusedGenreCandidates = candidates.some(
          (c) =>
            !selectedCategoryIds.has(c.category_id) &&
            (!c.macro_genre || !usedGenres.has(c.macro_genre)),
        );
        if (
          hasUnusedGenreCandidates &&
          candidate.macro_genre &&
          usedGenres.has(candidate.macro_genre)
        ) {
          continue;
        }

        // #757 【設計】ペナルティ計算
        const penalty = this.calculateDiversityPenalty(
          candidate.category_id,
          penaltyFeatureMap,
          penaltyFeatureCounts,
          penaltyWeightCoreIngredient,
          penaltyWeightCookingMethod,
        );

        // #757 【設計】調整スコア = base - penalty
        const adjustedScore = candidate.final_score - penalty;

        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;
          bestCandidate = candidate;
          bestPenalty = penalty;
        }
      }

      // #757 【設計】最良候補が見つからない場合は終了
      if (!bestCandidate) break;

      // 選択確定
      selected.push({
        category_id: bestCandidate.category_id,
        macro_genre: bestCandidate.macro_genre,
        rel_score: bestCandidate.rel_score,
        final_score: bestCandidate.final_score,
      });
      selectedCategoryIds.add(bestCandidate.category_id);
      if (bestCandidate.macro_genre) usedGenres.add(bestCandidate.macro_genre);

      // 特徴量カウント更新
      this.updatePenaltyFeatureCounts(
        penaltyFeatureCounts,
        penaltyFeatureMap.get(bestCandidate.category_id),
      );

      this.logger.debug(
        'SequentialOptimization',
        'selectWithSequentialOptimization',
        {
          step: selected.length,
          selected: bestCandidate.category_id,
          base_score: bestCandidate.final_score,
          penalty: bestPenalty,
          adjusted_score: bestScore,
        },
      );
    }

    this.logger.debug(
      'SequentialOptimizationComplete',
      'selectWithSequentialOptimization',
      {
        selectedCount: selected.length,
        targetSize: TARGET_SLATE_SIZE,
      },
    );

    return selected;
  }

  /**
   * #757 【仕様】多様性ペナルティの計算
   *
   * @description
   * penalty = Σ (weight_f * featureScore * count(key)^2)
   * - core_ingredient: weight は remoteConfig から取得
   * - cooking_method: weight は remoteConfig から取得
   */
  private calculateDiversityPenalty(
    categoryId: string,
    penaltyFeatureMap: Map<string, DishCategoryPenaltyFeatureSet>,
    penaltyFeatureCounts: Map<string, number>,
    penaltyWeightCoreIngredient: number,
    penaltyWeightCookingMethod: number,
  ): number {
    const penaltyFeatureSet = penaltyFeatureMap.get(categoryId);
    if (!penaltyFeatureSet) return 0;

    let penalty = 0;

    // #757 【設計】core_ingredient のペナルティ
    for (const penaltyFeature of penaltyFeatureSet.core_ingredients) {
      const count =
        penaltyFeatureCounts.get(
          `core_ingredient:${penaltyFeature.feature_key}`,
        ) || 0;
      penalty +=
        penaltyWeightCoreIngredient * penaltyFeature.score * count * count;
    }

    // #757 【設計】cooking_method のペナルティ
    for (const penaltyFeature of penaltyFeatureSet.cooking_methods) {
      const count =
        penaltyFeatureCounts.get(
          `cooking_method:${penaltyFeature.feature_key}`,
        ) || 0;
      penalty +=
        penaltyWeightCookingMethod * penaltyFeature.score * count * count;
    }

    return penalty;
  }

  /**
   * #757 【仕様】特徴量カウントの更新
   */
  private updatePenaltyFeatureCounts(
    penaltyFeatureCounts: Map<string, number>,
    penaltyFeatureSet: DishCategoryPenaltyFeatureSet | undefined,
  ): void {
    if (!penaltyFeatureSet) return;

    for (const penaltyFeature of penaltyFeatureSet.core_ingredients) {
      const key = `core_ingredient:${penaltyFeature.feature_key}`;
      penaltyFeatureCounts.set(key, (penaltyFeatureCounts.get(key) || 0) + 1);
    }

    for (const penaltyFeature of penaltyFeatureSet.cooking_methods) {
      const key = `cooking_method:${penaltyFeature.feature_key}`;
      penaltyFeatureCounts.set(key, (penaltyFeatureCounts.get(key) || 0) + 1);
    }
  }

  /**
   * #533 【仕様】スレート構成ロジック（Core/Variety/Explore）
   * #757 【非推奨】逐次最適化ロジック (selectWithSequentialOptimization) に置換済み
   * このメソッドは後方互換性のため残しているが、現在は使用されていない。
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
    userId: string,
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

      // #747 【設計】Claude経路でも block 対象の料理カテゴリを除外
      const blockedCategoryIds = new Set(
        (
          await this.prisma.prisma.reactions.findMany({
            where: {
              user_id: userId,
              target_type: 'dish_categories',
              action_type: 'block',
            },
            select: { target_id: true },
          })
        ).map((reaction) => reaction.target_id),
      );

      const items: DishCategoryRecommendationItem[] = claudeRecommendations
        .map((claudeRec) => {
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
        })
        .filter(
          (item) => item.categoryId && !blockedCategoryIds.has(item.categoryId),
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
