import { Prisma } from '../../../../shared/prisma/client';
import { DishesRepository } from './dishes.repository';

describe('DishesRepository.createOrGetRestaurant', () => {
  const upsert = jest.fn();
  const tx = { restaurants: { upsert } } as unknown as Prisma.TransactionClient;
  const restaurant = {
    image_path: 'production/google-maps/photo/new.jpg',
    google_place_id: 'place-1',
  } as Prisma.restaurantsCreateInput;
  let repository: DishesRepository;

  beforeEach(() => {
    upsert.mockReset().mockResolvedValue({ id: 'restaurant-1' });
    repository = new DishesRepository(
      {} as never,
      { debug: jest.fn() } as never,
    );
  });

  it('updates only the image path after the handler has verified the original', async () => {
    await repository.createOrGetRestaurant(tx, restaurant, 'place-1', {
      updateImagePath: true,
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { google_place_id: 'place-1' },
      update: { image_path: restaurant.image_path },
      create: restaurant,
    });
  });

  it('keeps the synchronous pre-handler upsert idempotent', async () => {
    await repository.createOrGetRestaurant(tx, restaurant, 'place-1');

    expect(upsert).toHaveBeenCalledWith({
      where: { google_place_id: 'place-1' },
      update: {},
      create: restaurant,
    });
  });
});

describe('#1599 DishesRepository.createOrGetDishForCategory', () => {
  const findFirst = jest.fn();
  const createMany = jest.fn();
  const create = jest.fn();
  const tx = {
    dishes: { findFirst, createMany, create },
  } as unknown as Prisma.TransactionClient;

  const dish = {
    restaurant_id: 'restaurant-1',
    category_id: 'category-1',
    name: 'ラーメン',
  };
  const where = { restaurant_id: 'restaurant-1', category_id: 'category-1' };

  let repository: DishesRepository;

  beforeEach(() => {
    findFirst.mockReset();
    createMany.mockReset().mockResolvedValue({ count: 1 });
    create.mockReset();
    repository = new DishesRepository(
      {} as never,
      { debug: jest.fn() } as never,
    );
  });

  it('既にあるなら 1 クエリで返し、書き込みを試みない', async () => {
    findFirst.mockResolvedValueOnce({ id: 'dish-1', ...dish });

    await expect(repository.createOrGetDishForCategory(tx, dish)).resolves.toEqual(
      { id: 'dish-1', ...dish },
    );

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({ where });
    expect(createMany).not.toHaveBeenCalled();
  });

  it('無いなら ON CONFLICT DO NOTHING で入れて読み直す', async () => {
    findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'dish-2', ...dish });

    await expect(repository.createOrGetDishForCategory(tx, dish)).resolves.toEqual(
      { id: 'dish-2', ...dish },
    );

    // #1599 `create` は P2002 を投げうるので、この経路では絶対に使わない。
    // tx 内で P2002 が出るとトランザクション全体が aborted になり、
    // catch して読み直すこともできなくなる。
    expect(create).not.toHaveBeenCalled();
    expect(createMany).toHaveBeenCalledWith({
      data: [dish],
      skipDuplicates: true,
    });
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('id を渡されても create 入力からは落とす（DB 側の default に任せる）', async () => {
    findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'generated', ...dish });

    await repository.createOrGetDishForCategory(tx, {
      ...dish,
      id: 'caller-supplied-id',
    });

    expect(createMany).toHaveBeenCalledWith({
      data: [dish],
      skipDuplicates: true,
    });
  });

  it('競合: 2 本が同時に走っても、両方が同じ 1 行を返す（P2002 で 500 にならない）', async () => {
    // 実際の並行実行を模す。どちらの findFirst も空振りしたあと、
    // 片方の insert だけが実行され、もう片方は ON CONFLICT DO NOTHING で
    // 何もしない（= 例外にならない）。読み直しは両方が同じ行を見る。
    const rows: { id: string; restaurant_id: string; category_id: string }[] =
      [];

    findFirst.mockImplementation(async () => {
      // 1 本目・2 本目の先行 findFirst はまだ何も無いので空を返す
      return (
        rows.find(
          (r) =>
            r.restaurant_id === where.restaurant_id &&
            r.category_id === where.category_id,
        ) ?? null
      );
    });
    createMany.mockImplementation(async () => {
      const duplicate = rows.some(
        (r) =>
          r.restaurant_id === where.restaurant_id &&
          r.category_id === where.category_id,
      );
      if (duplicate) {
        // ON CONFLICT DO NOTHING: 投げずに 0 件
        return { count: 0 };
      }
      rows.push({ id: 'winner', ...where });
      return { count: 1 };
    });

    const [a, b] = await Promise.all([
      repository.createOrGetDishForCategory(tx, dish),
      repository.createOrGetDishForCategory(tx, dish),
    ]);

    expect(a).toEqual({ id: 'winner', ...where });
    expect(b).toEqual({ id: 'winner', ...where });
    expect(rows).toHaveLength(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('読み直しても見つからないなら黙って壊れず、原因の分かる例外にする', async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      repository.createOrGetDishForCategory(tx, dish),
    ).rejects.toThrow(/createOrGetDishForCategory/);
  });
});
