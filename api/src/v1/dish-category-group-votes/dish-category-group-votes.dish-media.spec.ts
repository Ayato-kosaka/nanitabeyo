// api/src/v1/dish-category-group-votes/dish-category-group-votes.dish-media.spec.ts
//
// #1513 投票候補に削除済み dish_media を出さないことを固定する。
//
// 投票候補は「墓標を出さず黙って除外する」側の画面（オーナー確定）。
// 落とす箇所は 2 つあり、どちらか片方だけだと «もう無い写真» が残る。
//   ❶ 保存時（updateCandidateDishMedia）— 一度固定した候補は上書きしないので、
//      ここで混ぜるとセッションが終わるまで居座る
//   ❷ 読み出し時（findDetailByShareToken / findCandidateById）— 固定した後に
//      投稿者が消した場合。過去データは migration で書き換えず読み出しで落とす
//

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

import { DishCategoryGroupVotesService } from './dish-category-group-votes.service';
import { DishCategoryGroupVotesRepository } from './dish-category-group-votes.repository';
import { DishCategoryGroupVotesAssembler } from './dish-category-group-votes.assembler';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import type { UpdateDishCategoryGroupVoteCandidateDishMediaDto } from '@shared/v1/dto';

const SESSION_ID = 'session-uuid';
const CANDIDATE_ID = 'candidate-uuid';
const USER_ID = 'user-uuid';
const LIVE_A = 'media-live-a';
const LIVE_B = 'media-live-b';
const DELETED = 'media-deleted';

const TX = { __tx: true };

describe('DishCategoryGroupVotesService#updateCandidateDishMedia #1513', () => {
  let service: DishCategoryGroupVotesService;
  let repo: {
    findCandidateById: jest.Mock;
    filterLiveDishMediaIds: jest.Mock;
    updateCandidateDishMediaIds: jest.Mock;
    touchSession: jest.Mock;
  };

  const dto = (
    ids: string[],
  ): UpdateDishCategoryGroupVoteCandidateDishMediaDto =>
    ({
      dishMediaIds: ids,
    }) as UpdateDishCategoryGroupVoteCandidateDishMediaDto;

  beforeEach(async () => {
    repo = {
      findCandidateById: jest.fn().mockResolvedValue({
        id: CANDIDATE_ID,
        session_id: SESSION_ID,
        dish_media_ids: [],
        dish_media_search_status: 'not_searched',
      }),
      // 実装（filterLiveDishMediaIds）と同じ契約: 生きている id だけを元の順序で返す
      filterLiveDishMediaIds: jest
        .fn()
        .mockImplementation((_db: unknown, ids: string[]) =>
          Promise.resolve(ids.filter((id) => id !== DELETED)),
        ),
      updateCandidateDishMediaIds: jest
        .fn()
        .mockImplementation(
          (
            _db: unknown,
            _sessionId: string,
            _candidateId: string,
            ids: string[],
            status: string,
          ) =>
            Promise.resolve({
              dishMediaIds: ids,
              dishMediaSearchStatus: status,
              updated: true,
            }),
        ),
      touchSession: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishCategoryGroupVotesService,
        { provide: DishCategoryGroupVotesRepository, useValue: repo },
        { provide: DishCategoryGroupVotesAssembler, useValue: {} },
        {
          provide: PrismaService,
          useValue: {
            withTransaction: jest.fn((exec: (tx: unknown) => unknown) =>
              exec(TX),
            ),
          },
        },
        {
          provide: AppLoggerService,
          useValue: {
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            log: jest.fn(),
          },
        },
        {
          provide: CloudTasksService,
          useValue: { enqueueNotification: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(DishCategoryGroupVotesService);
  });

  it('削除済みメディアは固定される前に候補から落とす', async () => {
    const result = await service.updateCandidateDishMedia(
      SESSION_ID,
      CANDIDATE_ID,
      dto([LIVE_A, DELETED, LIVE_B]),
      USER_ID,
    );

    // 保存されるのは生きている id だけ。生存判定は tx の中で行う（保存と同じ commit）
    expect(repo.filterLiveDishMediaIds).toHaveBeenCalledWith(TX, [
      LIVE_A,
      DELETED,
      LIVE_B,
    ]);
    expect(repo.updateCandidateDishMediaIds).toHaveBeenCalledWith(
      TX,
      SESSION_ID,
      CANDIDATE_ID,
      [LIVE_A, LIVE_B],
      'found',
    );
    expect(result.dishMediaIds).toEqual([LIVE_A, LIVE_B]);
  });

  it('全部が削除済みなら「検索済み 0 件」として固定する（found にしない）', async () => {
    const result = await service.updateCandidateDishMedia(
      SESSION_ID,
      CANDIDATE_ID,
      dto([DELETED]),
      USER_ID,
    );

    expect(repo.updateCandidateDishMediaIds).toHaveBeenCalledWith(
      TX,
      SESSION_ID,
      CANDIDATE_ID,
      [],
      'empty',
    );
    expect(result.dishMediaSearchStatus).toBe('empty');
  });
});

describe('DishCategoryGroupVotesRepository #1513 削除済み dish_media の落とし方', () => {
  const makeDb = (liveIds: string[]) => {
    const findMany = jest.fn().mockResolvedValue(liveIds.map((id) => ({ id })));
    return { db: { dish_media: { findMany } }, findMany };
  };

  const repo = new DishCategoryGroupVotesRepository();

  it('生きている id だけを、渡された順序のまま返す', async () => {
    const { db, findMany } = makeDb([LIVE_B, LIVE_A]);

    const result = await repo.filterLiveDishMediaIds(db as never, [
      LIVE_A,
      DELETED,
      LIVE_B,
    ]);

    // 検索結果の並び（おすすめ順）を壊さない。DB が返す順序に引きずられないこと
    expect(result).toEqual([LIVE_A, LIVE_B]);
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: [LIVE_A, DELETED, LIVE_B] }, deleted_at: null },
      select: { id: true },
    });
  });

  it('重複した id は 1 度しか問い合わせない', async () => {
    const { db, findMany } = makeDb([LIVE_A]);

    await repo.filterLiveDishMediaIds(db as never, [LIVE_A, LIVE_A]);

    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: [LIVE_A] }, deleted_at: null },
      select: { id: true },
    });
  });

  it('空配列なら問い合わせない', async () => {
    const { db, findMany } = makeDb([]);

    expect(await repo.filterLiveDishMediaIds(db as never, [])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('detail の読み出しで、固定済みの dish_media_ids から削除済みを落とす', async () => {
    const candidates = [
      {
        id: CANDIDATE_ID,
        dish_media_ids: [LIVE_A, DELETED],
        dish_media_search_status: 'found',
      },
      {
        id: 'candidate-2',
        dish_media_ids: [DELETED],
        dish_media_search_status: 'found',
      },
    ];
    const findMany = jest.fn().mockResolvedValue([{ id: LIVE_A }]);
    const db = {
      dish_category_group_vote_sessions: {
        findUnique: jest.fn().mockResolvedValue({ id: SESSION_ID }),
      },
      dish_category_group_vote_candidates: {
        findMany: jest.fn().mockResolvedValue(candidates),
      },
      dish_category_group_vote_participants: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      dish_category_group_vote_candidate_votes: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      dish_media: { findMany },
    };

    const record = await repo.findDetailByShareToken(db as never, 'token');

    expect(record?.candidates[0].dish_media_ids).toEqual([LIVE_A]);
    expect(record?.candidates[1].dish_media_ids).toEqual([]);
    // 候補ごとに引かない（detail 1 回で候補数ぶんのクエリが走るのを防ぐ）
    expect(findMany).toHaveBeenCalledTimes(1);
    // 過去データは書き換えないので、保存された status はそのまま返る
    expect(record?.candidates[1].dish_media_search_status).toBe('found');
  });
});
