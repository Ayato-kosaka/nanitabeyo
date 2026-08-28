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

/** 辞書として読む行数の上限。実測見込み（約 5,000 行）の 10 倍を安全余裕として取る */
export const DISH_CATEGORY_VARIANT_LOAD_LIMIT = 50_000;

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
    const rows = await this.repo.findAllVariantsForMatching(
      DISH_CATEGORY_VARIANT_LOAD_LIMIT,
    );

    const entries: DishCategoryVariantEntry[] = rows.map((row) => ({
      dishCategoryId: row.dish_category_id,
      surfaceForm: row.surface_form,
      source: row.source,
    }));

    const index = buildDishCategoryVariantIndex(entries);
    this.cache = { index, loadedAt: now };

    this.logger.log('DishCategoryVariantIndexBuilt', 'load', {
      rows: rows.length,
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
