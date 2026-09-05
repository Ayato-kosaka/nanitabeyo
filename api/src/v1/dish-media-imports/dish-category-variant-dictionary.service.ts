// api/src/v1/dish-media-imports/dish-category-variant-dictionary.service.ts
//
// `dish_category_variants` を照合用の索引に組み直して**プロセス内に持つ**（読み取りのみ）。
//
// ## なぜキャッシュするか
//
// 照合は `shared/utils/dishCategoryMatch.ts` の純関数が行い、辞書は**引数で渡す**契約になっている。
// 素直に実装すると import のたびに全件読みが走るので、TTL つきで持ち回る。
//
// ## TTL を長くとる理由
//
// `dish_category_variants` は `scripts/20251213T0000_wikidata_food_graph/4_1_generate_variants.py`
// を手で流したときにしか変わらない。`api/src/core/static-master/` は TTL 5 分だが、
// あれは `config` のようにダッシュボードから変わりうる表のための値であって、
// **この表を 5 分ごとに読み直す理由は無い**（独立レビュー M-5）。
//
// ## 起動時ロードにしない理由
//
// `static-master.service.ts` と同じく**初回リクエスト時の遅延ロード**にしてある。
// 起動時ロードにすると、SNS import を一度も使わないインスタンスまで DB を叩く。
// 代わりに「最初の 1 リクエストが辞書ロードを被る」ことになるが、
// import はユーザーが手で行う稀な操作なので許容する。

import { Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../core/logger/logger.service';
import { DishCategoryVariantsRepository } from '../dish-category-variants/dish-category-variants.repository';
import {
  buildDishCategoryVariantIndex,
  type DishCategoryVariantEntry,
  type DishCategoryVariantIndex,
} from '../../../../shared/utils/dishCategoryMatch';
import { buildJapaneseLabelVariants } from '../../../../shared/utils/dishCategoryDictionary';

/** 辞書として読む行数の上限。実測見込み（約 5,000 行）の 10 倍を安全余裕として取る */
export const DISH_CATEGORY_VARIANT_LOAD_LIMIT = 50_000;

/**
 * #1273 日本語ラベルの足し戻し（`buildJapaneseLabelVariants` / `DISH_CATEGORY_JA_LABEL_SYNONYMS`）は
 * **`shared/utils/dishCategoryDictionary.ts` が正**。ここからは再輸出するだけにしてある。
 *
 * 照合規則（`dishCategoryMatch.ts`）と同じく、辞書の作り方も api の外に置く。
 * NestJS / Prisma を読み込まずにこの純関数だけを呼べるようにしておかないと、辞書の当たり方を
 * オフラインで測り直す側が **表記ゆれの表を書き写す**方向へ逃げ、本番だけ直したときに
 * 測定側が古い表のまま緑になる（CLAUDE.md「本番のロジックをテストへ写経しない」）。
 */
export {
  DISH_CATEGORY_JA_LABEL_SYNONYMS,
  buildJapaneseLabelVariants,
} from '../../../../shared/utils/dishCategoryDictionary';

/** キャッシュの寿命（ms）。6 時間 */
export const DISH_CATEGORY_VARIANT_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;

type CacheEntry = {
  index: DishCategoryVariantIndex;
  loadedAt: number;
};

@Injectable()
export class DishCategoryVariantDictionaryService {
  private cache: CacheEntry | null = null;

  /** 同時アクセスで全件読みが重ならないようにするための in-flight 共有 */
  private inFlight: Promise<DishCategoryVariantIndex> | null = null;

  constructor(
    private readonly repo: DishCategoryVariantsRepository,
    private readonly logger: AppLoggerService,
  ) {}

  async getIndex(now: number = Date.now()): Promise<DishCategoryVariantIndex> {
    if (
      this.cache !== null &&
      now - this.cache.loadedAt < DISH_CATEGORY_VARIANT_CACHE_TTL_MS
    ) {
      return this.cache.index;
    }

    if (this.inFlight !== null) return this.inFlight;

    this.inFlight = this.load(now).finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private async load(now: number): Promise<DishCategoryVariantIndex> {
    const startedAt = Date.now();
    // #1273 辞書本体（グローバル一意化で日本語ラベルが欠けうる）と、各カテゴリの
    // `labels.ja` を並行で読み、後者で欠落を補ってから索引化する。互いに依存しないので並列。
    const [rows, categoryRows] = await Promise.all([
      this.repo.findAllVariantsForMatching(DISH_CATEGORY_VARIANT_LOAD_LIMIT),
      this.repo.findAllCategoryLabelsForMatching(
        DISH_CATEGORY_VARIANT_LOAD_LIMIT,
      ),
    ]);

    const entries: DishCategoryVariantEntry[] = rows.map((row) => ({
      dishCategoryId: row.dish_category_id,
      surfaceForm: row.surface_form,
      source: row.source,
    }));

    // #1273 各カテゴリの日本語ラベル（＋表記ゆれ）を追い足す。同じ (カテゴリ, 表記) は
    // `buildDishCategoryVariantIndex` の putUnique が冪等に畳むので、二重計上にはならない。
    const japaneseLabelEntries = buildJapaneseLabelVariants(categoryRows);

    const index = buildDishCategoryVariantIndex([
      ...entries,
      ...japaneseLabelEntries,
    ]);
    this.cache = { index, loadedAt: now };

    this.logger.log('DishCategoryVariantIndexBuilt', 'load', {
      rows: rows.length,
      // #1273 labels.ja から足し戻した補助エントリ数（辞書欠落の規模の目安）
      japaneseLabelEntries: japaneseLabelEntries.length,
      // 索引に載らなかった行（同じ表記に複数カテゴリ）の件数。増えていたら辞書側の異常
      ambiguousCount: index.ambiguousCount,
      scannableCount: index.scannable.length,
      elapsedMs: Date.now() - startedAt,
      // 上限に達していたら辞書が想定より大きい。閾値の見直しが要る
      truncated: rows.length >= DISH_CATEGORY_VARIANT_LOAD_LIMIT,
    });

    return index;
  }
}
