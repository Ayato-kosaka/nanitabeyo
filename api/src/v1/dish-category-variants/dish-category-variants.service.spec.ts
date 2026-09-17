/*
#1629【オーナー実機報告】料理カテゴリーの候補が «打ち方次第で出たり出なかったり» する。

> このお店検索のボックスが何を入力しても出ないのがちょっと気になりますね。
> 背脂ラーメンってカタカナで打っても出ないし。

dev の実ログ（2026-08-29）でも `{"query":"すし","resultCount":0}` の直後に
`{"query":"寿司","resultCount":5}` が出ており、前方一致だけでは «既存の表記を後ろに含む
複合語»（背脂ラーメン → ラーメン）が永遠に出ない状態だった。

ここで固定するのは **落とし方**である。
1. 前方一致で 1 件でも出たら、そこで返す（索引が効く速い方だけで済ませる）
2. 0 件のときだけ緩い検索へ落ちる（索引が効かないので、常用の入力では走らせない）
*/
import { Test, TestingModule } from '@nestjs/testing';

import { AppLoggerService } from '../../core/logger/logger.service';
import { ExternalApiService } from '../../core/external-api/external-api.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DishCategoryVariantsRepository } from './dish-category-variants.repository';
import { DishCategoryVariantsService } from './dish-category-variants.service';

describe('DishCategoryVariantsService（#1629 候補の落とし方）', () => {
  let service: DishCategoryVariantsService;

  const repo = {
    findDishCategoryVariants: jest.fn(),
    findDishCategoryVariantsLoosely: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishCategoryVariantsService,
        { provide: DishCategoryVariantsRepository, useValue: repo },
        { provide: ExternalApiService, useValue: {} },
        {
          provide: PrismaService,
          // withTransaction は «渡された関数をそのまま走らせる» だけの薄い包み
          useValue: {
            withTransaction: (fn: (tx: unknown) => unknown) => fn({}),
          },
        },
        {
          provide: AppLoggerService,
          useValue: {
            debug: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(DishCategoryVariantsService);
  });

  it('前方一致で見つかったら、緩い検索は走らせない', async () => {
    repo.findDishCategoryVariants.mockResolvedValue([
      { id: 'Q1', labels: { ja: 'ラーメン' }, label_en: 'Ramen' },
    ]);

    const result = await service.findDishCategoryVariants({
      q: 'ラーメン',
      lang: 'ja',
    } as never);

    expect(result).toEqual([{ dishCategoryId: 'Q1', label: 'ラーメン' }]);
    expect(repo.findDishCategoryVariantsLoosely).not.toHaveBeenCalled();
  });

  // ★ ここが本命。«背脂ラーメン» のような複合語がここで拾われる
  it('前方一致が 0 件のときだけ緩い検索へ落ちる', async () => {
    repo.findDishCategoryVariants.mockResolvedValue([]);
    repo.findDishCategoryVariantsLoosely.mockResolvedValue([
      { id: 'Q1', labels: { ja: 'ラーメン' }, label_en: 'Ramen' },
    ]);

    const result = await service.findDishCategoryVariants({
      q: '背脂ラーメン',
      lang: 'ja',
    } as never);

    expect(repo.findDishCategoryVariantsLoosely).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ dishCategoryId: 'Q1', label: 'ラーメン' }]);
  });

  it('どちらでも見つからなければ 0 件を返す（例外にしない）', async () => {
    repo.findDishCategoryVariants.mockResolvedValue([]);
    repo.findDishCategoryVariantsLoosely.mockResolvedValue([]);

    await expect(
      service.findDishCategoryVariants({ q: 'ぬるぽ', lang: 'ja' } as never),
    ).resolves.toEqual([]);
  });
});
