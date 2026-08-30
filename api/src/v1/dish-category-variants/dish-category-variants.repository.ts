// api/src/v1/dish-category-variants/dish-category-variants.repository.ts
//
// Repository for dish category variants data access
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaDishCategories } from '../../../../shared/converters/convert_dish_categories';

@Injectable()
export class DishCategoryVariantsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * 料理カテゴリ表記揺れを検索
   */
  async findDishCategoryVariants(tx: Prisma.TransactionClient, q: string) {
    const qNorm = q.trim().toLowerCase();
    this.logger.debug('FindDishCategoryVariants', 'findDishCategoryVariants', {
      qNorm,
    });

    const result = await tx.$queryRaw<PrismaDishCategories[]>`
    WITH candidates AS (
      SELECT
        dc.id AS "dishCategoryId",
        MIN(CASE WHEN dcv.surface_form = ${qNorm} THEN 0 ELSE 1 END) AS exact_rank,
        MIN(ABS(char_length(dcv.surface_form) - char_length(${qNorm}))) AS len_diff
      FROM dish_category_variants dcv
      JOIN dish_categories dc
        ON dc.id = dcv.dish_category_id
      WHERE dcv.surface_form LIKE (${qNorm} || '%')
      GROUP BY dc.id
    )
    SELECT
      dc.*
    FROM candidates c
    JOIN dish_categories dc
      ON dc.id = c."dishCategoryId"
    ORDER BY
      c.exact_rank ASC,
      c.len_diff ASC,
      c."dishCategoryId" ASC
    LIMIT 20;
  `;

    this.logger.debug('DishCategoryVariantsFound', 'findDishCategoryVariants', {
      count: result.length,
    });
    return result;
  }

  /**
   * surface_form で料理カテゴリ表記揺れを検索
   */
  async findDishCategoryVariantBySurfaceForm(surfaceForm: string) {
    this.logger.debug(
      'FindVariantBySurfaceForm',
      'findDishCategoryVariantBySurfaceForm',
      {
        surfaceForm,
      },
    );

    const result = await this.prisma.prisma.dish_category_variants.findUnique({
      where: {
        surface_form: surfaceForm.toLowerCase(), // Ensure case-insensitive search
      },
      include: {
        dish_categories: true,
      },
    });

    this.logger.debug('VariantFound', 'findDishCategoryVariantBySurfaceForm', {
      found: !!result,
    });
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
    this.logger.debug(
      'CreateDishCategoryVariant',
      'createDishCategoryVariant',
      {
        dishCategoryId,
        surfaceForm,
        source,
      },
    );

    const result = await tx.dish_category_variants.create({
      data: {
        dish_category_id: dishCategoryId,
        surface_form: surfaceForm.toLowerCase(), // Ensure case-insensitive storage
        source: source,
      },
    });

    this.logger.debug(
      'DishCategoryVariantCreated',
      'createDishCategoryVariant',
      {
        id: result.id,
      },
    );
    return result;
  }

  /**
   * QID で料理カテゴリを検索
   */
  async findDishCategoryByQid(qid: string) {
    this.logger.debug('FindDishCategoryByQid', 'findDishCategoryByQid', {
      qid,
    });

    // まずIDとして直接検索
    let result = await this.prisma.prisma.dish_categories.findUnique({
      where: {
        id: qid,
      },
    });

    // IDで見つからない場合は、tagsでQIDを検索
    if (!result) {
      const categories = await this.prisma.prisma.dish_categories.findMany({
        where: {
          tags: {
            has: qid,
          },
        },
      });
      result = categories.length > 0 ? categories[0] : null;
    }

    this.logger.debug('DishCategoryByQidFound', 'findDishCategoryByQid', {
      found: !!result,
    });
    return result;
  }

  /**
   * #1399 照合用に `dish_category_variants` を**全件**読む（読み取りのみ）。
   *
   * 既存の `findDishCategoryVariants` は `surface_form LIKE ($q || '%')` の**前方一致**で、
   * 「ユーザーが打った文字で始まる表記を探す」向きである。SNS のキャプションから
   * 料理名を拾う用途は**向きが逆**（長文の中に含まれる表記を探す）なので、既存の索引が効かない。
   *
   * そこで辞書側を丸ごと持ってきて `shared/utils/dishCategoryMatch.ts` の純関数に渡す。
   * 実データは約 5,000 行 / 66 KiB の見込み（#1399 独立レビュー M-4。ただし
   * **この数値は本 DB で検証されていない**ので、`take` で上限を切って青天井にはしない）。
   *
   * 呼び出し側（`DishCategoryVariantDictionaryService`）が TTL つきでキャッシュするので、
   * import のたびに全件読みが走るわけではない。
   */
  async findAllVariantsForMatching(limit: number) {
    const result = await this.prisma.prisma.dish_category_variants.findMany({
      select: {
        dish_category_id: true,
        surface_form: true,
        source: true,
      },
      // 決定的な順序にしておく。上限に当たったときに毎回違う辞書が載るのを避ける
      orderBy: { surface_form: 'asc' },
      take: limit,
    });

    this.logger.debug('AllVariantsLoaded', 'findAllVariantsForMatching', {
      count: result.length,
      limit,
      truncated: result.length >= limit,
    });

    return result;
  }

  /**
   * 料理カテゴリ一覧を取得
   */
  async getDishCategories() {
    this.logger.debug('GetDishCategories', 'getDishCategories', {});

    const result = await this.prisma.prisma.dish_categories.findMany();

    this.logger.debug('DishCategoriesFound', 'getDishCategories', {
      count: result.length,
    });
    return result;
  }
}
