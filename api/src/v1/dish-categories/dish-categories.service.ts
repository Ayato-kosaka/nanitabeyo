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

// #533 【定数】候補取得上限数
const CANDIDATE_LIMIT = 200;

// #533 【定数】Explore選出の最低rel_scoreしきい値
const EXPLORE_MIN_REL_SCORE = 0.35;

// #533 【定数】スレート構成の目標件数
const TARGET_SLATE_SIZE = 6;
const CORE_SIZE = 3;
const VARIETY_SIZE = 1;
const EXPLORE_SIZE = 2;

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
    const startTime = Date.now();

    this.logger.debug('GetRecommendations', 'getRecommendations', {
      address: dto.address,
      timeSlot: dto.timeSlot,
      scene: dto.scene,
      satiety: dto.satiety,
      mood: dto.mood,
      taste: dto.taste,
      languageTag: dto.languageTag,
    });

    try {
      // #533 【仕様】Step 1: 入力正規化
      const normalized = this.normalizeInput(dto);

      // #533 【仕様】Step 2: トランザクション内で候補取得＋スレート構成＋ローカライズ
      const result = await this.prisma.prisma.$transaction(async (tx) => {
        // Step 2-1: 候補取得（SQL scoring）
        const candidates = await this.repo.findCategoryCandidatesWithScores(
          tx,
          {
            addressTokens: normalized.addressTokens,
            regionTokens: normalized.regionTokens,
            regionFallbackKeys: normalized.regionFallbackKeys,
            timeSlotKey: normalized.timeSlotKey,
            sceneKey: normalized.sceneKey,
            satietyKey: normalized.satietyKey,
            tasteKey: normalized.tasteKey,
            candidateLimit: CANDIDATE_LIMIT,
          },
        );

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
          tx,
          categoryIds,
          normalized.langCandidates,
        );

        // #533 【フォールバック】ローカライズテキスト取得失敗時はClaude経路へ
        if (localizedTexts.length === 0) {
          this.logger.warn('FallbackToClaude', 'getRecommendations', {
            reason: 'no_localized_text',
          });
          return this.fallbackToClaude(dto);
        }

        // Step 2-4: カテゴリ情報を取得
        const categories = await tx.dish_categories.findMany({
          where: { id: { in: categoryIds } },
        });

        // Step 2-5: レスポンス構築
        const items = this.buildResponseItems(
          selectedCandidates,
          localizedTexts,
          categories,
          dto.localLanguageCode,
        );

        return {
          items,
          meta: {
            source: 'feature_scoring' as const,
            candidateCount: candidates.length,
            returnedCount: items.length,
          },
        };
      });

      // #533 【ログ】必須項目ログ出力
      const elapsedMs = Date.now() - startTime;
      this.logger.log('RecommendationsReturned', 'getRecommendations', {
        elapsed_ms: elapsedMs,
        addressTokens: normalized.addressTokens,
        conditions: {
          timeSlot: normalized.timeSlotKey,
          scene: normalized.sceneKey,
          satiety: normalized.satietyKey,
          taste: normalized.tasteKey,
        },
        source: result.meta.source,
        candidateCount: result.meta.candidateCount,
        returnedCount: result.meta.returnedCount,
        categoryIds: result.items.map((item) => item.categoryId),
      });

      return result;
    } catch (error) {
      // #533 【フォールバック】例外発生時はClaude経路へ
      this.logger.error('ExceptionInGetRecommendations', 'getRecommendations', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      return this.fallbackToClaude(dto);
    }
  }

  /**
   * #533 【仕様】入力正規化ロジック
   */
  private normalizeInput(dto: QueryDishCategoryRecommendationsDto): {
    addressTokens: string[];
    regionTokens: string[];
    regionFallbackKeys: string[];
    timeSlotKey: string | null;
    sceneKey: string | null;
    satietyKey: string | null;
    tasteKey: string | null;
    langCandidates: string[];
  } {
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
    const regionFallbackKeys = [...regionTokens]
      .reverse()
      .concat('region:scope:global');

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
  private constructSlate(
    candidates: Array<{
      category_id: string;
      macro_genre: string | null;
      rel_score: number;
      market_salience_score: number;
      dine_out_orderability_score: number;
      final_score: number;
    }>,
  ): Array<{
    category_id: string;
    macro_genre: string | null;
    rel_score: number;
    final_score: number;
  }> {
    // #533 【設計】macro_genreがnullの場合は"__unknown__"として扱う
    const normalizedCandidates = candidates.map((c) => ({
      ...c,
      macro_genre: c.macro_genre || '__unknown__',
    }));

    // #533 【設計】rel_score desc, final_score desc でソート
    const sortedByRel = [...normalizedCandidates].sort((a, b) => {
      if (b.rel_score !== a.rel_score) {
        return b.rel_score - a.rel_score;
      }
      return b.final_score - a.final_score;
    });

    const selected: typeof normalizedCandidates = [];
    const usedGenres = new Set<string>();

    // #533 【設計】Core: 3件（macro_genre重複なし）
    for (const candidate of sortedByRel) {
      if (selected.length >= CORE_SIZE) break;
      if (!usedGenres.has(candidate.macro_genre)) {
        selected.push(candidate);
        usedGenres.add(candidate.macro_genre);
      }
    }

    // #533 【設計】Variety: 1件（未使用macro_genre）
    if (selected.length < TARGET_SLATE_SIZE) {
      for (const candidate of sortedByRel) {
        if (selected.length >= CORE_SIZE + VARIETY_SIZE) break;
        if (
          !selected.includes(candidate) &&
          !usedGenres.has(candidate.macro_genre)
        ) {
          selected.push(candidate);
          usedGenres.add(candidate.macro_genre);
        }
      }
    }

    // #533 【設計】Explore: 2件（rel_score >= 0.35, weighted random）
    if (selected.length < TARGET_SLATE_SIZE) {
      const exploreCandidates = sortedByRel.filter(
        (c) =>
          !selected.includes(c) &&
          !usedGenres.has(c.macro_genre) &&
          c.rel_score >= EXPLORE_MIN_REL_SCORE,
      );

      const exploreSelected = this.weightedRandomSample(
        exploreCandidates,
        EXPLORE_SIZE,
      );

      for (const candidate of exploreSelected) {
        if (selected.length >= TARGET_SLATE_SIZE) break;
        selected.push(candidate);
        usedGenres.add(candidate.macro_genre);
      }
    }

    // #533 【設計】不足時の埋めロジック
    if (selected.length < TARGET_SLATE_SIZE) {
      // Step 1: rel_score条件を外して未使用macro_genreから
      const remainingCandidates = sortedByRel.filter(
        (c) => !selected.includes(c) && !usedGenres.has(c.macro_genre),
      );

      for (const candidate of remainingCandidates) {
        if (selected.length >= TARGET_SLATE_SIZE) break;
        selected.push(candidate);
        usedGenres.add(candidate.macro_genre);
      }
    }

    // Step 2: macro_genre重複を許容してfinal_score上位から埋める
    if (selected.length < TARGET_SLATE_SIZE) {
      const sortedByFinal = [...normalizedCandidates].sort(
        (a, b) => b.final_score - a.final_score,
      );

      for (const candidate of sortedByFinal) {
        if (selected.length >= TARGET_SLATE_SIZE) break;
        if (!selected.includes(candidate)) {
          selected.push(candidate);
        }
      }
    }

    return selected;
  }

  /**
   * #533 【設計】weighted randomサンプリング（final_scoreを重みとする）
   */
  private weightedRandomSample<T extends { final_score: number }>(
    candidates: T[],
    count: number,
  ): T[] {
    if (candidates.length === 0) return [];
    if (candidates.length <= count) return candidates;

    const result: T[] = [];
    const pool = [...candidates];

    for (let i = 0; i < count && pool.length > 0; i++) {
      // #533 【設計】0.1下駄を履かせてゼロ回避
      const weights = pool.map((c) => c.final_score + 0.1);
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);

      let random = Math.random() * totalWeight;
      let selectedIndex = 0;

      for (let j = 0; j < weights.length; j++) {
        random -= weights[j];
        if (random <= 0) {
          selectedIndex = j;
          break;
        }
      }

      result.push(pool[selectedIndex]);
      pool.splice(selectedIndex, 1);
    }

    return result;
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
    localizedTexts: Array<{
      category_id: string;
      lang: string;
      topic_title: string;
      tagline: string;
    }>,
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
        (lt) => lt.category_id === candidate.category_id,
      );

      // #533 【設計】ローカライズテキストがない場合はカテゴリ名をフォールバック
      const topicTitle = localizedText
        ? localizedText.topic_title
        : category.label_en;
      // #533 【設計】taglineをreasonとして使用（内部でtaglineだが、APIレスポンスではreason）
      const reason = localizedText ? localizedText.tagline : '';

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

      return {
        items,
        meta: {
          source: 'claude_fallback',
          candidateCount: 0,
          returnedCount: items.length,
        },
      };
    } catch (error) {
      this.logger.error('ClaudeFallbackFailed', 'fallbackToClaude', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // #533 【設計】Claudeも失敗した場合は空配列を返す
      return {
        items: [],
        meta: {
          source: 'claude_fallback',
          candidateCount: 0,
          returnedCount: 0,
        },
      };
    }
  }
}
