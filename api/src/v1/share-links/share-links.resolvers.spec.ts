/**
 * #1851 共有カード（OGP）の料理名が **カテゴリのローカライズ表記**になることを固定する。
 *
 * ⚠️ **ここが壊れると、SNS へ共有したカードにだけ英語・ローマ字の料理名が出る。**
 * アプリ内の表示は #1375 で `dish_categories` の表記へ切り替わったが、
 * 共有カードだけが `dishes.name` を見たまま取り残されていた。
 *
 * しかも `dishes.name` は NOT NULL なので、旧実装の
 *   `head.dishes.name ?? localizedCategory?.topic_title`
 * は **1 度も右辺へ落ちない**。「無ければローカライズ名へ落とす」と書いてあるのに、
 * 実際には常に左辺が採られていた。**コメントが嘘をついている形の欠陥**である。
 */
import { ShareLinkTargetResolvers } from './share-links.resolvers';

type Head = {
  id: string;
  thumbnail_path: string | null;
  dishes: {
    /**
     * ⚠️ **実データに合わせて必ず入れておくこと。** `dishes.name` は現在 NOT NULL で、
     * ここを省くと «旧実装（name 優先）へ戻しても緑のまま» になり、テストが
     * 事故を再現しなくなる（実際に一度そうなった）。
     */
    name: string;
    category_id: string;
    restaurants: { name: string };
  };
};

/** 必要な 2 つのテーブルだけを持つ最小の prisma 代役 */
const makeResolver = (head: Head | null, topicTitle: string | null) => {
  const prisma = {
    dish_media: {
      findFirst: jest.fn().mockResolvedValue(head),
      findMany: jest.fn().mockResolvedValue(head ? [{ id: head.id }] : []),
    },
    dish_category_localized_text: {
      findUnique: jest
        .fn()
        .mockResolvedValue(topicTitle === null ? null : { topic_title: topicTitle }),
    },
  };
  const resolvers = new ShareLinkTargetResolvers(
    { prisma } as never,
    { error: jest.fn(), warn: jest.fn(), log: jest.fn() } as never,
  );
  return { resolvers, prisma };
};

const HEAD: Head = {
  id: '11111111-1111-4111-8111-111111111111',
  thumbnail_path: 'thumb/1.jpg',
  dishes: {
    // パイプライン製の店で実際に入っている形（英語ラベル）
    name: 'Fried chicken set meal',
    category_id: '22222222-2222-4222-8222-222222222222',
    restaurants: { name: 'からあげ食堂' },
  },
};

describe('#1851 共有カードの料理名', () => {
  it('ロケールの topic_title を使う（dishes.name は見ない）', async () => {
    const { resolvers } = makeResolver(HEAD, '唐揚げ定食');
    const res = await resolvers.resolve('dish_media', { ids: [HEAD.id] }, 'ja-JP');
    expect(res.previewTitle).toContain('唐揚げ定食');
    // ⚠️ 旧実装はここで英語名を出していた
    expect(res.previewTitle).not.toContain('Fried chicken set meal');
  });

  it('topic_title が無ければ店舗名だけのカードにする（タイトルが空になる方が悪い）', async () => {
    const { resolvers } = makeResolver(HEAD, null);
    const res = await resolvers.resolve('dish_media', { ids: [HEAD.id] }, 'ja-JP');
    expect(res.previewTitle).toContain('からあげ食堂');
    expect(res.previewTitle).not.toContain('Fried chicken set meal');
  });

  it('⚠️ dishes.name を SELECT しない（列を落とすので、参照が復活したら赤にする）', async () => {
    const { resolvers, prisma } = makeResolver(HEAD, '唐揚げ定食');
    await resolvers.resolve('dish_media', { ids: [HEAD.id] }, 'ja-JP');
    const select = prisma.dish_media.findFirst.mock.calls[0][0].select;
    expect(select.dishes.select).not.toHaveProperty('name');
  });

  it('⚠️ topic_title は **常に** 引く（旧実装は dishes.name があると引かなかった）', async () => {
    const { resolvers, prisma } = makeResolver(HEAD, '唐揚げ定食');
    await resolvers.resolve('dish_media', { ids: [HEAD.id] }, 'ja-JP');
    expect(prisma.dish_category_localized_text.findUnique).toHaveBeenCalledTimes(1);
  });
});
