import { UsersRepository } from './users.repository';

/**
 * #1599 退会処理の `like_total` 引き直しが N+1 だった件。
 *
 * 対象 1 件ごとに `count` + `updateMany` の 2 クエリを直列に投げるループで、
 * `affectedDishMediaIds` は **そのユーザーがいいねした dish_media の数**。上限が無い。
 * しかも全部が 1 つの `withTransaction`（PRISMA_TX_TIMEOUT の既定は 60 秒）の中で走る。
 *
 * 3,000 件いいねしていれば 6,000 クエリになり、**よく使っていた人ほど退会に失敗する**。
 * 失敗の仕方が決定的なので、再実行しても同じところで落ち続ける。
 * 利用規約は「設定画面からいつでも削除できる」と約束している。
 */
type Tx = {
  $queryRaw: jest.Mock;
  dish_media_likes: { findMany: jest.Mock; deleteMany: jest.Mock; count: jest.Mock };
  dish_media_analysis_results: { updateMany: jest.Mock };
  reactions: { deleteMany: jest.Mock };
  user_device_tokens: { deleteMany: jest.Mock };
  user_notification_cursors: { deleteMany: jest.Mock };
  notification_recipients: { deleteMany: jest.Mock };
  user_roles: { deleteMany: jest.Mock };
  users: { updateMany: jest.Mock };
};

const USER_ID = '11111111-1111-4111-8111-111111111111';

function buildTx(likedMediaIds: string[]): Tx {
  const none = jest.fn().mockResolvedValue({ count: 0 });
  return {
    // 更新できた行を RETURNING で返す想定
    $queryRaw: jest
      .fn()
      .mockResolvedValue(likedMediaIds.map((id) => ({ dish_media_id: id }))),
    dish_media_likes: {
      findMany: jest
        .fn()
        .mockResolvedValue(likedMediaIds.map((id) => ({ dish_media_id: id }))),
      deleteMany: jest.fn().mockResolvedValue({ count: likedMediaIds.length }),
      // ループが残っていたら呼ばれてしまう
      count: jest.fn().mockResolvedValue(0),
    },
    dish_media_analysis_results: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    reactions: { deleteMany: none },
    user_device_tokens: { deleteMany: none },
    user_notification_cursors: { deleteMany: none },
    notification_recipients: { deleteMany: none },
    user_roles: { deleteMany: none },
    users: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
}

function buildRepository(tx: Tx): UsersRepository {
  const prisma = {
    withTransaction: (fn: (t: unknown) => unknown) => fn(tx),
  };
  return new UsersRepository(
    prisma as never,
    { debug: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
  );
}

/** タグ付きテンプレートで渡された SQL を 1 本の文字列に戻す */
const sqlTextOf = (call: unknown[]): string => (call[0] as string[]).join(' ? ');

describe('#1599 退会処理の like_total 引き直しは件数に依らず 1 クエリ', () => {
  it.each([1, 10, 3000])(
    'いいね %i 件でも $queryRaw は 1 回だけ（N+1 が消えている）',
    async (count) => {
      const ids = Array.from(
        { length: count },
        (_, i) => `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`,
      );
      const tx = buildTx(ids);

      await buildRepository(tx).softDeleteUserAccount(USER_ID);

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      // ループの痕跡が残っていないこと。ここが呼ばれるなら件数ぶん往復している
      expect(tx.dish_media_likes.count).not.toHaveBeenCalled();
      expect(tx.dish_media_analysis_results.updateMany).not.toHaveBeenCalled();
    },
  );

  it('1 件も無いなら、そもそもクエリを投げない', async () => {
    const tx = buildTx([]);

    const result = await buildRepository(tx).softDeleteUserAccount(USER_ID);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(result.likeTotalsRecalculated).toBe(0);
  });

  it('引き直した件数は RETURNING の行数から取る', async () => {
    const ids = ['a', 'b', 'c'].map(
      (c) => `33333333-3333-4333-8333-${c.repeat(12)}`,
    );
    const tx = buildTx(ids);
    // dish_media_analysis_results が無い dish_media は更新されない（= 行が返らない）
    tx.$queryRaw.mockResolvedValue([{ dish_media_id: ids[0] }]);

    const result = await buildRepository(tx).softDeleteUserAccount(USER_ID);

    expect(result.likeTotalsRecalculated).toBe(1);
  });

  it('SQL は「実数で数え直す」形を保つ（減算にすり替わっていない）', async () => {
    const tx = buildTx(['44444444-4444-4444-8444-444444444444']);

    await buildRepository(tx).softDeleteUserAccount(USER_ID);

    const sql = sqlTextOf(tx.$queryRaw.mock.calls[0]);
    expect(sql).toContain('UPDATE dish_media_analysis_results');
    // 冪等性の要。COUNT で数え直しており、like_total - 1 のような減算ではない
    expect(sql).toContain('COUNT(l.dish_media_id)');
    expect(sql).not.toMatch(/like_total\s*[-+]/);
    // いいねが 0 件になった投稿も 0 に落とす必要があるので LEFT JOIN
    expect(sql).toContain('LEFT JOIN dish_media_likes');
    // 対象は「控えておいた ID の集合」だけ。全件更新にすり替わっていないこと
    expect(sql).toContain('UNNEST(');
    expect(sql).toContain('RETURNING');
  });

  // ⚠️ SQL 側の DISTINCT は「呼び出し側が new Set しているから冗長」ではない。
  // 同じ id が配列に 2 回入ると UNNEST がその id の行を 2 行返し、LEFT JOIN が
  // いいね 1 件につき 2 行に増え、COUNT が **2 倍の値**になる。
  // like_total は画面に出る数字なので、静かに倍になる壊れ方をする。
  // 「片方を消したら壊れる」形にしないため、両側を別々に固定しておく。
  it('重複した id を渡されても数え上げが倍にならない（SQL 側で DISTINCT する）', async () => {
    const tx = buildTx(['66666666-6666-4666-8666-666666666666']);

    await buildRepository(tx).softDeleteUserAccount(USER_ID);

    const sql = sqlTextOf(tx.$queryRaw.mock.calls[0]);
    expect(sql).toMatch(/SELECT\s+DISTINCT/);
  });

  it('呼び出し側も重複を除いてから渡す（無駄な行を作らない）', async () => {
    const duplicated = '77777777-7777-4777-8777-777777777777';
    const tx = buildTx([]);
    // 同じ dish_media に対する行が複数返る状況（実際には起こりにくいが、
    // dish_media_likes の行が重複していれば起こりうる）
    tx.dish_media_likes.findMany.mockResolvedValue([
      { dish_media_id: duplicated },
      { dish_media_id: duplicated },
    ]);
    tx.$queryRaw.mockResolvedValue([{ dish_media_id: duplicated }]);

    await buildRepository(tx).softDeleteUserAccount(USER_ID);

    const [, ...values] = tx.$queryRaw.mock.calls[0];
    expect(values[0]).toEqual([duplicated]);
  });

  it('いいねを消してから数え直す（順序が逆だと消す前の数で埋め戻す）', async () => {
    const tx = buildTx(['55555555-5555-4555-8555-555555555555']);

    await buildRepository(tx).softDeleteUserAccount(USER_ID);

    expect(tx.dish_media_likes.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0],
    );
    // 控えるのは消す前（消した後だと対象が分からなくなる）
    expect(tx.dish_media_likes.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.dish_media_likes.deleteMany.mock.invocationCallOrder[0],
    );
  });
});
