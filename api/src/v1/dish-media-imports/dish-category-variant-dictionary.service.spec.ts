// api/src/v1/dish-media-imports/dish-category-variant-dictionary.service.spec.ts

jest.mock('src/core/config/env', () => ({
  env: {
    API_COMMIT_ID: 'test',
    API_NODE_ENV: 'test',
  },
}));

import { AppLoggerService } from '../../core/logger/logger.service';
import { DishCategoryVariantsRepository } from '../dish-category-variants/dish-category-variants.repository';
import {
  DISH_CATEGORY_VARIANT_CACHE_TTL_MS,
  DISH_CATEGORY_VARIANT_LOAD_LIMIT,
  DishCategoryVariantDictionaryService,
} from './dish-category-variant-dictionary.service';

function createHarness() {
  const findAllVariantsForMatching = jest.fn().mockResolvedValue([
    {
      dish_category_id: 'Q1',
      surface_form: 'ラーメン',
      source: 'wikidata-label',
    },
    {
      dish_category_id: 'Q2',
      surface_form: '味噌ラーメン',
      source: 'wikidata-label',
    },
  ]);

  const logger = {
    verbose: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLoggerService;

  const service = new DishCategoryVariantDictionaryService(
    { findAllVariantsForMatching } as unknown as DishCategoryVariantsRepository,
    logger,
  );

  return { service, findAllVariantsForMatching };
}

describe('DishCategoryVariantDictionaryService', () => {
  it('辞書を索引に組み直して返す', async () => {
    const { service, findAllVariantsForMatching } = createHarness();

    const index = await service.getIndex();

    expect(index.exact.get('ラーメン')?.dishCategoryId).toBe('Q1');
    expect(findAllVariantsForMatching).toHaveBeenCalledWith(
      DISH_CATEGORY_VARIANT_LOAD_LIMIT,
    );
  });

  it('TTL 内は DB を読み直さない', async () => {
    const { service, findAllVariantsForMatching } = createHarness();

    const now = 1_000_000;
    await service.getIndex(now);
    await service.getIndex(now + DISH_CATEGORY_VARIANT_CACHE_TTL_MS - 1);

    expect(findAllVariantsForMatching).toHaveBeenCalledTimes(1);
  });

  it('TTL を過ぎたら読み直す', async () => {
    const { service, findAllVariantsForMatching } = createHarness();

    const now = 1_000_000;
    await service.getIndex(now);
    await service.getIndex(now + DISH_CATEGORY_VARIANT_CACHE_TTL_MS);

    expect(findAllVariantsForMatching).toHaveBeenCalledTimes(2);
  });

  it('同時に呼ばれても全件読みは 1 回だけ', async () => {
    const { service, findAllVariantsForMatching } = createHarness();

    await Promise.all([
      service.getIndex(),
      service.getIndex(),
      service.getIndex(),
    ]);

    expect(findAllVariantsForMatching).toHaveBeenCalledTimes(1);
  });

  it('読み込みに失敗しても次回に再挑戦できる（in-flight を握りっぱなしにしない）', async () => {
    const { service, findAllVariantsForMatching } = createHarness();
    findAllVariantsForMatching.mockRejectedValueOnce(new Error('db down'));

    await expect(service.getIndex()).rejects.toThrow('db down');
    await expect(service.getIndex()).resolves.toBeDefined();
    expect(findAllVariantsForMatching).toHaveBeenCalledTimes(2);
  });
});
