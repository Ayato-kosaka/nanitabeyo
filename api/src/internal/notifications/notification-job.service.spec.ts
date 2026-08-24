// api/src/internal/notifications/notification-job.service.spec.ts
//
// #1506 GRP-04 投票完了通知の回帰テスト
// ❶ ホストへ通知が届くこと
// ❷ ホスト自身の投票では自分に通知が飛ばないこと（自己通知 skip）
// ❸ 同じ契機（同一 idempotencyKey）のジョブが2回処理されても、
//    通知が重複して作成されないこと（Cloud Tasks の再配信を模す）
//

// core/config/env は import 時に process.env をバリデーションして throw するため、
// 実DB・実APIに触れない単体テストでも .env が無いと suite ごと落ちる（dish-media.service.spec.ts と同じ対策）。
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
import { NotificationJobService } from './notification-job.service';
import { NotificationsRepository } from '../../v1/notifications/notifications.repository';
import { NotificationsService } from '../../v1/notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { UsersService } from 'src/v1/users/users.service';

const HOST_ID = 'host-user-uuid';
const VOTER_ID = 'voter-user-uuid';
const SESSION_ID = 'session-uuid';
const IDEMPOTENCY_KEY = `dish_category_group_vote_sessions:vote:${SESSION_ID}`;

const HOST_USER = {
  id: HOST_ID,
  display_name: 'Host User',
  preferred_locale: 'en',
};
const VOTER_USER = {
  id: VOTER_ID,
  display_name: 'Voter User',
  preferred_locale: 'en',
};

describe('NotificationJobService GRP-04 投票完了通知', () => {
  let service: NotificationJobService;

  // 実 upsertNotification と同じ不変条件（idempotency_key 一意）を持つ
  // 最小限のインメモリ二重化。Cloud Tasks の再配信で同一ジョブが2回処理されても
  // 通知が2行に増えないことを検証するために、実装の骨格だけをなぞる。
  let notificationsByKey: Map<
    string,
    { id: string; actorIds: string[]; recipientIds: Set<string> }
  >;
  let nextId: number;

  let repo: {
    upsertNotification: jest.Mock;
  };
  let notificationsService: {
    sendPushNotification: jest.Mock;
  };
  let prisma: {
    withTransaction: jest.Mock;
    prisma: {
      dish_media: { findUnique: jest.Mock };
      dish_reviews: { findUnique: jest.Mock };
      dish_category_group_vote_sessions: { findUnique: jest.Mock };
    };
  };
  let usersService: { getUserByIds: jest.Mock };
  let logger: {
    debug: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    log: jest.Mock;
  };

  beforeEach(async () => {
    notificationsByKey = new Map();
    nextId = 0;

    repo = {
      upsertNotification: jest.fn(
        async (
          _tx: unknown,
          notification: { idempotency_key: string },
          recipientIds: string[],
          actorId: string,
        ) => {
          const existing = notificationsByKey.get(
            notification.idempotency_key,
          );
          if (existing) {
            existing.actorIds = [
              actorId,
              ...existing.actorIds.filter((id) => id !== actorId),
            ].slice(0, 3);
            recipientIds.forEach((id) => existing.recipientIds.add(id));
            return { notificationId: existing.id, isNew: false };
          }

          const created = {
            id: `notification-${++nextId}`,
            actorIds: [actorId],
            recipientIds: new Set(recipientIds),
          };
          notificationsByKey.set(notification.idempotency_key, created);
          return { notificationId: created.id, isNew: true };
        },
      ),
    };

    notificationsService = {
      sendPushNotification: jest.fn().mockResolvedValue(undefined),
    };

    prisma = {
      withTransaction: jest.fn((exec: (tx: unknown) => unknown) =>
        exec({ __tx: true }),
      ),
      prisma: {
        dish_media: { findUnique: jest.fn() },
        dish_reviews: { findUnique: jest.fn() },
        dish_category_group_vote_sessions: {
          findUnique: jest.fn().mockResolvedValue({ host_user_id: HOST_ID }),
        },
      },
    };

    usersService = {
      getUserByIds: jest
        .fn()
        .mockResolvedValue([HOST_USER, VOTER_USER]),
    };

    logger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationJobService,
        { provide: NotificationsRepository, useValue: repo },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: PrismaService, useValue: prisma },
        { provide: AppLoggerService, useValue: logger },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<NotificationJobService>(NotificationJobService);
  });

  const votePayload = (actorId: string) => ({
    actionType: 'vote' as const,
    targetTable: 'dish_category_group_vote_sessions' as const,
    targetId: SESSION_ID,
    actorId,
    idempotencyKey: IDEMPOTENCY_KEY,
  });

  it('参加者が投票するとホストへ通知が届く', async () => {
    await service.processNotificationJob(votePayload(VOTER_ID));

    expect(
      prisma.prisma.dish_category_group_vote_sessions.findUnique,
    ).toHaveBeenCalledWith({
      where: { id: SESSION_ID },
      select: { host_user_id: true },
    });
    expect(repo.upsertNotification).toHaveBeenCalledTimes(1);
    expect(notificationsService.sendPushNotification).toHaveBeenCalledWith(
      HOST_ID,
      expect.objectContaining({ title: 'Voter User' }),
    );
  });

  it('ホスト自身が投票しても自分には通知しない', async () => {
    await service.processNotificationJob(votePayload(HOST_ID));

    expect(repo.upsertNotification).not.toHaveBeenCalled();
    expect(notificationsService.sendPushNotification).not.toHaveBeenCalled();
  });

  it('同じ契機（同一 idempotencyKey）のジョブが2回処理されても通知は重複作成されない', async () => {
    // Cloud Tasks の再配信や、同一参加者の投票イベントに対する重複 enqueue を想定
    await service.processNotificationJob(votePayload(VOTER_ID));
    await service.processNotificationJob(votePayload(VOTER_ID));

    expect(repo.upsertNotification).toHaveBeenCalledTimes(2);
    // upsertNotification 自体は2回呼ばれるが、idempotency_key が同一のため
    // 内部的には1行に集約され、recipient も重複しない
    expect(notificationsByKey.size).toBe(1);
    const stored = notificationsByKey.get(IDEMPOTENCY_KEY);
    expect(stored?.recipientIds.size).toBe(1);
    expect(stored?.actorIds).toEqual([VOTER_ID]);
  });

  it('別の参加者が同じセッションに投票すると同一スレッドへ集約される', async () => {
    const OTHER_VOTER_ID = 'other-voter-uuid';
    usersService.getUserByIds.mockResolvedValue([
      HOST_USER,
      VOTER_USER,
      { id: OTHER_VOTER_ID, display_name: 'Other Voter', preferred_locale: 'en' },
    ]);

    await service.processNotificationJob(votePayload(VOTER_ID));
    await service.processNotificationJob(votePayload(OTHER_VOTER_ID));

    expect(notificationsByKey.size).toBe(1);
    const stored = notificationsByKey.get(IDEMPOTENCY_KEY);
    expect(stored?.actorIds).toEqual([OTHER_VOTER_ID, VOTER_ID]);
    expect(notificationsService.sendPushNotification).toHaveBeenCalledTimes(2);
  });
});
