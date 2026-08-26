// api/src/internal/notifications/notification-push-once.spec.ts
//
// #1599 **通知ジョブが再配送されると Push が二重に届く件。**
//
// Cloud Tasks は at-least-once 配送で、**ハンドラが成功したのに応答が届かなかった
// 場合も再実行される**。`processNotificationJob` は
//   1. upsertNotification（idempotency_key で冪等。行は二重にならない）
//   2. sendPushNotification（**無条件に実行**）
// という順で動いていたため、再配送されると同じ Push がユーザーへ 2 回届いていた。
// 行の冪等性と配信の冪等性は別の話である。
//
// ⚠️ ここで一番守りたいのは **「isNew で分岐してはいけない」** という点である。
// 一見それで直るように見えるが、同じ投稿への 2 人目以降のいいねは isNew: false の
// 経路に入るので、**通知そのものが届かなくなる**（症状が «二重» から «欠落» へ変わるだけ）。
// 下の «2 人目» のテストがその退行を止める。

import { Test, TestingModule } from '@nestjs/testing';
import { NotificationJobService } from './notification-job.service';
import { NotificationsRepository } from '../../v1/notifications/notifications.repository';
import { NotificationsService } from '../../v1/notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { UsersService } from '../../v1/users/users.service';

jest.mock('src/core/config/env', () => ({
  env: { API_NODE_ENV: 'test', DB_SCHEMA: 'test' },
}));

const TARGET_ID = '11111111-1111-1111-1111-111111111111';
const RECIPIENT_ID = '22222222-2222-2222-2222-222222222222';
const ACTOR_A = '33333333-3333-3333-3333-333333333333';
const ACTOR_B = '44444444-4444-4444-4444-444444444444';
const NOTIFICATION_ID = '55555555-5555-5555-5555-555555555555';

const payload = (actorId: string) => ({
  actionType: 'like',
  targetTable: 'dish_media',
  targetId: TARGET_ID,
  actorId,
  idempotencyKey: `dish_media:like:${TARGET_ID}`,
});

describe('#1599 通知ジョブの再配送で Push を二重に送らない', () => {
  let service: NotificationJobService;
  let sendPushNotification: jest.Mock;
  let claimPushDelivery: jest.Mock;
  let logger: {
    debug: jest.Mock;
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  /** notification_recipients.last_pushed_actor_id の台帳（実装と同じ判定をなぞる） */
  let pushedActorByRecipient: Map<string, string>;

  beforeEach(async () => {
    pushedActorByRecipient = new Map();

    claimPushDelivery = jest.fn(
      // eslint-disable-next-line @typescript-eslint/require-await
      async (notificationId: string, recipientId: string, actorId: string) => {
        const key = `${notificationId}:${recipientId}`;
        // `last_pushed_actor_id IS DISTINCT FROM :actorId` と同じ
        if (pushedActorByRecipient.get(key) === actorId) return false;
        pushedActorByRecipient.set(key, actorId);
        return true;
      },
    );
    sendPushNotification = jest.fn().mockResolvedValue(undefined);
    logger = {
      debug: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    /** 2 人目は isNew: false の経路に入る（idempotency_key を共有するため） */
    let created = false;
    const upsertNotification = jest.fn(() => {
      const isNew = !created;
      created = true;
      return Promise.resolve({ notificationId: NOTIFICATION_ID, isNew });
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationJobService,
        {
          provide: NotificationsRepository,
          useValue: { upsertNotification, claimPushDelivery },
        },
        {
          provide: NotificationsService,
          useValue: {
            sendPushNotification,
            isPushAllowedForKind: jest
              .fn()
              .mockResolvedValue({ allowed: true, category: 'likes' }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            withTransaction: jest.fn((exec: (tx: unknown) => unknown) =>
              exec({ __tx: true }),
            ),
            prisma: {
              dish_media: {
                findFirst: jest
                  .fn()
                  .mockResolvedValue({ user_id: RECIPIENT_ID }),
              },
            },
          },
        },
        { provide: AppLoggerService, useValue: logger },
        {
          provide: UsersService,
          useValue: {
            getUsersByIdsIncludingDeleted: jest.fn().mockResolvedValue([]),
            getUserByIds: jest.fn().mockResolvedValue([
              { id: ACTOR_A, display_name: 'A', preferred_locale: 'ja' },
              { id: ACTOR_B, display_name: 'B', preferred_locale: 'ja' },
              {
                id: RECIPIENT_ID,
                display_name: '受取人',
                preferred_locale: 'ja',
              },
            ]),
          },
        },
      ],
    }).compile();

    service = module.get<NotificationJobService>(NotificationJobService);
  });

  it('1 回目は Push を送る', async () => {
    await service.processNotificationJob(payload(ACTOR_A) as never);

    expect(sendPushNotification).toHaveBeenCalledTimes(1);
  });

  it('同じジョブが再配送されても Push は 1 回だけ', async () => {
    await service.processNotificationJob(payload(ACTOR_A) as never);
    await service.processNotificationJob(payload(ACTOR_A) as never);

    expect(sendPushNotification).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      'NotificationPushAlreadyDelivered',
      'processNotificationJob',
      expect.objectContaining({ recipientId: RECIPIENT_ID, actorId: ACTOR_A }),
    );
  });

  it('2 人目のいいねは «別の actor» なので、ちゃんと届く', async () => {
    // ここが落ちるなら isNew で分岐している。症状が «二重» から «欠落» へ変わるだけで、
    // 直っていない（idempotency_key を共有するので 2 人目は isNew: false に入る）
    await service.processNotificationJob(payload(ACTOR_A) as never);
    await service.processNotificationJob(payload(ACTOR_B) as never);

    expect(sendPushNotification).toHaveBeenCalledTimes(2);
  });

  it('2 人目のジョブが再配送されても、その分は 1 回だけ', async () => {
    await service.processNotificationJob(payload(ACTOR_A) as never);
    await service.processNotificationJob(payload(ACTOR_B) as never);
    await service.processNotificationJob(payload(ACTOR_B) as never);

    expect(sendPushNotification).toHaveBeenCalledTimes(2);
  });

  it('「記録できたら送る」順であること（送ってから記録していないこと）', async () => {
    // 逆順だと «送ったが記録の前に応答が落ちた» ケースで二重に送る
    const order: string[] = [];
    claimPushDelivery.mockImplementation(() => {
      order.push('claim');
      return Promise.resolve(true);
    });
    sendPushNotification.mockImplementation(() => {
      order.push('push');
      return Promise.resolve(undefined);
    });

    await service.processNotificationJob(payload(ACTOR_A) as never);

    expect(order).toEqual(['claim', 'push']);
  });

  it('権利が取れなかったときは Push を呼ばない', async () => {
    claimPushDelivery.mockResolvedValue(false);

    await service.processNotificationJob(payload(ACTOR_A) as never);

    expect(sendPushNotification).not.toHaveBeenCalled();
  });
});
