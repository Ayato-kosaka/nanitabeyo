/*
#1273【欠陥】照合辞書の読み込み上限に当たったとき、**捨てられる行が文字体系で偏っていた**。

`dish_category_variants` は実データ 93,735 行あり、上限 50,000 に常に当たっている。
`ORDER BY surface_form ASC` だとラテン文字が CJK より前に並ぶので、先頭 50,000 行は
ほぼラテン文字で埋まり、**CJK 15,160 行のうち 15,125 行（99.8%）が辞書に載らない**。
アプリが検索に出せる 134 カテゴリに限ると **471 行中 0 行**しか載っていなかった
（BigQuery `dish_category_variant_catalog` 実測 / 2026-09-05）。

ここで固定するのは «上限に当たったときに何を残すか» という**順序の性質**である。
行数や文字体系の判定式そのものではなく、「アプリが検索に出せるカテゴリ
（`dish_category_features` を持つもの）の行を先に読む」ことをテストする。
この性質が消えると、上限に当たった瞬間にまた静かに辞書が痩せる。
*/
import { Test, TestingModule } from '@nestjs/testing';

import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DishCategoryVariantsRepository } from './dish-category-variants.repository';

describe('DishCategoryVariantsRepository#findAllVariantsForMatching（#1273 上限の削られ方）', () => {
  let repository: DishCategoryVariantsRepository;
  let lastSql: string;
  let lastValues: unknown[];

  const queryRaw = jest.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      lastSql = strings.join('?');
      lastValues = values;
      return Promise.resolve([
        {
          dish_category_id: 'Q234646',
          surface_form: 'らーめん',
          source: 'kata2hira',
          searchable: true,
        },
      ]);
    },
  );

  beforeEach(async () => {
    jest.clearAllMocks();
    lastSql = '';
    lastValues = [];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishCategoryVariantsRepository,
        { provide: PrismaService, useValue: { prisma: { $queryRaw: queryRaw } } },
        {
          provide: AppLoggerService,
          useValue: { debug: jest.fn(), log: jest.fn(), error: jest.fn() },
        },
      ],
    }).compile();

    repository = module.get(DishCategoryVariantsRepository);
  });

  it('アプリが検索に出せるカテゴリ（dish_category_features を持つもの）を先に読む', async () => {
    await repository.findAllVariantsForMatching(50_000);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(lastSql).toContain('dish_category_features');

    const orderBy = lastSql.slice(lastSql.indexOf('ORDER BY'));
    const searchableAt = orderBy.indexOf('f.dish_category_id IS NOT NULL');
    const surfaceAt = orderBy.indexOf('v.surface_form');

    // 「検索に出せるか」が surface_form より **先の** ソートキーであること。
    // 逆になった時点で、上限に当たったぶんがアプリのカテゴリから削られ始める
    expect(searchableAt).toBeGreaterThanOrEqual(0);
    expect(surfaceAt).toBeGreaterThan(searchableAt);
    expect(orderBy.slice(searchableAt, surfaceAt)).toContain('DESC');
  });

  it('上限は SQL へ埋め込まずパラメータで渡す', async () => {
    await repository.findAllVariantsForMatching(1_234);

    expect(lastSql).toContain('LIMIT');
    expect(lastValues).toEqual([1_234]);
  });

  it('照合に使う 3 列だけを返す（並べ替え用の searchable は漏らさない）', async () => {
    const rows = await repository.findAllVariantsForMatching(50_000);

    expect(rows).toEqual([
      {
        dish_category_id: 'Q234646',
        surface_form: 'らーめん',
        source: 'kata2hira',
      },
    ]);
  });
});
