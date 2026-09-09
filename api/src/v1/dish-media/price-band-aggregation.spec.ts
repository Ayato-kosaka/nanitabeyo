// api/src/v1/dish-media/price-band-aggregation.spec.ts
//
// #1774 DishMediaRepository.findPriceBandsByDishIds の配線を検証する。
//
// 集計ルール自体（中央値・最低3件・通貨除外・NULL通貨の除外）は
// shared/utils/__tests__/priceBand.test.ts が computePriceBand を直接テストしているので、
// ここでは重複させない。ここで見るのは「dish_reviews から正しい行を引いて、
// dish_id ごとに正しく仕分けて computePriceBand へ渡しているか」という配線だけ。

import { DishMediaRepository } from './dish-media.repository';

describe('#1774 DishMediaRepository.findPriceBandsByDishIds', () => {
  const findMany = jest.fn();
  const prisma = { prisma: { dish_reviews: { findMany } } };
  let repository: DishMediaRepository;

  beforeEach(() => {
    findMany.mockReset();
    repository = new DishMediaRepository(
      prisma as never,
      { debug: jest.fn(), warn: jest.fn() } as never,
      {} as never,
    );
  });

  it('dish_id が無ければクエリを投げず空の Map を返す', async () => {
    const result = await (repository as any).findPriceBandsByDishIds([]);

    expect(findMany).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('deleted_at / price_cents / 退会ユーザーを除外する where を投げる', async () => {
    findMany.mockResolvedValue([]);

    await (repository as any).findPriceBandsByDishIds(['dish-1']);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        dish_id: { in: ['dish-1'] },
        deleted_at: null,
        price_cents: { not: null },
        OR: [{ user_id: null }, { users: { is: { deleted_at: null } } }],
      },
      select: { dish_id: true, price_cents: true, currency_code: true },
    });
  });

  it('dish_id ごとに仕分けて priceBand を計算する（中央値3件でJPY）', async () => {
    findMany.mockResolvedValue([
      { dish_id: 'dish-1', price_cents: 1000, currency_code: 'JPY' },
      { dish_id: 'dish-1', price_cents: 1000, currency_code: 'JPY' },
      { dish_id: 'dish-1', price_cents: 1000, currency_code: 'JPY' },
      // dish-2 はレビューが2件しか無いので priceBand は null になるはず
      { dish_id: 'dish-2', price_cents: 500, currency_code: 'JPY' },
      { dish_id: 'dish-2', price_cents: 500, currency_code: 'JPY' },
    ]);

    const result = await (repository as any).findPriceBandsByDishIds([
      'dish-1',
      'dish-2',
    ]);

    expect(result.get('dish-1')).toEqual({
      minCents: 1000,
      maxCents: 1500,
      currencyCode: 'JPY',
    });
    expect(result.get('dish-2')).toBeNull();
  });

  it('currency_code IS NULL の行（通貨バグの残骸）が母数に混ざらない', async () => {
    // #1774 PR #1700 (commit 88278abc) 以前の残骸。price_cents は非NULLだが
    // currency_code が NULL の行が混じっても、有効な JPY 2件だけでは3件未満なので null のまま
    findMany.mockResolvedValue([
      { dish_id: 'dish-1', price_cents: 1000, currency_code: 'JPY' },
      { dish_id: 'dish-1', price_cents: 1100, currency_code: 'JPY' },
      { dish_id: 'dish-1', price_cents: 100000, currency_code: null },
    ]);

    const result = await (repository as any).findPriceBandsByDishIds([
      'dish-1',
    ]);

    expect(result.get('dish-1')).toBeNull();
  });
});
