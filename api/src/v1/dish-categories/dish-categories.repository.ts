// api/src/v1/dish-categories/dish-categories.repository.ts
//
// Repository for dish categories data access
//

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';

@Injectable()
export class DishCategoriesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  async findDishCategoryById(id: string) {
    this.logger.debug('FindDishCategoryById', 'findDishCategoryById', { id });

    const result = await this.prisma.prisma.dish_categories.findUnique({
      where: { id },
    });

    return result;
  }

  /**
   * カテゴリ名リストから料理カテゴリを検索
   */
  async findDishCategoriesByNames(categoryNames: string[]) {
    this.logger.debug(
      'FindDishCategoriesByNames',
      'findDishCategoriesByNames',
      {
        categoryNames,
      },
    );

    const result = await this.prisma.prisma.dish_categories.findMany({
      where: {
        dish_category_variants: {
          some: {
            surface_form: {
              in: categoryNames.map((name) => name.toLowerCase()), // Ensure case-insensitive search
            },
          },
        },
      },
      include: {
        dish_category_variants: {
          where: {
            surface_form: {
              in: categoryNames.map((name) => name.toLowerCase()), // Ensure case-insensitive search
            },
          },
        },
      },
    });

    this.logger.debug('DishCategoriesFound', 'findDishCategoriesByNames', {
      count: result.length,
    });
    return result;
  }

  /**
   * ユーザーが保存した料理カテゴリを取得 (moved from UsersRepository)
   */
  async findDishCategoriesBySavedUser(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: Awaited<
      ReturnType<typeof this.prisma.prisma.dish_categories.findMany>
    >;
    nextCursor: string | null;
  }> {
    this.logger.debug(
      'findDishCategoriesBySavedUser',
      'findDishCategoriesBySavedUser',
      { userId, cursor, limit },
    );

    const whereClause: any = {
      user_id: userId,
      target_type: 'dish_categories',
      action_type: 'save',
    };
    if (cursor) {
      whereClause.created_at = { lt: new Date(cursor) };
    }

    const savedEntries = await this.prisma.prisma.reactions.findMany({
      where: whereClause,
      orderBy: { created_at: 'desc' },
      take: limit + 1,
    });

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = savedEntries.length > limit;
    const entries = hasMore ? savedEntries.slice(0, limit) : savedEntries;
    const nextCursor =
      hasMore && entries.length > 0
        ? entries[entries.length - 1].created_at.toISOString()
        : null;

    const categoryIds = entries.map((e) => e.target_id);
    const result = await this.prisma.prisma.dish_categories.findMany({
      where: { id: { in: categoryIds } },
    });

    this.logger.debug(
      'UserSavedDishCategoriesFound',
      'findDishCategoriesBySavedUser',
      { count: result.length, hasMore },
    );

    return { items: result, nextCursor };
  }

  /**
   * #533 【仕様】料理カテゴリ候補をスコアリングして取得（WITH params/weights構造）
   */
  async findCategoryCandidatesWithScores(
    tx: any,
    params: {
      addressTokens: string[];
      regionTokens: string[];
      regionFallbackKeys: string[];
      timeSlotKey: string | null;
      sceneKey: string | null;
      satietyKey: string | null;
      tasteKey: string | null;
      candidateLimit: number;
    },
  ): Promise<
    Array<{
      category_id: string;
      macro_genre: string | null;
      rel_score: number;
      market_salience_score: number;
      dine_out_orderability_score: number;
      final_score: number;
    }>
  > {
    this.logger.debug(
      'FindCategoryCandidatesWithScores',
      'findCategoryCandidatesWithScores',
      {
        addressTokensCount: params.addressTokens.length,
        hasTimeSlot: !!params.timeSlotKey,
        hasScene: !!params.sceneKey,
        hasSatiety: !!params.satietyKey,
        hasTaste: !!params.tasteKey,
        candidateLimit: params.candidateLimit,
      },
    );

    // #533 【設計】SQLは WITH params, weights で一元管理
    const result = await tx.$queryRaw<
      Array<{
        category_id: string;
        macro_genre: string | null;
        rel_score: number;
        market_salience_score: number;
        dine_out_orderability_score: number;
        final_score: number;
      }>
    >`
      WITH params AS (
        SELECT
          ${params.addressTokens}::text[] AS address_tokens,
          ${params.regionTokens}::text[] AS region_tokens,
          ${params.regionFallbackKeys}::text[] AS region_fallback_keys,
          ${params.timeSlotKey}::text AS time_slot_key,
          ${params.sceneKey}::text AS scene_key,
          ${params.satietyKey}::text AS satiety_key,
          ${params.tasteKey}::text AS taste_key,
          ${params.candidateLimit}::int AS candidate_limit
      ),
      weights AS (
        SELECT
          1.0::numeric AS w_time,
          1.0::numeric AS w_scene,
          1.0::numeric AS w_sat,
          1.0::numeric AS w_taste
      ),
      -- #533 【設計】gate whitelist: region_tokens + 'region:scope:global' でフィルタ
      region_ok_categories AS (
        SELECT DISTINCT dcf.category_id
        FROM dish_category_features dcf, params p
        WHERE dcf.feature_type = 'gate'
          AND (
            dcf.feature_key = ANY(p.region_tokens)
            OR dcf.feature_key = 'region:scope:global'
          )
          AND dcf.score > 0
      ),
      -- #533 【設計】条件系特徴量（timeSlot/scene/satiety/taste）を LEFT JOIN
      base_candidates AS (
        SELECT
          roc.category_id,
          dc.macro_genre_qid AS macro_genre,
          -- timeSlot
          ts_feat.score AS ts_score,
          -- scene
          sc_feat.score AS sc_score,
          -- satiety
          sat_feat.score AS sat_score,
          -- taste
          t_feat.score AS t_score
        FROM region_ok_categories roc
        CROSS JOIN params p
        JOIN dish_categories dc ON dc.id = roc.category_id
        -- timeSlot
        LEFT JOIN dish_category_features ts_feat
          ON ts_feat.category_id = roc.category_id
          AND ts_feat.feature_type = 'timeSlot'
          AND ts_feat.feature_key = p.time_slot_key
        -- scene
        LEFT JOIN dish_category_features sc_feat
          ON sc_feat.category_id = roc.category_id
          AND sc_feat.feature_type = 'scene'
          AND sc_feat.feature_key = p.scene_key
        -- satiety
        LEFT JOIN dish_category_features sat_feat
          ON sat_feat.category_id = roc.category_id
          AND sat_feat.feature_type = 'satiety'
          AND sat_feat.feature_key = p.satiety_key
        -- taste
        LEFT JOIN dish_category_features t_feat
          ON t_feat.category_id = roc.category_id
          AND t_feat.feature_type = 'taste'
          AND t_feat.feature_key = p.taste_key
      ),
      -- #533 【設計】market_salience / orderability を region_fallback_keys で探索
      market_salience_resolved AS (
        SELECT
          bc.category_id,
          COALESCE(
            (
              SELECT dcf.score
              FROM dish_category_features dcf, params p,
                UNNEST(p.region_fallback_keys) WITH ORDINALITY AS fb(key, ord)
              WHERE dcf.category_id = bc.category_id
                AND dcf.feature_type = 'market_salience'
                AND dcf.feature_key = fb.key
              ORDER BY fb.ord ASC
              LIMIT 1
            ),
            0
          ) AS market_salience_score
        FROM base_candidates bc
      ),
      orderability_resolved AS (
        SELECT
          bc.category_id,
          COALESCE(
            (
              SELECT dcf.score
              FROM dish_category_features dcf, params p,
                UNNEST(p.region_fallback_keys) WITH ORDINALITY AS fb(key, ord)
              WHERE dcf.category_id = bc.category_id
                AND dcf.feature_type = 'dine_out_orderability'
                AND dcf.feature_key = fb.key
              ORDER BY fb.ord ASC
              LIMIT 1
            ),
            0
          ) AS dine_out_orderability_score
        FROM base_candidates bc
      ),
      -- #533 【設計】rel_score と final_score を計算
      scored_candidates AS (
        SELECT
          bc.category_id,
          bc.macro_genre,
          COALESCE(bc.ts_score, 0) AS ts_score,
          COALESCE(bc.sc_score, 0) AS sc_score,
          COALESCE(bc.sat_score, 0) AS sat_score,
          COALESCE(bc.t_score, 0) AS t_score,
          ms.market_salience_score,
          ord_r.dine_out_orderability_score,
          -- weight_sum: 指定された条件のweightのみ加算
          (
            CASE WHEN p.time_slot_key IS NOT NULL THEN w.w_time ELSE 0 END +
            CASE WHEN p.scene_key IS NOT NULL THEN w.w_scene ELSE 0 END +
            CASE WHEN p.satiety_key IS NOT NULL THEN w.w_sat ELSE 0 END +
            CASE WHEN p.taste_key IS NOT NULL THEN w.w_taste ELSE 0 END
          ) AS weight_sum,
          -- #533 【設計】weight_sum=0 のとき rel_score=1（決定事項）
          CASE
            WHEN (
              CASE WHEN p.time_slot_key IS NOT NULL THEN w.w_time ELSE 0 END +
              CASE WHEN p.scene_key IS NOT NULL THEN w.w_scene ELSE 0 END +
              CASE WHEN p.satiety_key IS NOT NULL THEN w.w_sat ELSE 0 END +
              CASE WHEN p.taste_key IS NOT NULL THEN w.w_taste ELSE 0 END
            ) = 0
            THEN 1
            ELSE
              (
                w.w_time * COALESCE(bc.ts_score, 0) +
                w.w_scene * COALESCE(bc.sc_score, 0) +
                w.w_sat * COALESCE(bc.sat_score, 0) +
                w.w_taste * COALESCE(bc.t_score, 0)
              ) /
              (
                CASE WHEN p.time_slot_key IS NOT NULL THEN w.w_time ELSE 0 END +
                CASE WHEN p.scene_key IS NOT NULL THEN w.w_scene ELSE 0 END +
                CASE WHEN p.satiety_key IS NOT NULL THEN w.w_sat ELSE 0 END +
                CASE WHEN p.taste_key IS NOT NULL THEN w.w_taste ELSE 0 END
              )
          END AS rel_score
        FROM base_candidates bc
        CROSS JOIN params p
        CROSS JOIN weights w
        JOIN market_salience_resolved ms ON ms.category_id = bc.category_id
        JOIN orderability_resolved ord_r ON ord_r.category_id = bc.category_id
      ),
      final_scored AS (
        SELECT
          category_id,
          macro_genre,
          rel_score,
          market_salience_score,
          dine_out_orderability_score,
          -- #533 【設計】final_score計算式
          rel_score * (0.6 + 0.4 * market_salience_score) * (0.1 + 0.9 * dine_out_orderability_score) AS final_score
        FROM scored_candidates
        WHERE
          -- #533 【設計】final_score > 0 のみ対象
          rel_score * (0.6 + 0.4 * market_salience_score) * (0.1 + 0.9 * dine_out_orderability_score) > 0
      )
      -- #533 【設計】weighted random でソート（final_scoreが大きいほど前に来やすい）
      SELECT
        category_id,
        macro_genre,
        rel_score,
        market_salience_score,
        dine_out_orderability_score,
        final_score
      FROM final_scored, params p
      ORDER BY -LN(RANDOM()) / GREATEST(final_score, 0.1) ASC
      LIMIT p.candidate_limit
    `;

    this.logger.debug(
      'CandidatesWithScoresFound',
      'findCategoryCandidatesWithScores',
      {
        count: result.length,
      },
    );

    return result;
  }

  /**
   * #582 【仕様】ローカライズ文言を取得（langCandidates順でフォールバック）
   */
  async findLocalizedTexts(
    tx: any,
    categoryIds: string[],
    langCandidates: string[],
  ): Promise<
    Array<{
      category_id: string;
      lang: string;
      topic_title: string;
      tagline: string;
    }>
  > {
    this.logger.debug('FindLocalizedTexts', 'findLocalizedTexts', {
      categoryIdsCount: categoryIds.length,
      langCandidates,
    });

    if (categoryIds.length === 0) {
      return [];
    }

    // #582 【設計】DISTINCT ON + ORDER BY CASE で優先順位付けフォールバック
    const caseClauses = langCandidates
      .map((lang, idx) => `WHEN lang = '${lang}' THEN ${idx + 1}`)
      .join('\n          ');

    const result = await tx.$queryRaw<
      Array<{
        category_id: string;
        lang: string;
        topic_title: string;
        tagline: string;
      }>
    >`
      SELECT DISTINCT ON (category_id)
        category_id,
        lang,
        topic_title,
        tagline
      FROM dish_category_localized_text
      WHERE category_id = ANY(${categoryIds}::text[])
        AND lang = ANY(${langCandidates}::text[])
      ORDER BY
        category_id,
        CASE
          ${caseClauses}
          ELSE ${langCandidates.length + 1}
        END ASC
    `;

    this.logger.debug('LocalizedTextsFound', 'findLocalizedTexts', {
      count: result.length,
    });

    return result;
  }
}
