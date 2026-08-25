// api/src/v1/dish-category-group-votes/dish-category-group-votes.idempotency.spec.ts
//
// #1507 (GRP-14) POST /v1/dish-category-group-votes の冪等化を固定する。
//
// ## なぜ e2e ではなくここで固定するか
// 守りたい事故は「**セッション行が 2 件できる**」というサーバー内部の状態であって、
// 画面上の見た目ではない。UI からは 2 件目が出来ても「共有リンクが 1 本表示される」だけで
// 区別が付かない（片方のリンクを配った参加者とホストが別の投票を見て、集計が合わなくなって
// 初めて気付く）。行数と shareToken の同一性を直接見られるこの層で固定する。
//
// ## 何を本物のまま使うか
// Service と Repository は**本物**を使い、差し替えるのは Prisma executor だけにする。
// この機能の冪等性は最終的に DB の複合 unique (host_user_id, idempotency_key) が担保するので、
// fake 側でその制約を再現する（重複 INSERT で P2002 を投げる）。
// repository の `isUniqueViolationOn` による share_token 衝突との切り分けや、
// `findUnique` の複合 unique キー名まで含めて本物の実装が通る。

// core/config/env は import 時に process.env をバリデーションして throw するため、
// 実DB・実APIに触れない単体テストでも .env が無いと suite ごと落ちる。
// logger.service 経由で推移的に読み込まれるので、DI で差し替えるより手前で無害化する
// （dishes.service.spec.ts と同じ書き方）。
jest.mock('../../core/config/env', () => ({
  env: new Proxy(
    {},
    {
      get: (_target, key: string) =>
        key === 'DB_POOL_MAX' ? 1 : `test-${key}`,
    },
  ),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { CreateDishCategoryGroupVoteDto } from '@shared/v1/dto';
import { AppLoggerService } from '../../core/logger/logger.service';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DishCategoryGroupVotesAssembler } from './dish-category-group-votes.assembler';
import { DishCategoryGroupVotesRepository } from './dish-category-group-votes.repository';
import { DishCategoryGroupVotesService } from './dish-category-group-votes.service';

/** Prisma の unique 制約違反。`meta.target` は列名の配列で来るケースを既定にする。 */
class FakeUniqueViolation extends Error {
  code = 'P2002';
  constructor(public meta: { target: string[] | string }) {
    super('Unique constraint failed');
    this.name = 'PrismaClientKnownRequestError';
  }
}

type SessionRow = {
  id: string;
  host_user_id: string;
  share_token: string;
  idempotency_key: string | null;
  search_context: unknown;
};

type CandidateRow = { session_id: string; dish_category_id: string };

/**
 * dish_category_group_vote_sessions / _candidates の最小 in-memory 実装。
 *
 * unique の再現は 2 本:
 * - share_token（既存。偶発衝突 → 409）
 * - (host_user_id, idempotency_key)（#1507。再送 → 既存行を返す）
 *   NULL 同士は衝突させない（PostgreSQL の UNIQUE と同じ挙動 = 旧クライアント互換の根拠）。
 */
class FakeDb {
  sessions: SessionRow[] = [];
  candidates: CandidateRow[] = [];
  private seq = 0;

  /** テストから share_token 衝突を意図的に起こすためのフック */
  nextShareTokenCollision = false;

  dish_category_group_vote_sessions = {
    create: async ({
      data,
    }: {
      data: {
        host_user_id: string;
        share_token: string;
        idempotency_key: string | null;
        search_context: unknown;
      };
    }) => {
      // 実 DB では INSERT 時に判定されるので、ここでも INSERT の瞬間に判定する
      if (this.nextShareTokenCollision) {
        this.nextShareTokenCollision = false;
        throw new FakeUniqueViolation({ target: ['share_token'] });
      }
      if (
        data.idempotency_key !== null &&
        this.sessions.some(
          (row) =>
            row.host_user_id === data.host_user_id &&
            row.idempotency_key === data.idempotency_key,
        )
      ) {
        throw new FakeUniqueViolation({
          target: ['host_user_id', 'idempotency_key'],
        });
      }

      const row: SessionRow = {
        id: `session-${++this.seq}`,
        host_user_id: data.host_user_id,
        share_token: data.share_token,
        idempotency_key: data.idempotency_key,
        search_context: data.search_context,
      };
      this.sessions.push(row);
      return { id: row.id, share_token: row.share_token };
    },
    findUnique: async ({
      where,
    }: {
      where: {
        host_user_id_idempotency_key?: {
          host_user_id: string;
          idempotency_key: string;
        };
      };
    }) => {
      const key = where.host_user_id_idempotency_key;
      if (!key) throw new Error('unsupported where in FakeDb');
      const row = this.sessions.find(
        (candidate) =>
          candidate.host_user_id === key.host_user_id &&
          candidate.idempotency_key === key.idempotency_key,
      );
      return row ? { id: row.id, share_token: row.share_token } : null;
    },
  };

  dish_category_group_vote_candidates = {
    createMany: async ({ data }: { data: CandidateRow[] }) => {
      this.candidates.push(...data);
      return { count: data.length };
    },
  };
}

const HOST = 'host-user-1';
const OTHER_HOST = 'host-user-2';
const KEY = '3f8f6a4c-6f4e-4a1e-9a1a-6a4b2c1d0e5f';

const dtoWith = (
  overrides: Partial<CreateDishCategoryGroupVoteDto> = {},
): CreateDishCategoryGroupVoteDto =>
  ({
    searchContext: {
      location: { latitude: 35.658, longitude: 139.701 },
      radius: 800,
      priceLevels: ['PRICE_LEVEL_MODERATE'],
      localLanguageCode: 'ja',
    },
    candidates: [
      {
        dishCategoryId: 'Q282',
        displayName: 'ワイン',
        tagline: '',
        imageUrl: 'https://example.com/wine.jpg',
      },
      {
        dishCategoryId: 'Q6663',
        displayName: '焼き鳥',
        tagline: '',
        imageUrl: 'https://example.com/yakitori.jpg',
      },
    ],
    ...overrides,
  }) as CreateDishCategoryGroupVoteDto;

describe('DishCategoryGroupVotesService.create の冪等化 (#1507)', () => {
  let service: DishCategoryGroupVotesService;
  let db: FakeDb;
  let logger: { debug: jest.Mock; warn: jest.Mock; error: jest.Mock };

  beforeEach(async () => {
    db = new FakeDb();
    logger = { debug: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishCategoryGroupVotesService,
        DishCategoryGroupVotesRepository,
        DishCategoryGroupVotesAssembler,
        {
          provide: PrismaService,
          useValue: {
            prisma: db,
            // 冪等キー衝突時の読み直しがトランザクション外で行われることを表現するため、
            // withTransaction も同じ FakeDb を渡す（行の見え方は共有される）
            withTransaction: (fn: (tx: unknown) => Promise<unknown>) => fn(db),
          },
        },
        { provide: AppLoggerService, useValue: { ...logger, log: jest.fn() } },
        // GRP-04（#1506）で create が投票完了通知を積むようになり、
        // DishCategoryGroupVotesService の依存に CloudTasksService が増えた。
        // この spec は冪等化だけを見るので、積まれたことは検証せずモックで満たす。
        { provide: CloudTasksService, useValue: { enqueueNotification: jest.fn() } },
      ],
    }).compile();

    service = module.get(DishCategoryGroupVotesService);
  });

  // 完了条件: 同じ冪等キーで 2 回 POST してもセッションは 1 件、2 回目は同じ shareToken
  it('同じ冪等キーで 2 回叩いてもセッションは 1 件しか作られず、同じ shareToken を返す', async () => {
    const first = await service.create(dtoWith({ idempotencyKey: KEY }), HOST);
    const second = await service.create(dtoWith({ idempotencyKey: KEY }), HOST);

    expect(db.sessions).toHaveLength(1);
    expect(second).toEqual(first);
    expect(second.shareToken).toBe(first.shareToken);
    // 候補も二重に積まれない（session だけ冪等でも候補が倍になれば結果画面が壊れる）
    expect(db.candidates).toHaveLength(2);
  });

  // 完了条件: 並行して同時に届いた 2 リクエストでも 1 件しかできない
  // = 事前チェックをすり抜け、DB の unique 違反を捕まえて既存行を返す経路
  it('並行して届いた同一キーの 2 リクエストでもセッションは 1 件しか作られない', async () => {
    const [a, b] = await Promise.all([
      service.create(dtoWith({ idempotencyKey: KEY }), HOST),
      service.create(dtoWith({ idempotencyKey: KEY }), HOST),
    ]);

    expect(db.sessions).toHaveLength(1);
    expect(a).toEqual(b);
    // 事前チェックではなく unique 違反経路を通ったことを確かめる
    // （ここが通っていないと、このテストは fast path だけを見て緑になる）
    expect(logger.warn).toHaveBeenCalledWith(
      'DishCategoryGroupVotes.idempotentReplay',
      'create',
      expect.objectContaining({ via: 'uniqueViolation' }),
    );
  });

  // 完了条件: 冪等キーを送らないリクエストは従来どおり（後方互換）
  it('冪等キーを送らない旧クライアントは従来どおり毎回新しいセッションを作る', async () => {
    const first = await service.create(dtoWith(), HOST);
    const second = await service.create(dtoWith(), HOST);

    expect(db.sessions).toHaveLength(2);
    expect(second.id).not.toBe(first.id);
    expect(second.shareToken).not.toBe(first.shareToken);
    expect(db.sessions.every((row) => row.idempotency_key === null)).toBe(true);
  });

  // UNIQUE を (host_user_id, idempotency_key) の複合にした理由そのもの。
  // 単独 UNIQUE だと、ここで 2 人目の作成が失敗するか、他人のセッション（shareToken 込み）が返る。
  it('別ユーザーが偶然同じキーを送っても、互いに 1 件ずつ独立して作られる', async () => {
    const mine = await service.create(dtoWith({ idempotencyKey: KEY }), HOST);
    const theirs = await service.create(
      dtoWith({ idempotencyKey: KEY }),
      OTHER_HOST,
    );

    expect(db.sessions).toHaveLength(2);
    expect(theirs.id).not.toBe(mine.id);
    expect(theirs.shareToken).not.toBe(mine.shareToken);
  });

  // 冪等キーの再送経路が share_token の偶発衝突を飲み込んでいないこと。
  // 両方 P2002 なので、meta.target を見ずに分岐すると 409 が消えて「作成した気になる」事故になる。
  it('share_token の偶発衝突は冪等キーがあっても従来どおり 409 のまま', async () => {
    db.nextShareTokenCollision = true;

    await expect(
      service.create(dtoWith({ idempotencyKey: KEY }), HOST),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.sessions).toHaveLength(0);
  });

  // Prisma / ドライバによって meta.target がインデックス名の文字列で来る場合の保険。
  // 配列前提で書くと、その環境でだけ冪等化が効かず二重作成に戻る。
  it('unique 違反の meta.target がインデックス名の文字列でも冪等キー衝突と判定する', () => {
    const repo = new DishCategoryGroupVotesRepository();
    const asIndexName = new FakeUniqueViolation({
      target: 'dcgvs_host_user_id_idempotency_key_uq',
    });
    const asColumns = new FakeUniqueViolation({
      target: ['host_user_id', 'idempotency_key'],
    });
    const shareToken = new FakeUniqueViolation({ target: ['share_token'] });

    expect(repo.isUniqueViolationOn(asIndexName, 'idempotency_key')).toBe(true);
    expect(repo.isUniqueViolationOn(asColumns, 'idempotency_key')).toBe(true);
    expect(repo.isUniqueViolationOn(shareToken, 'idempotency_key')).toBe(false);
    expect(repo.isUniqueViolationOn(new Error('boom'), 'idempotency_key')).toBe(
      false,
    );
  });
});
