// api/src/v1/dish-category-group-votes/dish-category-group-votes.repository.spec.ts
//
// #1505 【設計】GET /v1/users/me/dish-category-group-votes の認可テスト。
//
// findMeSessions が組み立てる where 句(host_user_id = 自分)を「実際に条件として評価する」
// フェイク findMany の上でテストする。呼び出し引数の形だけを assert すると、where 句の中身が
// 壊れていても気付けない(例: host 限定を OR に戻しても引数の "形" 自体は変わらない)。
// フェイク側で host_user_id / updated_at.lt / participants.some を本物同様に評価することで、
// 「他人のセッションも、参加しただけのセッションも混ざらない」ことを実質的に保証する。
//
// 【仕様】オーナー指示により、この一覧は **自分が主催したセッションだけ** を返す。
// 参加(投票)しただけのセッションは対象外。絞り込みはクライアントではなく where 句で行うため、
// 「参加しただけのセッションが返らない」ことをここで固定する。

import { Prisma } from '../../../../shared/prisma/client';
import { DishCategoryGroupVotesRepository } from './dish-category-group-votes.repository';

type FakeSession = {
  id: string;
  host_user_id: string;
  share_token: string;
  created_at: Date;
  updated_at: Date;
  candidates: { deleted_at: Date | null }[];
  participants: { id: string; user_id: string }[];
};

/**
 * findMeSessions が渡す where 句だけを対象にした最小限の評価器。
 * host_user_id / updated_at.lt / participants.some(user_id) と、
 * (回帰検知のために) OR を理解する。
 *
 * OR を残してあるのは、host 限定を OR 条件へ戻す退行が起きたときに
 * 「throw して落ちた」ではなく「参加しただけの行が返って落ちた」と読める形で
 * 赤くしたいため(下の «参加しただけのセッションは含めない» が本来の検知点)。
 * 未知の形が渡されたら黙って通すのではなく throw し、テストが無言で無意味化するのを防ぐ。
 */
function matchesWhere(session: FakeSession, where: any): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') {
      return (value as any[]).some((cond) => matchesWhere(session, cond));
    }
    if (key === 'host_user_id') {
      return session.host_user_id === value;
    }
    if (key === 'updated_at') {
      const { lt } = value as { lt: Date };
      return session.updated_at.getTime() < lt.getTime();
    }
    if (key === 'dish_category_group_vote_participants') {
      const some = (value as any).some as { user_id: string };
      return session.participants.some((p) => p.user_id === some.user_id);
    }
    throw new Error(`Unhandled where clause key in test fake: ${key}`);
  });
}

function buildFakeDb(sessions: FakeSession[]) {
  const findMany = jest.fn(async (args: any) => {
    const filtered = sessions
      .filter((s) => matchesWhere(s, args.where))
      .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime())
      .slice(0, args.take);

    const participantsSelect =
      args.select.dish_category_group_vote_participants;

    return filtered.map((s) => ({
      id: s.id,
      share_token: s.share_token,
      created_at: s.created_at,
      updated_at: s.updated_at,
      _count: {
        dish_category_group_vote_candidates: s.candidates.filter(
          (c) => c.deleted_at === null,
        ).length,
      },
      dish_category_group_vote_participants: s.participants
        .filter((p) => p.user_id === participantsSelect.where.user_id)
        .slice(0, participantsSelect.take)
        .map((p) => ({ id: p.id })),
    }));
  });

  const db = {
    dish_category_group_vote_sessions: { findMany },
  } as unknown as Prisma.TransactionClient;

  return { db, findMany };
}

describe('DishCategoryGroupVotesRepository.findMeSessions', () => {
  let repository: DishCategoryGroupVotesRepository;

  beforeEach(() => {
    repository = new DishCategoryGroupVotesRepository();
  });

  // #1505 一番重要な認可 + 仕様テスト:
  // 自分が主催したセッションだけが返り、参加しただけ / 無関係のどちらも混ざらないこと。
  it('自分が主催したセッションだけを返し、参加しただけのセッションも無関係なセッションも含めない', async () => {
    const hostedByMe: FakeSession = {
      id: 'session-hosted-by-me',
      host_user_id: 'user-me',
      share_token: 'token-hosted',
      created_at: new Date('2026-08-01T00:00:00Z'),
      updated_at: new Date('2026-08-03T00:00:00Z'),
      candidates: [{ deleted_at: null }, { deleted_at: null }],
      participants: [],
    };
    // 自分は participant として居るが host ではない ＝ 一覧に出してはいけない(#1505 仕様変更)
    const participatedByMe: FakeSession = {
      id: 'session-participated-by-me',
      host_user_id: 'user-other-host',
      share_token: 'token-participated',
      created_at: new Date('2026-08-02T00:00:00Z'),
      updated_at: new Date('2026-08-04T00:00:00Z'),
      candidates: [{ deleted_at: null }],
      participants: [
        { id: 'participant-me', user_id: 'user-me' },
        { id: 'participant-stranger', user_id: 'user-stranger' },
      ],
    };
    const unrelatedToMe: FakeSession = {
      id: 'session-unrelated',
      host_user_id: 'user-other-host',
      share_token: 'token-unrelated',
      created_at: new Date('2026-08-05T00:00:00Z'),
      updated_at: new Date('2026-08-05T00:00:00Z'),
      candidates: [{ deleted_at: null }],
      participants: [{ id: 'participant-stranger', user_id: 'user-stranger' }],
    };

    const { db } = buildFakeDb([hostedByMe, participatedByMe, unrelatedToMe]);

    const result = await repository.findMeSessions(db, 'user-me');

    const returnedIds = result.items.map((item) => item.id);
    expect(returnedIds).toEqual(['session-hosted-by-me']);
  });

  it('hasVoted は「主催者自身が投票済みか」をセッションごとに区別する', async () => {
    const hostedNotVoted: FakeSession = {
      id: 'session-hosted-not-voted',
      host_user_id: 'user-me',
      share_token: 'token-1',
      created_at: new Date('2026-08-01T00:00:00Z'),
      updated_at: new Date('2026-08-01T00:00:00Z'),
      candidates: [],
      // 他人だけが投票している。自分は未投票なので hasVoted は false
      participants: [{ id: 'p-other', user_id: 'user-other' }],
    };
    const hostedAndVoted: FakeSession = {
      id: 'session-hosted-and-voted',
      host_user_id: 'user-me',
      share_token: 'token-3',
      created_at: new Date('2026-08-03T00:00:00Z'),
      updated_at: new Date('2026-08-03T00:00:00Z'),
      candidates: [],
      participants: [{ id: 'p2', user_id: 'user-me' }],
    };

    const { db } = buildFakeDb([hostedNotVoted, hostedAndVoted]);
    const result = await repository.findMeSessions(db, 'user-me');
    const byId = new Map(result.items.map((item) => [item.id, item]));

    expect(byId.get('session-hosted-not-voted')).toMatchObject({
      hasVoted: false,
    });
    expect(byId.get('session-hosted-and-voted')).toMatchObject({
      hasVoted: true,
    });
  });

  // 全行が主催なので isHost は返さない(画面のバッジも撤去済み)
  it('isHost は返さない', async () => {
    const session: FakeSession = {
      id: 'session-hosted',
      host_user_id: 'user-me',
      share_token: 'token-no-is-host',
      created_at: new Date('2026-08-01T00:00:00Z'),
      updated_at: new Date('2026-08-01T00:00:00Z'),
      candidates: [],
      participants: [],
    };

    const { db } = buildFakeDb([session]);
    const result = await repository.findMeSessions(db, 'user-me');

    expect(result.items[0]).not.toHaveProperty('isHost');
  });

  it('候補数は未削除(deleted_at IS NULL)のみをカウントする', async () => {
    const session: FakeSession = {
      id: 'session-with-deleted-candidate',
      host_user_id: 'user-me',
      share_token: 'token-4',
      created_at: new Date('2026-08-01T00:00:00Z'),
      updated_at: new Date('2026-08-01T00:00:00Z'),
      candidates: [
        { deleted_at: null },
        { deleted_at: null },
        { deleted_at: new Date('2026-08-01T00:00:00Z') },
      ],
      participants: [],
    };

    const { db } = buildFakeDb([session]);
    const result = await repository.findMeSessions(db, 'user-me');

    expect(result.items[0].candidateCount).toBe(2);
  });

  it('cursor は updated_at の降順ページングに使われ、limit+1件目があればnextCursorを返す', async () => {
    const sessions: FakeSession[] = Array.from({ length: 3 }, (_, i) => ({
      id: `session-${i}`,
      host_user_id: 'user-me',
      share_token: `token-${i}`,
      created_at: new Date(2026, 7, i + 1),
      updated_at: new Date(2026, 7, i + 1),
      candidates: [],
      participants: [],
    }));

    const { db, findMany } = buildFakeDb(sessions);

    const firstPage = await repository.findMeSessions(
      db,
      'user-me',
      undefined,
      2,
    );
    expect(firstPage.items.map((i) => i.id)).toEqual(['session-2', 'session-1']);
    expect(firstPage.nextCursor).toBe(sessions[1].updated_at.toISOString());

    const secondPage = await repository.findMeSessions(
      db,
      'user-me',
      firstPage.nextCursor!,
      2,
    );
    expect(secondPage.items.map((i) => i.id)).toEqual(['session-0']);
    expect(secondPage.nextCursor).toBeNull();

    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
