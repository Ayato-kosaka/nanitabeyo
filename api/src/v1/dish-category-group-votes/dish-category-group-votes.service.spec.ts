// api/src/v1/dish-category-group-votes/dish-category-group-votes.service.spec.ts
//
// #1506 GRP-04 投票完了通知。submitVote 成功後に Cloud Tasks へ通知ジョブを
// enqueue すること、失敗しても submitVote 自体は成功として返すことを検証する。
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
import type { SubmitDishCategoryGroupVoteDto } from '@shared/v1/dto';

const SESSION_ID = 'session-uuid';
const USER_ID = 'voter-user-uuid';
const PARTICIPANT_ID = 'participant-uuid';

const voteDto: SubmitDishCategoryGroupVoteDto = {
  displayName: 'Voter',
  votes: [{ candidateId: 'candidate-uuid', reaction: 'like' }],
} as SubmitDishCategoryGroupVoteDto;

describe('DishCategoryGroupVotesService#submitVote GRP-04 投票完了通知', () => {
  let service: DishCategoryGroupVotesService;
  let repo: {
    findSessionById: jest.Mock;
    assertCandidatesBelongToSession: jest.Mock;
    createParticipantWithVotes: jest.Mock;
    touchSession: jest.Mock;
    isUniqueViolation: jest.Mock;
  };
  let cloudTasks: { enqueueNotification: jest.Mock };
  let prisma: { withTransaction: jest.Mock };
  let logger: {
    debug: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    log: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      findSessionById: jest.fn().mockResolvedValue({
        id: SESSION_ID,
        host_user_id: 'host-user-uuid',
      }),
      assertCandidatesBelongToSession: jest.fn().mockResolvedValue(true),
      createParticipantWithVotes: jest
        .fn()
        .mockResolvedValue({ id: PARTICIPANT_ID }),
      touchSession: jest.fn().mockResolvedValue(undefined),
      isUniqueViolation: jest.fn().mockReturnValue(false),
    };
    cloudTasks = {
      enqueueNotification: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      withTransaction: jest.fn((exec: (tx: unknown) => unknown) =>
        exec({ __tx: true }),
      ),
    };
    logger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishCategoryGroupVotesService,
        { provide: DishCategoryGroupVotesRepository, useValue: repo },
        { provide: DishCategoryGroupVotesAssembler, useValue: {} },
        { provide: PrismaService, useValue: prisma },
        { provide: AppLoggerService, useValue: logger },
        { provide: CloudTasksService, useValue: cloudTasks },
      ],
    }).compile();

    service = module.get<DishCategoryGroupVotesService>(
      DishCategoryGroupVotesService,
    );
  });

  it('投票成功後にホスト向けの通知ジョブを enqueue する', async () => {
    await service.submitVote(SESSION_ID, voteDto, USER_ID);

    expect(cloudTasks.enqueueNotification).toHaveBeenCalledTimes(1);
    expect(cloudTasks.enqueueNotification).toHaveBeenCalledWith({
      actionType: 'vote',
      targetTable: 'dish_category_group_vote_sessions',
      targetId: SESSION_ID,
      actorId: USER_ID,
      idempotencyKey: `dish_category_group_vote_sessions:vote:${SESSION_ID}`,
    });
  });

  it('同一セッションへの投票は同じ idempotencyKey で enqueue される（スレッド集約の前提）', async () => {
    await service.submitVote(SESSION_ID, voteDto, USER_ID);
    await service.submitVote(
      SESSION_ID,
      { ...voteDto, displayName: 'Another Voter' },
      'another-voter-uuid',
    );

    const keys = cloudTasks.enqueueNotification.mock.calls.map(
      (call) => call[0].idempotencyKey,
    );
    expect(keys).toEqual([
      `dish_category_group_vote_sessions:vote:${SESSION_ID}`,
      `dish_category_group_vote_sessions:vote:${SESSION_ID}`,
    ]);
  });

  it('通知の enqueue に失敗しても投票自体は成功として返す', async () => {
    cloudTasks.enqueueNotification.mockRejectedValue(new Error('boom'));

    await expect(
      service.submitVote(SESSION_ID, voteDto, USER_ID),
    ).resolves.toEqual({
      participantId: PARTICIPANT_ID,
      stored: true,
    });
  });
});
