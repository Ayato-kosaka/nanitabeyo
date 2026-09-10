// api/src/v1/dish-category-group-votes/dish-category-group-votes.repository.spec.ts
//
// #1505 【設計】GET /v1/users/me/dish-category-group-votes の認可テスト + 行の中身のテスト。
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
//
// #1505 デザイン再設計で、行は «何を投票したのか»(候補サムネイル・候補名・参加人数・勝者名)を
// 出すようになった。表示の材料を API が返せているか、そして
// **ページ全体を数クエリで引いているか(セッションごとに引く N+1 になっていないか)** も
// ここで固定する。行数が増えるほど効く性質なので、目視では退行に気付けない。

import { Prisma } from '../../../../shared/prisma/client';
import { DishCategoryGroupVotesRepository } from './dish-category-group-votes.repository';

type FakeCandidate = {
  id: string;
  display_name: string;
  image_url: string;
  display_order: number;
  deleted_at: Date | null;
  /** この候補に入った得票。reaction は 'like' | 'dislike' */
  reactions: string[];
};

type FakeSession = {
  id: string;
  host_user_id: string;
  share_token: string;
  created_at: Date;
  updated_at: Date;
  candidates: FakeCandidate[];
  participants: { id: string; user_id: string }[];
};

/** 候補の定型部分を埋める。テストが着目する項目だけを渡せるようにするためのヘルパー */
function candidate(overrides: Partial<FakeCandidate> = {}): FakeCandidate {
  const displayOrder = overrides.display_order ?? 0;
  return {
    id: overrides.id ?? `candidate-${displayOrder}`,
    display_name: overrides.display_name ?? `candidate-${displayOrder}`,
    image_url: overrides.image_url ?? `https://example.com/${displayOrder}.jpg`,
    display_order: displayOrder,
    deleted_at: overrides.deleted_at ?? null,
    reactions: overrides.reactions ?? [],
  };
}

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
      // #1596 複合カーソルでは `updated_at: <Date>`（同値）と
      // `updated_at: { lt: <Date> }`（より古い）の両方が来る。
      // 片方しか解さないと、fake が本物と違う答えを返してテストが嘘をつく。
      if (value instanceof Date) {
        return session.updated_at.getTime() === value.getTime();
      }
      const { lt } = value as { lt: Date };
      return session.updated_at.getTime() < lt.getTime();
    }
    if (key === 'id') {
      // #1596 複合カーソルの第 2 キー。同一 updated_at の中を id で切る
      const { lt } = value as { lt: string };
      return session.id < lt;
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
      // #1596 本物の orderBy は [{updated_at:'desc'},{id:'desc'}]。
      // fake 側も id で tie-break しないと、同時刻のとき «複合カーソルが
      // 効いていない» ことを検出できない
      .sort(
        (a, b) =>
          b.updated_at.getTime() - a.updated_at.getTime() ||
          (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      )
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
        dish_category_group_vote_participants: s.participants.length,
      },
      dish_category_group_vote_participants: s.participants
        .filter((p) => p.user_id === participantsSelect.where.user_id)
        .slice(0, participantsSelect.take)
        .map((p) => ({ id: p.id })),
    }));
  });

  // 候補は「ページ内の全セッションぶんを 1 回で引く」形しか受け付けない。
  // セッションごとに引く N+1 へ戻る退行は、呼び出し回数の assert（下の it）で赤くなる。
  const findManyCandidates = jest.fn(async (args: any) => {
    const sessionIds: string[] = args.where.session_id.in;
    if (args.where.deleted_at !== null) {
      throw new Error(
        '削除済み候補を除外していない: where.deleted_at が null ではない',
      );
    }

    return sessions
      .filter((s) => sessionIds.includes(s.id))
      .flatMap((s) =>
        s.candidates
          .filter((c) => c.deleted_at === null)
          .map((c) => ({
            id: c.id,
            session_id: s.id,
            display_name: c.display_name,
            image_url: c.image_url,
            display_order: c.display_order,
          })),
      )
      .sort((a, b) =>
        a.session_id === b.session_id
          ? a.display_order - b.display_order
          : a.session_id.localeCompare(b.session_id),
      );
  });

  const groupByVotes = jest.fn(async (args: any) => {
    const candidateIds: string[] = args.where.candidate_id.in;
    const counts = new Map<string, number>();

    for (const session of sessions) {
      for (const c of session.candidates) {
        if (!candidateIds.includes(c.id)) continue;
        for (const reaction of c.reactions) {
          const key = `${c.id}::${reaction}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }

    return [...counts.entries()].map(([key, count]) => {
      const [candidate_id, reaction] = key.split('::');
      return { candidate_id, reaction, _count: { _all: count } };
    });
  });

  const db = {
    dish_category_group_vote_sessions: { findMany },
    dish_category_group_vote_candidates: { findMany: findManyCandidates },
    dish_category_group_vote_candidate_votes: { groupBy: groupByVotes },
  } as unknown as Prisma.TransactionClient;

  return { db, findMany, findManyCandidates, groupByVotes };
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
      candidates: [
        candidate({ display_order: 0 }),
        candidate({ display_order: 1 }),
      ],
      participants: [],
    };
    // 自分は participant として居るが host ではない ＝ 一覧に出してはいけない(#1505 仕様変更)
    const participatedByMe: FakeSession = {
      id: 'session-participated-by-me',
      host_user_id: 'user-other-host',
      share_token: 'token-participated',
      created_at: new Date('2026-08-02T00:00:00Z'),
      updated_at: new Date('2026-08-04T00:00:00Z'),
      candidates: [candidate({ display_order: 0 })],
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
      candidates: [candidate({ display_order: 0 })],
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
        candidate({ id: 'c-0', display_order: 0 }),
        candidate({ id: 'c-1', display_order: 1 }),
        candidate({
          id: 'c-2',
          display_order: 2,
          deleted_at: new Date('2026-08-01T00:00:00Z'),
        }),
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
    expect(firstPage.items.map((i) => i.id)).toEqual([
      'session-2',
      'session-1',
    ]);
    // #1596 カーソルは `<ISO8601>|<id>` の複合
    expect(firstPage.nextCursor).toBe(
      `${sessions[1].updated_at.toISOString()}|session-1`,
    );

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

  // ─────────────────────────────────────────────────────────────────
  // #1596 同一 updated_at がページ境界をまたぐケース
  //
  // 旧実装は `updated_at < cursor` の単一カーソルだったため、20 件目と 21 件目が
  // 同時刻だと **21 件目以降が一覧から永久に消えた**（次ページの起点が 20 件目の
  // 時刻そのもので、`<` が同時刻の行をまとめて落とす）。
  // touchSession は候補追加・削除・投票のたびに走るので、同一ミリ秒での複数更新は
  // «稀» であって «起きない» ではない。
  // ─────────────────────────────────────────────────────────────────
  it('#1596 updated_at が同一の行がページ境界をまたいでも欠落しない', () => {
    const sameMoment = new Date('2026-08-10T00:00:00.000Z');
    const sessions: FakeSession[] = ['session-a', 'session-b', 'session-c'].map(
      (id) => ({
        id,
        host_user_id: 'user-me',
        share_token: `token-${id}`,
        created_at: sameMoment,
        updated_at: sameMoment,
        candidates: [],
        participants: [],
      }),
    );

    const { db } = buildFakeDb(sessions);

    return (async () => {
      const firstPage = await repository.findMeSessions(
        db,
        'user-me',
        undefined,
        2,
      );
      // id 降順で c, b
      expect(firstPage.items.map((i) => i.id)).toEqual([
        'session-c',
        'session-b',
      ]);
      expect(firstPage.nextCursor).toBe(
        `${sameMoment.toISOString()}|session-b`,
      );

      const secondPage = await repository.findMeSessions(
        db,
        'user-me',
        firstPage.nextCursor!,
        2,
      );
      // 旧実装ではここが [] になり session-a が永久に見えなくなっていた
      expect(secondPage.items.map((i) => i.id)).toEqual(['session-a']);
      expect(secondPage.nextCursor).toBeNull();
    })();
  });

  it('#1596 旧形式（ISO8601 のみ）のカーソルも受け付ける（配信済みクライアント互換）', async () => {
    const sessions: FakeSession[] = Array.from({ length: 3 }, (_, i) => ({
      id: `session-${i}`,
      host_user_id: 'user-me',
      share_token: `token-${i}`,
      created_at: new Date(2026, 7, i + 1),
      updated_at: new Date(2026, 7, i + 1),
      candidates: [],
      participants: [],
    }));

    const { db } = buildFakeDb(sessions);

    const page = await repository.findMeSessions(
      db,
      'user-me',
      sessions[1].updated_at.toISOString(),
      2,
    );

    expect(page.items.map((i) => i.id)).toEqual(['session-0']);
  });

  it('#1596 壊れたカーソルは 500 にせず先頭ページを返す', async () => {
    const sessions: FakeSession[] = [
      {
        id: 'session-0',
        host_user_id: 'user-me',
        share_token: 'token-0',
        created_at: new Date('2026-08-01T00:00:00Z'),
        updated_at: new Date('2026-08-01T00:00:00Z'),
        candidates: [],
        participants: [],
      },
    ];

    const { db } = buildFakeDb(sessions);

    const page = await repository.findMeSessions(
      db,
      'user-me',
      'not-a-date',
      2,
    );

    expect(page.items.map((i) => i.id)).toEqual(['session-0']);
  });

  // ─────────────────────────────────────────────────────────────────
  // #1505 行の中身（デザイン再設計で追加したフィールド）
  // ─────────────────────────────────────────────────────────────────

  it('候補プレビューは display_order 昇順の先頭3件を、削除済みを除いて返す', async () => {
    const session: FakeSession = {
      id: 'session-previews',
      host_user_id: 'user-me',
      share_token: 'token-previews',
      created_at: new Date('2026-08-01T00:00:00Z'),
      updated_at: new Date('2026-08-01T00:00:00Z'),
      candidates: [
        candidate({
          id: 'c-3',
          display_order: 3,
          display_name: '四番目',
          image_url: 'https://example.com/4.jpg',
        }),
        candidate({
          id: 'c-0',
          display_order: 0,
          display_name: 'ラーメン',
          image_url: 'https://example.com/ramen.jpg',
        }),
        // 削除済みは «見えている候補» ではないのでサムネイルにも出さない
        candidate({
          id: 'c-1',
          display_order: 1,
          display_name: '削除済み',
          deleted_at: new Date('2026-08-01T00:00:00Z'),
        }),
        candidate({
          id: 'c-2',
          display_order: 2,
          display_name: '寿司',
          image_url: 'https://example.com/sushi.jpg',
        }),
        candidate({ id: 'c-4', display_order: 4, display_name: '五番目' }),
      ],
      participants: [],
    };

    const { db } = buildFakeDb([session]);
    const result = await repository.findMeSessions(db, 'user-me');

    expect(result.items[0].candidatePreviews).toEqual([
      { displayName: 'ラーメン', imageUrl: 'https://example.com/ramen.jpg' },
      { displayName: '寿司', imageUrl: 'https://example.com/sushi.jpg' },
      { displayName: '四番目', imageUrl: 'https://example.com/4.jpg' },
    ]);
    // 「+N」は candidateCount とプレビュー件数の差で出すので、総数は削除済みを除いた 4
    expect(result.items[0].candidateCount).toBe(4);
  });

  it('participantCount は「投票した参加者の数」であり、自分が投票したかとは独立に数える', async () => {
    const session: FakeSession = {
      id: 'session-participants',
      host_user_id: 'user-me',
      share_token: 'token-participants',
      created_at: new Date('2026-08-01T00:00:00Z'),
      updated_at: new Date('2026-08-01T00:00:00Z'),
      candidates: [],
      // 主催者である自分は投票していないが、他人が 3 人投票している
      participants: [
        { id: 'p-1', user_id: 'user-a' },
        { id: 'p-2', user_id: 'user-b' },
        { id: 'p-3', user_id: 'user-c' },
      ],
    };

    const { db } = buildFakeDb([session]);
    const result = await repository.findMeSessions(db, 'user-me');

    expect(result.items[0]).toMatchObject({
      participantCount: 3,
      hasVoted: false,
    });
  });

  it('winnerName は単独首位の候補名を返す（like 数が多い候補が勝つ）', async () => {
    const session: FakeSession = {
      id: 'session-winner',
      host_user_id: 'user-me',
      share_token: 'token-winner',
      created_at: new Date('2026-08-01T00:00:00Z'),
      updated_at: new Date('2026-08-01T00:00:00Z'),
      candidates: [
        candidate({
          id: 'c-0',
          display_order: 0,
          display_name: 'ラーメン',
          reactions: ['like'],
        }),
        candidate({
          id: 'c-1',
          display_order: 1,
          display_name: '寿司',
          reactions: ['like', 'like', 'dislike'],
        }),
      ],
      participants: [{ id: 'p-1', user_id: 'user-a' }],
    };

    const { db } = buildFakeDb([session]);
    const result = await repository.findMeSessions(db, 'user-me');

    expect(result.items[0].winnerName).toBe('寿司');
  });

  it('winnerName は同率首位のとき null（並んでいる状態を「決まった」と呼ばない）', async () => {
    const session: FakeSession = {
      id: 'session-tie',
      host_user_id: 'user-me',
      share_token: 'token-tie',
      created_at: new Date('2026-08-01T00:00:00Z'),
      updated_at: new Date('2026-08-01T00:00:00Z'),
      candidates: [
        candidate({
          id: 'c-0',
          display_order: 0,
          display_name: 'ラーメン',
          reactions: ['like', 'like'],
        }),
        candidate({
          id: 'c-1',
          display_order: 1,
          display_name: '寿司',
          reactions: ['like', 'like'],
        }),
      ],
      participants: [{ id: 'p-1', user_id: 'user-a' }],
    };

    const { db } = buildFakeDb([session]);
    const result = await repository.findMeSessions(db, 'user-me');

    expect(result.items[0].winnerName).toBeNull();
  });

  it('winnerName は誰も投票していないとき null（0票同士で display_order の若い候補を勝たせない）', async () => {
    const session: FakeSession = {
      id: 'session-no-votes',
      host_user_id: 'user-me',
      share_token: 'token-no-votes',
      created_at: new Date('2026-08-01T00:00:00Z'),
      updated_at: new Date('2026-08-01T00:00:00Z'),
      candidates: [
        candidate({ id: 'c-0', display_order: 0, display_name: 'ラーメン' }),
        candidate({ id: 'c-1', display_order: 1, display_name: '寿司' }),
      ],
      participants: [],
    };

    const { db } = buildFakeDb([session]);
    const result = await repository.findMeSessions(db, 'user-me');

    expect(result.items[0].winnerName).toBeNull();
  });

  it('dislike だけが入った候補より、like が 1 票でも入った候補が勝つ', async () => {
    const session: FakeSession = {
      id: 'session-dislike',
      host_user_id: 'user-me',
      share_token: 'token-dislike',
      created_at: new Date('2026-08-01T00:00:00Z'),
      updated_at: new Date('2026-08-01T00:00:00Z'),
      candidates: [
        candidate({
          id: 'c-0',
          display_order: 0,
          display_name: 'ラーメン',
          reactions: ['dislike', 'dislike'],
        }),
        candidate({
          id: 'c-1',
          display_order: 1,
          display_name: '寿司',
          reactions: ['like'],
        }),
      ],
      participants: [{ id: 'p-1', user_id: 'user-a' }],
    };

    const { db } = buildFakeDb([session]);
    const result = await repository.findMeSessions(db, 'user-me');

    expect(result.items[0].winnerName).toBe('寿司');
  });

  // 一覧を開くだけで DB を叩き潰さないこと。行数に比例してクエリが増える形に戻ったら赤くなる。
  it('候補と得票はページ全体で 1 回ずつしか引かない（行ごとの N+1 にしない）', async () => {
    const sessions: FakeSession[] = Array.from({ length: 5 }, (_, i) => ({
      id: `session-${i}`,
      host_user_id: 'user-me',
      share_token: `token-${i}`,
      created_at: new Date(2026, 7, i + 1),
      updated_at: new Date(2026, 7, i + 1),
      candidates: [
        candidate({
          id: `c-${i}-0`,
          display_order: 0,
          display_name: `候補 ${i}`,
          reactions: ['like'],
        }),
      ],
      participants: [{ id: `p-${i}`, user_id: 'user-a' }],
    }));

    const { db, findMany, findManyCandidates, groupByVotes } =
      buildFakeDb(sessions);

    const result = await repository.findMeSessions(db, 'user-me');

    expect(result.items).toHaveLength(5);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findManyCandidates).toHaveBeenCalledTimes(1);
    expect(groupByVotes).toHaveBeenCalledTimes(1);
  });

  it('候補が 1 件も無いページでは、候補・得票のクエリを投げない', async () => {
    const session: FakeSession = {
      id: 'session-empty',
      host_user_id: 'user-me',
      share_token: 'token-empty',
      created_at: new Date('2026-08-01T00:00:00Z'),
      updated_at: new Date('2026-08-01T00:00:00Z'),
      candidates: [],
      participants: [],
    };

    const { db, findManyCandidates, groupByVotes } = buildFakeDb([session]);

    const result = await repository.findMeSessions(db, 'user-me');

    expect(result.items[0]).toMatchObject({
      candidatePreviews: [],
      winnerName: null,
    });
    // 候補は「居ないことを確かめる」ために 1 回引く。得票は引く相手が居ないので 0 回。
    expect(findManyCandidates).toHaveBeenCalledTimes(1);
    expect(groupByVotes).not.toHaveBeenCalled();
  });

  it('1 件も返らないページでは、候補のクエリすら投げない', async () => {
    const { db, findManyCandidates, groupByVotes } = buildFakeDb([]);

    const result = await repository.findMeSessions(db, 'user-me');

    expect(result.items).toEqual([]);
    expect(findManyCandidates).not.toHaveBeenCalled();
    expect(groupByVotes).not.toHaveBeenCalled();
  });
});
