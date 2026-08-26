// api/src/v1/dish-categories/dish-categories.repository.ts
//
// Repository for dish categories data access
//

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { RemoteConfigService } from '../../core/remote-config/remote-config.service';
import { PrismaDishCategoryLocalizedText } from '../../../../shared/converters/convert_dish_category_localized_text';
import type { SupabaseDishCategoryFeatures } from '../../../../shared/converters/convert_dish_category_features';
import { Prisma } from '../../../../shared/prisma';
import {
  DishCategoryCandidateNormalizedInput,
  DishCategoryCandidateWithScores,
  DishCategoryPenaltyFeatureSet,
} from './dish-categories.interface';
import {
  buildCursorFilter,
  buildCursorOrderBy,
  formatCompositeCursor,
} from '../../core/pagination/composite-cursor';

@Injectable()
export class DishCategoriesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly remoteConfigService: RemoteConfigService,
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
   * IDリストから料理カテゴリを検索
   */
  async findDishCategoriesByIds(ids: string[]) {
    this.logger.debug('FindDishCategoriesByIds', 'findDishCategoriesByIds', {
      idsCount: ids.length,
    });

    if (ids.length === 0) {
      return [];
    }

    const result = await this.prisma.prisma.dish_categories.findMany({
      where: { id: { in: ids } },
    });

    this.logger.debug('DishCategoriesFound', 'findDishCategoriesByIds', {
      count: result.length,
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
    // #1599 `(created_at, id)` の複合カーソル。時刻単独だと同時刻の行がページ境界で飛ぶ
    Object.assign(whereClause, buildCursorFilter(cursor));

    const savedEntries = await this.prisma.prisma.reactions.findMany({
      where: whereClause,
      orderBy: buildCursorOrderBy(),
      take: limit + 1,
    });

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = savedEntries.length > limit;
    const entries = hasMore ? savedEntries.slice(0, limit) : savedEntries;
    const nextCursor =
      hasMore && entries.length > 0
        ? formatCompositeCursor(
            entries[entries.length - 1].created_at,
            entries[entries.length - 1].id,
          )
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
  async findCategoryCandidatesWithScores(params: {
    userId: string;
    addressTokens: DishCategoryCandidateNormalizedInput['addressTokens'];
    regionTokens: DishCategoryCandidateNormalizedInput['regionTokens'];
    regionFallbackKeys: DishCategoryCandidateNormalizedInput['regionFallbackKeys'];
    budgetIntentKeys: DishCategoryCandidateNormalizedInput['budgetIntentKeys'];
    timeSlotKey: DishCategoryCandidateNormalizedInput['timeSlotKey'];
    sceneKey: DishCategoryCandidateNormalizedInput['sceneKey'];
    satietyKey: DishCategoryCandidateNormalizedInput['satietyKey'];
    diningPaceKey: DishCategoryCandidateNormalizedInput['diningPaceKey'];
    coreIngredientKey: DishCategoryCandidateNormalizedInput['coreIngredientKey'];
    tasteKey: DishCategoryCandidateNormalizedInput['tasteKey'];
    candidateLimit: number;
  }): Promise<DishCategoryCandidateWithScores[]> {
    const startTime = Date.now();

    const [
      wTime,
      wScene,
      wSatiety,
      wTaste,
      wBudgetIntent,
      wDiningPace,
      wCoreIngredient,
      wMarketSalience,
      wDineOutOrderability,
      scoreJitterRatio,
    ] = await this.remoteConfigService
      .getRemoteConfigValues([
        'dish_category_recommendation_weight_time_slot',
        'dish_category_recommendation_weight_scene',
        'dish_category_recommendation_weight_satiety',
        'dish_category_recommendation_weight_taste',
        'dish_category_recommendation_weight_budget_intent',
        'dish_category_recommendation_weight_dining_pace',
        'dish_category_recommendation_weight_core_ingredient',
        'dish_category_recommendation_weight_market_salience',
        'dish_category_recommendation_weight_dine_out_orderability',
        'dish_category_recommendation_score_jitter_ratio',
      ])
      .then((values) =>
        values.map((v) => {
          const float = parseFloat(v);
          if (isNaN(float) || float < 0) {
            this.logger.warn(
              'InvalidRemoteConfigValue',
              'findCategoryCandidatesWithScores',
              { value: v },
            );
            return 0;
          }
          return float;
        }),
      );

    this.logger.debug(
      'FindCategoryCandidatesWithScores',
      'findCategoryCandidatesWithScores',
      {
        params,
        weights: {
          wTime,
          wScene,
          wSatiety,
          wTaste,
          wBudgetIntent,
          wDiningPace,
          wCoreIngredient,
          wMarketSalience,
          wDineOutOrderability,
          scoreJitterRatio,
        },
      },
    );

    // #533 【設計】SQLは WITH params, weights で一元管理
    const result = await this.prisma.prisma.$queryRaw<
      DishCategoryCandidateWithScores[]
    >`
      WITH params AS (
        SELECT
          ${params.userId}::uuid AS user_id,
          ${params.addressTokens}::text[] AS address_tokens,
          ${params.regionTokens}::text[] AS region_tokens,
          ${params.regionFallbackKeys}::text[] AS region_fallback_keys,
          ${params.budgetIntentKeys}::text[] AS budget_intent_keys,
          ${params.timeSlotKey}::text AS time_slot_key,
          ${params.sceneKey}::text AS scene_key,
          ${params.satietyKey}::text AS satiety_key,
          ${params.diningPaceKey}::text AS dining_pace_key,
          ${params.coreIngredientKey}::text AS core_ingredient_key,
          ${params.tasteKey}::text AS taste_key,
          ${params.candidateLimit}::int AS candidate_limit
      ),
      weights AS (
        SELECT
          ${wTime}::numeric AS w_time,
          ${wScene}::numeric AS w_scene,
          ${wSatiety}::numeric AS w_sat,
          ${wTaste}::numeric AS w_taste,
          ${wBudgetIntent}::numeric AS w_budget_intent,
          ${wDiningPace}::numeric AS w_dining_pace,
          ${wCoreIngredient}::numeric AS w_core_ingredient,
          ${wMarketSalience}::numeric AS w_market_salience,
          ${wDineOutOrderability}::numeric AS w_dine_out_orderability,
          ${Math.min(Math.max(scoreJitterRatio, 0), 1)}::numeric AS score_jitter_ratio
      ),
      -- #533 【設計】gate whitelist: region_tokens + 'region:scope:global' でフィルタ
      --
      -- #1196 【前提】ホワイトリスト(dish_category_features の feature_type='gate')には
      -- 国レベルの key しか投入していない。日本向けに入っているのは 'region:country:JP' **だけ**で、
      -- 'region:administrative_area_level_1:大阪府' や 'region:locality:大阪市' は存在しない。
      --
      -- したがって region_tokens に "region:country:JP" が含まれてさえいれば、
      -- 日本の住所は必ずここでマッチする(十分条件)。
      -- region_tokens は service 側の normalizeInput が address をカンマ分割して作る
      -- (address = "country:JP, administrative_area_level_1:..., locality:..." が正規形式)。
      -- なおこの比較は Postgres の '=' なので**大小文字区別あり**であり、"region:country:jp" では
      -- 当たらない。国コードの大文字化はクライアント側 (app-expo/lib/addressFormat.ts) の責務。
      -- サーバ側で検証・救済はしない(この SQL は仕様どおりで、崩れた値を送る側がバグ)。
      --
      -- 【逆は成り立たない】address が壊れていても、下の OR 分岐にある 'region:scope:global'
      -- (国を問わず出せるカテゴリに付く gate key)を持つ行は残るため、ここが必ず 0 件になるわけではない。
      -- 0 件になるのは "region:scope:global" の行が無いか全て score <= 0 の場合に限られる。
      -- 実例: #1196 では address が市区町村名単体("大阪市")になり region_tokens が ["region:大阪市"]
      -- となったため、JP 向けのゲートには一切ヒットしなくなった。その結果、
      --   - ここが 0 件 → 'no_candidates'、または
      --   - global 分のみ残ったがスレート(6枚)を構成できず → 'insufficient_candidates'
      -- のいずれかで fallbackToClaude が発火し(発火箇所は dish-categories.service.ts の
      -- getRecommendations にある no_candidates / insufficient_candidates / 例外時の 3 箇所)、
      -- Claude 側の失敗がそのまま 1日 1,445件のエラーになった。
      -- どちらの経路だったかは本番ログから確定していないが、いずれにせよ Claude 経路は
      -- ホワイトリスト未整備の海外向けの保険であって日本向けの経路ではない。
      region_ok_categories AS (
        SELECT DISTINCT dcf.dish_category_id AS category_id
        FROM dish_category_features dcf, params p
        WHERE dcf.feature_type = 'gate'
          AND (
            dcf.feature_key = ANY(p.region_tokens)
            OR dcf.feature_key = 'region:scope:global'
          )
          AND dcf.score > 0
      ),
      -- #747【設計】block 対象の料理カテゴリを除外
      blocked_categories AS (
        SELECT DISTINCT r.target_id AS category_id
        FROM reactions r, params p
        WHERE r.user_id = p.user_id
          AND r.target_type = 'dish_categories'
          AND r.action_type = 'block'
      ),
      -- #876 【設計】条件系特徴量を LEFT JOIN
      base_candidates AS (
        SELECT
          roc.category_id,
          dc.macro_genre_qid AS macro_genre,
          -- budget_intent
          bi_feat.score AS bi_score,
          -- timeSlot
          ts_feat.score AS ts_score,
          -- scene
          sc_feat.score AS sc_score,
          -- satiety
          sat_feat.score AS sat_score,
          -- dining_pace
          dp_feat.score AS dp_score,
          -- core_ingredient
          ci_feat.score AS ci_score,
          -- taste
          t_feat.score AS t_score
        FROM region_ok_categories roc
        CROSS JOIN params p
        JOIN dish_categories dc ON dc.id = roc.category_id
        LEFT JOIN blocked_categories bc ON bc.category_id = roc.category_id
        -- budget_intent
        LEFT JOIN LATERAL (
          SELECT MAX(dcf.score) AS score
          FROM dish_category_features dcf
          WHERE dcf.dish_category_id = roc.category_id
            AND dcf.feature_type = 'budget_intent'
            AND dcf.feature_key = ANY(p.budget_intent_keys)
        ) bi_feat ON true
        -- timeSlot
        LEFT JOIN dish_category_features ts_feat
          ON ts_feat.dish_category_id = roc.category_id
          AND ts_feat.feature_type = 'timeSlot'
          AND ts_feat.feature_key = p.time_slot_key
        -- scene
        LEFT JOIN dish_category_features sc_feat
          ON sc_feat.dish_category_id = roc.category_id
          AND sc_feat.feature_type = 'scene'
          AND sc_feat.feature_key = p.scene_key
        -- satiety
        LEFT JOIN dish_category_features sat_feat
          ON sat_feat.dish_category_id = roc.category_id
          AND sat_feat.feature_type = 'satiety'
          AND sat_feat.feature_key = p.satiety_key
        -- dining_pace
        LEFT JOIN dish_category_features dp_feat
          ON dp_feat.dish_category_id = roc.category_id
          AND dp_feat.feature_type = 'dining_pace'
          AND dp_feat.feature_key = p.dining_pace_key
        -- core_ingredient
        LEFT JOIN dish_category_features ci_feat
          ON ci_feat.dish_category_id = roc.category_id
          AND ci_feat.feature_type = 'core_ingredient'
          AND ci_feat.feature_key = p.core_ingredient_key
        -- taste
        LEFT JOIN dish_category_features t_feat
          ON t_feat.dish_category_id = roc.category_id
          AND t_feat.feature_type = 'taste'
          AND t_feat.feature_key = p.taste_key
        WHERE bc.category_id IS NULL
      ),
      -- #533 【設計】rel_score と final_score を計算
      scored_candidates AS (
        SELECT
          bc.category_id,
          bc.macro_genre,
          COALESCE(bc.bi_score, 0) AS budget_intent_score,
          COALESCE(bc.ts_score, 0) AS time_slot_score,
          COALESCE(bc.sc_score, 0) AS scene_score,
          COALESCE(bc.sat_score, 0) AS satiety_score,
          COALESCE(bc.dp_score, 0) AS dining_pace_score,
          COALESCE(bc.ci_score, 0) AS core_ingredient_score,
          COALESCE(bc.t_score, 0) AS taste_score,
          COALESCE(r.market_salience_score, 0) AS market_salience_score,
          COALESCE(r.dine_out_orderability_score, 0) AS dine_out_orderability_score,
          -- weight_sum: 指定された条件のweightのみ加算
          (
            CASE WHEN COALESCE(array_length(p.budget_intent_keys, 1), 0) > 0 THEN w.w_budget_intent ELSE 0 END +
            CASE WHEN p.time_slot_key IS NOT NULL THEN w.w_time ELSE 0 END +
            CASE WHEN p.scene_key IS NOT NULL THEN w.w_scene ELSE 0 END +
            CASE WHEN p.satiety_key IS NOT NULL THEN w.w_sat ELSE 0 END +
            CASE WHEN p.dining_pace_key IS NOT NULL THEN w.w_dining_pace ELSE 0 END +
            CASE WHEN p.core_ingredient_key IS NOT NULL THEN w.w_core_ingredient ELSE 0 END +
            CASE WHEN p.taste_key IS NOT NULL THEN w.w_taste ELSE 0 END
          ) AS weight_sum,
          -- #533 【設計】weight_sum=0 のとき rel_score=1
          -- 検索条件が無いとき、market/orderability だけで回せるようにする
          CASE
            WHEN (
              CASE WHEN COALESCE(array_length(p.budget_intent_keys, 1), 0) > 0 THEN w.w_budget_intent ELSE 0 END +
              CASE WHEN p.time_slot_key IS NOT NULL THEN w.w_time ELSE 0 END +
              CASE WHEN p.scene_key IS NOT NULL THEN w.w_scene ELSE 0 END +
              CASE WHEN p.satiety_key IS NOT NULL THEN w.w_sat ELSE 0 END +
              CASE WHEN p.dining_pace_key IS NOT NULL THEN w.w_dining_pace ELSE 0 END +
              CASE WHEN p.core_ingredient_key IS NOT NULL THEN w.w_core_ingredient ELSE 0 END +
              CASE WHEN p.taste_key IS NOT NULL THEN w.w_taste ELSE 0 END
            ) = 0
            THEN 1
            ELSE
              -- rel_score = Σ(wᵢ × sᵢ) / Σwᵢ wᵢ = 条件の重要度 sᵢ = その料理カテゴリが条件にどれだけ合うか
              -- ユーザーの今の気分ベクトルと、料理特徴ベクトルの向きが近いほど rel_score が高い
              (
                w.w_budget_intent * COALESCE(bc.bi_score, 0) +
                w.w_time * COALESCE(bc.ts_score, 0) +
                w.w_scene * COALESCE(bc.sc_score, 0) +
                w.w_sat * COALESCE(bc.sat_score, 0) +
                w.w_dining_pace * COALESCE(bc.dp_score, 0) +
                w.w_core_ingredient * COALESCE(bc.ci_score, 0) +
                w.w_taste * COALESCE(bc.t_score, 0)
              ) /
              (
                CASE WHEN COALESCE(array_length(p.budget_intent_keys, 1), 0) > 0 THEN w.w_budget_intent ELSE 0 END +
                CASE WHEN p.time_slot_key IS NOT NULL THEN w.w_time ELSE 0 END +
                CASE WHEN p.scene_key IS NOT NULL THEN w.w_scene ELSE 0 END +
                CASE WHEN p.satiety_key IS NOT NULL THEN w.w_sat ELSE 0 END +
                CASE WHEN p.dining_pace_key IS NOT NULL THEN w.w_dining_pace ELSE 0 END +
                CASE WHEN p.core_ingredient_key IS NOT NULL THEN w.w_core_ingredient ELSE 0 END +
                CASE WHEN p.taste_key IS NOT NULL THEN w.w_taste ELSE 0 END
              )
          END AS rel_score
        FROM base_candidates bc
        CROSS JOIN params p
        CROSS JOIN weights w
        -- #533 【設計】market_salience / orderability を region_fallback_keys で探索
        LEFT JOIN LATERAL (
          WITH ranked AS (
            SELECT DISTINCT ON (dcf.feature_type)
              dcf.feature_type,
              dcf.score
            FROM UNNEST(p.region_fallback_keys) WITH ORDINALITY AS fb(key, ord)
            JOIN dish_category_features dcf
              ON dcf.dish_category_id = bc.category_id
            AND dcf.feature_key = fb.key
            AND dcf.feature_type IN ('market_salience', 'dine_out_orderability')
            ORDER BY dcf.feature_type, fb.ord
          )
          SELECT
            MAX(score) FILTER (WHERE feature_type = 'market_salience') AS market_salience_score,
            MAX(score) FILTER (WHERE feature_type = 'dine_out_orderability') AS dine_out_orderability_score
          FROM ranked
        ) r ON true
      ),
      final_scored AS (
        SELECT 
          sc.category_id,
          sc.macro_genre,
          sc.budget_intent_score,
          sc.time_slot_score,
          sc.scene_score,
          sc.satiety_score,
          sc.dining_pace_score,
          sc.core_ingredient_score,
          sc.taste_score,
          sc.rel_score,
          sc.market_salience_score,
          sc.dine_out_orderability_score,
          -- #533 【設計】final_score計算式
          -- rel_score を主スコアとして、market/orderabilityを補正係数にする
          -- 補正係数はに 1 以下なので、market/orderability は rel_score を押し上げるというより、低いものを少し沈める働きになります。
          sc.rel_score * (1 - w.w_market_salience + w.w_market_salience * sc.market_salience_score)
            * (1 - w.w_dine_out_orderability + w.w_dine_out_orderability * sc.dine_out_orderability_score)
          AS final_score,
          w.score_jitter_ratio AS score_jitter_ratio
        FROM scored_candidates sc
        CROSS JOIN weights w
      ),
      -- #533 【設計】final_score > 0 のみ対象
      final_scored_filtered AS (
        SELECT *,
          RANDOM() AS rnd_value
        FROM final_scored
        WHERE final_score > 0
      ),
      -- #598 【設計】スコア忠実な微小揺らぎを加えた順序付け
      -- order_score = final_score * (1 + score_jitter_ratio * random_unit)
      -- random_unit = 2 * rnd_value - 1  （[-1, 1]）
      --   rnd_value: [0,1) の一様乱数
      candidates_with_scores AS (
        SELECT f.*,
        (2 * f.rnd_value - 1) AS random_unit,
        (f.final_score * GREATEST(1 + f.score_jitter_ratio * (2 * f.rnd_value - 1), 0)) AS order_score
        FROM final_scored_filtered f
      )
      SELECT
        category_id,
        macro_genre,
        budget_intent_score,
        time_slot_score,
        scene_score,
        satiety_score,
        dining_pace_score,
        core_ingredient_score,
        taste_score,
        rel_score,
        market_salience_score,
        dine_out_orderability_score,
        final_score,
        rnd_value,
        random_unit,
        order_score
      FROM candidates_with_scores
      ORDER BY order_score DESC
      -- PostgreSQL の LIMIT は 同一クエリレベルの行（FROM 句のテーブル/CTE別名の列）を参照できないため、
      -- ここでは SELECT で params を参照して制限をかける。
      LIMIT (SELECT candidate_limit FROM params)
    `;

    this.logger.debug(
      'CandidatesWithScoresFound',
      'findCategoryCandidatesWithScores',
      {
        durationMs: Date.now() - startTime,
        count: result.length,
        sampleResults: result.slice(0, 6), // Log only first 6 results for brevity
      },
    );

    return result;
  }

  /**
   * #582 【仕様】ローカライズ文言を取得（langCandidates順でフォールバック）
   */
  async findLocalizedTexts(
    categoryIds: string[],
    langCandidates: string[],
  ): Promise<PrismaDishCategoryLocalizedText[]> {
    this.logger.debug('FindLocalizedTexts', 'findLocalizedTexts', {
      categoryIdsCount: categoryIds.length,
      langCandidates,
    });

    if (categoryIds.length === 0) {
      return [];
    }

    // 該当するローカライズ文言をすべて取得
    // DISTINCT ON + ORDER BY CASE で優先度の高いものを抽出する方法もあるが、
    // 性能トレードオフで今回は Prisma ORM を利用する。
    const dishCategoryLocalizations =
      await this.prisma.prisma.dish_category_localized_text.findMany({
        where: {
          dish_category_id: { in: categoryIds },
          locale: { in: langCandidates },
        },
      });

    // locale優先度マップ（小さいほど優先）
    const prio = new Map(langCandidates.map((l, i) => [l, i]));

    // dish_category_id ごとに最優先を採用
    const bestByCategory = new Map<string, PrismaDishCategoryLocalizedText>();

    for (const r of dishCategoryLocalizations) {
      const cur = bestByCategory.get(r.dish_category_id);
      if (!cur) {
        // 未登録なら即登録
        bestByCategory.set(r.dish_category_id, r);
        continue;
      }
      // 既存より優先度が高ければ更新
      const curP = prio.get(cur.locale) ?? Number.POSITIVE_INFINITY;
      const newP = prio.get(r.locale) ?? Number.POSITIVE_INFINITY;
      if (newP < curP) bestByCategory.set(r.dish_category_id, r);
    }

    const result = Array.from(bestByCategory.values());

    this.logger.debug('LocalizedTextsFound', 'findLocalizedTexts', {
      count: result.length,
    });

    return result;
  }

  /**
   * #757 【仕様】特徴量（core_ingredient / cooking_method）を一括取得
   * @param categoryIds 対象カテゴリIDリスト
   * @returns カテゴリIDごとの特徴量セット（逐次最適化の重複ペナルティ計算用）
   */
  async findCategoryPenaltyFeatures(
    categoryIds: string[],
  ): Promise<Map<string, DishCategoryPenaltyFeatureSet>> {
    this.logger.debug(
      'FindCategoryPenaltyFeatures',
      'findCategoryPenaltyFeatures',
      {
        categoryIdsCount: categoryIds.length,
      },
    );

    if (categoryIds.length === 0) {
      return new Map();
    }

    // #876 【設計】core_ingredient / taste / cooking_method を一括取得（N+1回避）
    const penaltyFeatures =
      await this.prisma.prisma.dish_category_features.findMany({
        where: {
          dish_category_id: { in: categoryIds },
          feature_type: { in: ['core_ingredient', 'taste', 'cooking_method'] },
        },
        select: {
          dish_category_id: true,
          feature_type: true,
          feature_key: true,
          score: true,
        },
      });

    // #757 【設計】カテゴリIDごとにグループ化
    const penaltyFeatureMap = new Map<string, DishCategoryPenaltyFeatureSet>();

    for (const categoryId of categoryIds) {
      penaltyFeatureMap.set(categoryId, {
        category_id: categoryId,
        core_ingredients: [],
        taste_features: [],
        cooking_methods: [],
      });
    }

    for (const penaltyFeature of penaltyFeatures) {
      const categoryPenaltyFeatures = penaltyFeatureMap.get(
        penaltyFeature.dish_category_id,
      );
      if (!categoryPenaltyFeatures) continue;

      const penaltyFeatureData = {
        feature_key: penaltyFeature.feature_key,
        score: penaltyFeature.score,
      };

      if (penaltyFeature.feature_type === 'core_ingredient') {
        categoryPenaltyFeatures.core_ingredients.push(penaltyFeatureData);
      } else if (penaltyFeature.feature_type === 'taste') {
        categoryPenaltyFeatures.taste_features.push(penaltyFeatureData);
      } else if (penaltyFeature.feature_type === 'cooking_method') {
        categoryPenaltyFeatures.cooking_methods.push(penaltyFeatureData);
      }
    }

    this.logger.debug(
      'CategoryPenaltyFeaturesFound',
      'findCategoryPenaltyFeatures',
      {
        count: penaltyFeatureMap.size,
        totalFeatures: penaltyFeatures.length,
      },
    );

    return penaltyFeatureMap;
  }

  /**
   * #876 【仕様】深掘り候補として返す特徴量を取得
   */
  async findCategoryDeepDiveFeatures(
    categoryIds: string[],
    scoreThreshold = 0.85,
  ): Promise<
    Map<
      string,
      Array<
        Pick<
          SupabaseDishCategoryFeatures,
          'feature_type' | 'feature_key' | 'score'
        >
      >
    >
  > {
    this.logger.debug(
      'FindCategoryDeepDiveFeatures',
      'findCategoryDeepDiveFeatures',
      {
        categoryIdsCount: categoryIds.length,
        scoreThreshold,
      },
    );

    if (categoryIds.length === 0) {
      return new Map();
    }

    const features =
      await this.prisma.prisma.dish_category_features.findMany({
        where: {
          dish_category_id: { in: categoryIds },
          feature_type: {
            in: ['budget_intent', 'dining_pace', 'taste', 'core_ingredient'],
          },
          score: { gt: scoreThreshold },
        },
        select: {
          dish_category_id: true,
          feature_type: true,
          feature_key: true,
          score: true,
        },
      });

    const featurePriority = new Map<string, number>([
      ['budget_intent', 0],
      ['dining_pace', 1],
      ['taste', 2],
      ['core_ingredient', 3],
    ]);

    const grouped = new Map<
      string,
      Array<
        Pick<
          SupabaseDishCategoryFeatures,
          'feature_type' | 'feature_key' | 'score'
        >
      >
    >();
    for (const categoryId of categoryIds) {
      grouped.set(categoryId, []);
    }

    const sortedFeatures = [...features].sort((a, b) => {
      const typeDiff =
        (featurePriority.get(a.feature_type) ?? Number.MAX_SAFE_INTEGER) -
        (featurePriority.get(b.feature_type) ?? Number.MAX_SAFE_INTEGER);
      if (typeDiff !== 0) return typeDiff;
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return a.feature_key.localeCompare(b.feature_key);
    });

    for (const feature of sortedFeatures) {
      const categoryFeatures = grouped.get(feature.dish_category_id);
      if (!categoryFeatures) continue;
      categoryFeatures.push({
        feature_type: feature.feature_type,
        feature_key: feature.feature_key,
        score: feature.score,
      });
    }

    this.logger.debug(
      'CategoryDeepDiveFeaturesFound',
      'findCategoryDeepDiveFeatures',
      {
        count: grouped.size,
        totalFeatures: features.length,
      },
    );

    return grouped;
  }
}
