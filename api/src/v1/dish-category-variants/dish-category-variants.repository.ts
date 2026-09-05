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
   * 料理カテゴリ表記揺れを検索（**前方一致**。索引が効く速い方）。
   *
   * これで 0 件だったときだけ `findDishCategoryVariantsLoosely` へ落ちる。
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
   * #1629 前方一致で 0 件だったときの **緩い**検索。
   *
   * ## なぜ要るか（オーナー実機報告）
   *
   * > このお店検索のボックスが何を入力しても出ないのがちょっと気になりますね。
   * > 背脂ラーメンってカタカナで打っても出ないし。
   *
   * 既存の検索は `surface_form LIKE (q || '%')` の**前方一致だけ**だった。実ログ（dev /
   * 2026-08-29）でも `{"query":"すし","resultCount":0}` に対して `{"query":"寿司",
   * "resultCount":5}` で、**打ち方を変えると出たり出なかったりする**状態だった。
   * 「背脂ラーメン」のように **既存の表記を後ろに含む複合語**は、前方一致では永遠に出ない。
   *
   * ## 何を足したか
   *
   * | 順位 | 条件 | 例（q = 背脂ラーメン） |
   * | --- | --- | --- |
   * | 1 | 表記が q を含む | 「背脂ラーメン」があればそれ |
   * | 2 | **q が表記を含む** | 「ラーメン」が出る（これが今回の本命） |
   *
   * ⚠️ 2 の «q が表記を含む» は 1 文字の表記（「肉」等）が何にでも当たるので、
   *    **2 文字以上**に限る。誤爆すると候補が意味の無い並びになる。
   *
   * ## 速さについて
   *
   * どちらも索引が効かない（前方一致でないため）走査になる。だから **前方一致が 0 件の
   * ときしか呼ばない**。`dish_category_variants` は数千行規模の小さな辞書
   * （`findAllVariantsForMatching` の申し送り参照）で、0 件のときは今どのみち
   * «候補なし» を返しているので、ここでの 1 回の走査は割に合う。
   */
  async findDishCategoryVariantsLoosely(
    tx: Prisma.TransactionClient,
    q: string,
  ) {
    const qNorm = q.trim().toLowerCase();
    this.logger.debug(
      'FindDishCategoryVariantsLoosely',
      'findDishCategoryVariantsLoosely',
      { qNorm },
    );

    const result = await tx.$queryRaw<PrismaDishCategories[]>`
    WITH candidates AS (
      SELECT
        dc.id AS "dishCategoryId",
        MIN(CASE WHEN dcv.surface_form LIKE ('%' || ${qNorm} || '%') THEN 0 ELSE 1 END) AS match_rank,
        MIN(ABS(char_length(dcv.surface_form) - char_length(${qNorm}))) AS len_diff
      FROM dish_category_variants dcv
      JOIN dish_categories dc
        ON dc.id = dcv.dish_category_id
      WHERE dcv.surface_form LIKE ('%' || ${qNorm} || '%')
         OR (char_length(dcv.surface_form) >= 2
             AND ${qNorm} LIKE ('%' || dcv.surface_form || '%'))
      GROUP BY dc.id
    )
    SELECT
      dc.*
    FROM candidates c
    JOIN dish_categories dc
      ON dc.id = c."dishCategoryId"
    ORDER BY
      c.match_rank ASC,
      c.len_diff ASC,
      c."dishCategoryId" ASC
    LIMIT 20;
  `;

    this.logger.debug(
      'DishCategoryVariantsFoundLoosely',
      'findDishCategoryVariantsLoosely',
      { count: result.length },
    );
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
   *
   * ## ⚠️ #1273 «上限に当たったときに何を捨てるか» は順序が決める
   *
   * 上の «約 5,000 行» は外れていた。実データは **93,735 行**（BigQuery の
   * `dish_category_variant_catalog` を `9_4_sync_dish_category_variants.py` が
   * そのまま同期する。カテゴリは 14,597 件ある）で、上限 50,000 に**当たっている**。
   *
   * このとき `ORDER BY surface_form ASC` だと、捨てられる行が**文字体系で偏る**。
   * ラテン文字は CJK より前に並ぶので、先頭 50,000 行はほぼラテン文字で埋まり、
   * **CJK の 15,160 行のうち 15,125 行（99.8%）が辞書に載らない**（実測 2026-09-05）。
   * アプリが検索できる 134 カテゴリに限ると **471 行中 0 行**しか載っていなかった。
   *
   * そこで «アプリが検索に出せるカテゴリ（`dish_category_features` を持つもの）の行» を
   * 先に載せる。この 134 カテゴリぶんは全部で 3,290 行しかないので、上限が何であれ
   * **必ず全部載る**（＝日本語の別名も漢字・かなの別表記も落ちない）。
   *
   * ⚠️ **«CJK を全部先に載せる» にはしない。** 残り 14,463 カテゴリの CJK 別名は
   * «検索から永久に到達できないカテゴリ»（#1748）を指しており、載せると
   * `buildJapaneseLabelVariants` が足し戻した表記と衝突して
   * `putUnique` が**両方**捨てる／その QID で保存されて検索に出ない、のどちらかになる。
   * 上限で落ちているおかげで今はその事故が起きていないので、順序を変えて掘り起こさない。
   *
   * ## この順序で新しく生まれる曖昧さ（実測 1 件）
   *
   * 新しく載る 1,715 行のうち、**別カテゴリの `labels.ja` と衝突するのは `魚生` の 1 件だけ**
   * （`刺身盛り合わせ` の中国語ラベル vs `魚生`(Q2609461) の日本語ラベル。BigQuery 実測 2026-09-05）。
   * 他の 6 件（`焼肉` `餃子` `かき氷` `タルト` `ナポリタン` `親子丼`）は
   * **`buildJapaneseLabelVariants` の足し戻しで既に衝突している**ものなので、この変更とは無関係。
   */
  async findAllVariantsForMatching(limit: number) {
    const result = await this.prisma.prisma.$queryRaw<
      {
        dish_category_id: string;
        surface_form: string;
        source: string | null;
        searchable: boolean;
      }[]
    >`
      SELECT
        v.dish_category_id,
        v.surface_form,
        v.source,
        (f.dish_category_id IS NOT NULL) AS searchable
      FROM dish_category_variants v
      -- 検索に出せるカテゴリは 134 件しかないので、DISTINCT の結果をハッシュ結合する
      LEFT JOIN (
        SELECT DISTINCT dish_category_id FROM dish_category_features
      ) f ON f.dish_category_id = v.dish_category_id
      ORDER BY
        -- アプリが検索に出せるカテゴリを先に。ここが上限で削られてはいけない部分
        (f.dish_category_id IS NOT NULL) DESC,
        -- 残りは従来どおり。上限に当たったときに毎回違う辞書が載るのを避ける
        v.surface_form ASC
      LIMIT ${limit}
    `;

    // #1273 「アプリのカテゴリぶんが全部載ったか」を後から確認できるようにする。
    // truncated=true でも searchable の数が減っていなければ、落ちたのは
    // «検索に出ないカテゴリの別名» だけである（＝実害が無い切り捨て）。
    let searchableCount = 0;
    for (const row of result) if (row.searchable) searchableCount += 1;

    this.logger.debug('AllVariantsLoaded', 'findAllVariantsForMatching', {
      count: result.length,
      searchableCount,
      limit,
      truncated: result.length >= limit,
    });

    return result.map((row) => ({
      dish_category_id: row.dish_category_id,
      surface_form: row.surface_form,
      source: row.source,
    }));
  }

  /**
   * #1273 照合辞書を補うために、各料理カテゴリの **多言語ラベル（`labels` Json）** を全件読む。
   *
   * ## なぜ必要か（辞書に «自分の日本語名» が無いカテゴリがある）
   *
   * `dish_category_variants` は BigQuery の `4_1_generate_variants.py` が生成するが、
   * その最終段で **surface_form をグローバルに一意化**している（同じ表記が複数カテゴリに
   * ぶら下がると canonical / QID 優先で 1 つへ寄せ、残りを捨てる）。この一意化は
   * Wikidata 全カテゴリ（約 9 万件）を母集団に走るため、`焼肉` `和食` `餃子` のような
   * **ありふれた日本語表記が、アプリの 134 カテゴリではない別カテゴリへ持っていかれ**、
   * アプリが読む 134 カテゴリ分の辞書からは丸ごと欠落する（実測: 134 中 24 カテゴリが
   * 自分の日本語ラベルを 1 つも持たない。#1273 resolve 精度計測）。
   *
   * その結果、キャプションに「焼肉」と明記があっても料理カテゴリ候補が 1 件も出ない。
   * ここで各カテゴリの `labels.ja`（表示名の正）を辞書へ足し戻すことで、
   * **DB を書き換えずに** この取りこぼしを塞ぐ（`DishCategoryVariantDictionaryService` が合成する）。
   *
   * `labels` は全言語を含む Json なので、日本語以外まで足すと多言語ラベルの誤爆が戻る。
   * **日本語ラベルの抽出は呼び出し側**（`buildJapaneseLabelVariants`）で行い、ここは生の行を返す。
   */
  async findAllCategoryLabelsForMatching(limit: number) {
    const result = await this.prisma.prisma.dish_categories.findMany({
      select: {
        id: true,
        labels: true,
      },
      orderBy: { id: 'asc' },
      take: limit,
    });

    this.logger.debug(
      'AllCategoryLabelsLoaded',
      'findAllCategoryLabelsForMatching',
      { count: result.length, limit, truncated: result.length >= limit },
    );

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
