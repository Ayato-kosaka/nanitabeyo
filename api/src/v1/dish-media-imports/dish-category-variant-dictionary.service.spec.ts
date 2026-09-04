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
  buildJapaneseLabelVariants,
  DISH_CATEGORY_VARIANT_CACHE_TTL_MS,
  DISH_CATEGORY_VARIANT_LOAD_LIMIT,
  DishCategoryVariantDictionaryService,
} from './dish-category-variant-dictionary.service';

function createHarness(categoryRows: unknown[] = []) {
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
  const findAllCategoryLabelsForMatching = jest
    .fn()
    .mockResolvedValue(categoryRows);

  const logger = {
    verbose: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLoggerService;

  const service = new DishCategoryVariantDictionaryService(
    {
      findAllVariantsForMatching,
      findAllCategoryLabelsForMatching,
    } as unknown as DishCategoryVariantsRepository,
    logger,
  );

  return {
    service,
    findAllVariantsForMatching,
    findAllCategoryLabelsForMatching,
  };
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

  // #1273 グローバル一意化で日本語ラベルを失ったカテゴリを、labels.ja から辞書へ足し戻す
  it('辞書に日本語ラベルが無いカテゴリでも labels.ja から候補が出る', async () => {
    // Q焼肉 の変種は romaji しか無い（= 本文「焼肉」では当たらない）状態を再現
    const { service, findAllVariantsForMatching } = createHarness([
      { id: 'Q焼肉', labels: { ja: '焼肉', en: 'yakiniku' } },
    ]);
    findAllVariantsForMatching.mockResolvedValueOnce([
      { dish_category_id: 'Q焼肉', surface_form: 'yakiniku', source: 'romaji' },
    ]);

    const index = await service.getIndex();

    expect(index.exact.get('焼肉')?.dishCategoryId).toBe('Q焼肉');
    expect(index.scannable.some((s) => s.surfaceForm === '焼肉')).toBe(true);
  });

  it('labels.ja の表記ゆれ（焼鳥・やきとり など）も辞書へ足す', async () => {
    const { service } = createHarness([
      { id: 'Q焼き鳥', labels: { ja: '焼き鳥' } },
    ]);

    const index = await service.getIndex();

    expect(index.exact.get('焼き鳥')?.dishCategoryId).toBe('Q焼き鳥');
    expect(index.exact.get('焼鳥')?.dishCategoryId).toBe('Q焼き鳥');
    expect(index.exact.get('やきとり')?.dishCategoryId).toBe('Q焼き鳥');
  });
});

describe('buildJapaneseLabelVariants', () => {
  it('labels.ja とその表記ゆれをエントリ化する', () => {
    const out = buildJapaneseLabelVariants([
      { id: 'Q1', labels: { ja: '餃子' } },
    ]);

    const surfaces = out.map((e) => e.surfaceForm);
    expect(surfaces).toContain('餃子');
    // 収録済みの表記ゆれ（ぎょうざ / ギョーザ / ギョウザ）
    expect(surfaces).toEqual(
      expect.arrayContaining(['ぎょうざ', 'ギョーザ', 'ギョウザ']),
    );
    // 本文走査で減点されない source を付ける
    expect(out.every((e) => e.source === 'wikidata-label')).toBe(true);
    expect(out.every((e) => e.dishCategoryId === 'Q1')).toBe(true);
  });

  it('labels が Json でない・ja が無い・空の行は黙って捨てる（例外を投げない）', () => {
    expect(
      buildJapaneseLabelVariants([
        { id: 'Q1', labels: null },
        { id: 'Q2', labels: ['ja', 'x'] as unknown },
        { id: 'Q3', labels: { en: 'curry' } },
        { id: 'Q4', labels: { ja: '   ' } },
        { id: '', labels: { ja: 'ラーメン' } },
      ]),
    ).toEqual([]);
  });

  it('null / 非配列でも空配列を返す', () => {
    expect(buildJapaneseLabelVariants(null)).toEqual([]);
    expect(buildJapaneseLabelVariants(undefined)).toEqual([]);
  });
});
