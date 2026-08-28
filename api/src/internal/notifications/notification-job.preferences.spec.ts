// api/src/internal/notifications/notification-job.preferences.spec.ts
//
// ❶ #1510 SET-02「オフにした種別のプッシュが実際に送られない」の回帰テスト
// ❷ 同時に「オフでも通知レコードは作られる（アプリ内一覧には残る）」を固定する。
//    ここが崩れると、ユーザーは通知を切っていた期間に何が起きたか永久に確認できなくなる
// ❸ 「未設定の既存ユーザーの挙動が変わらない」＝ 行が無ければ従来どおり送る、も固定する
//

// core/config/env は import 時に process.env をバリデーションして throw するため、
// 実DB・実APIに触れない単体テストでも .env が無いと suite ごと落ちる。
// notification-job.service.ts は logger 経由でこれを推移的に読み込むので、
// DI で差し替えるより手前、モジュール解決の段階で無害化する
// （dish-media.service.spec.ts と同じ作法）。
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
import { NotificationJobPayload } from './notification-job.interface';
import { NotificationsRepository } from '../../v1/notifications/notifications.repository';
import { NotificationsService } from '../../v1/notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { UsersService } from '../../v1/users/users.service';

const RECIPIENT_ID = 'recipient-uuid';
const ACTOR_ID = 'actor-uuid';
const TARGET_ID = 'dish-media-uuid';
const NOTIFICATION_ID = 'notification-uuid';

/** dish_media への like（= カテゴリ likes）のジョブ */
const likeJob: NotificationJobPayload = {
  actionType: 'like',
  targetTable: 'dish_media',
  targetId: TARGET_ID,
  actorId: ACTOR_ID,
  idempotencyKey: `dish_media:like:${TARGET_ID}`,
};

describe('#1510 SET-02 通知カテゴリ別のプッシュ抑止', () => {
  let service: NotificationJobService;
  let repo: {
    upsertNotification: jest.Mock;
    findNotificationPreference: jest.Mock;
    claimPushDelivery: jest.Mock;
  };
  let notificationsService: {
    sendPushNotification: jest.Mock;
    isPushAllowedForKind: jest.Mock;
  };
  let prisma: {
    withTransaction: jest.Mock;
    prisma: { dish_media: { findFirst: jest.Mock } };
  };
  let logger: {
    debug: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    log: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      upsertNotification: jest
        .fn()
        .mockResolvedValue({ notificationId: NOTIFICATION_ID, isNew: true }),
      findNotificationPreference: jest.fn().mockResolvedValue(null),
      // #1599 既定は「まだ送っていない＝送ってよい」
      claimPushDelivery: jest.fn().mockResolvedValue(true),
    };

    notificationsService = {
      sendPushNotification: jest.fn().mockResolvedValue(undefined),
      // 既定は「送ってよい」。オフのケースだけテスト側で差し替える
      isPushAllowedForKind: jest
        .fn()
        .mockResolvedValue({ allowed: true, category: 'likes' }),
    };

    prisma = {
      // 通知の upsert はトランザクション内。ここでは中身のコールバックをそのまま実行する
      withTransaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback({}),
      ),
      prisma: {
        dish_media: {
          // #1513 で本体が `findUnique` から `findFirst`（+ `deleted_at: null`）へ
          // 変わったのに、このモックだけ取り残されていた。結果この suite の 6 件は
          // «findFirst is not a function» で全滅したまま緑扱いになっていた。
          findFirst: jest.fn().mockResolvedValue({ user_id: RECIPIENT_ID }),
        },
      },
    };

    logger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };

    const usersService = {
      getUserByIds: jest.fn().mockResolvedValue([
        { id: ACTOR_ID, display_name: 'Actor', preferred_locale: 'ja' },
        { id: RECIPIENT_ID, display_name: 'Recipient', preferred_locale: 'ja' },
      ]),
      // #1557 «退会した» と «そもそも users 行が無い（匿名）» を区別するために
      // 本体が後から使い始めた取得。ここも更新し忘れていた 3 つ目のズレ。
      // 既定は「誰も退会していない」= deleted_at なしで両者を返す。
      getUsersByIdsIncludingDeleted: jest.fn().mockResolvedValue([
        { id: ACTOR_ID, deleted_at: null },
        { id: RECIPIENT_ID, deleted_at: null },
      ]),
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

    service = module.get(NotificationJobService);
  });

  it('カテゴリがオフならプッシュを送らない', async () => {
    notificationsService.isPushAllowedForKind.mockResolvedValue({
      allowed: false,
      category: 'likes',
    });

    await service.processNotificationJob(likeJob);

    expect(notificationsService.sendPushNotification).not.toHaveBeenCalled();
  });

  it('カテゴリがオフでも通知レコードは作る（アプリ内一覧には残す）', async () => {
    notificationsService.isPushAllowedForKind.mockResolvedValue({
      allowed: false,
      category: 'likes',
    });

    await service.processNotificationJob(likeJob);

    expect(repo.upsertNotification).toHaveBeenCalledTimes(1);
    // 受信者・種別が欠けていないこと（一覧に出るのに必要な情報）
    expect(repo.upsertNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action_type: 'like',
        target_table: 'dish_media',
        target_id: TARGET_ID,
      }),
      [RECIPIENT_ID],
      ACTOR_ID,
    );
  });

  it('抑止したことを後から数えられるログに残す', async () => {
    notificationsService.isPushAllowedForKind.mockResolvedValue({
      allowed: false,
      category: 'likes',
    });

    await service.processNotificationJob(likeJob);

    expect(logger.log).toHaveBeenCalledWith(
      'NotificationPushSuppressedByPreference',
      'processNotificationJob',
      expect.objectContaining({ recipientId: RECIPIENT_ID, category: 'likes' }),
    );
  });

  it('カテゴリがオンならプッシュを送る', async () => {
    await service.processNotificationJob(likeJob);

    expect(notificationsService.sendPushNotification).toHaveBeenCalledTimes(1);
    expect(notificationsService.sendPushNotification).toHaveBeenCalledWith(
      RECIPIENT_ID,
      expect.objectContaining({ body: expect.any(String) }),
    );
  });

  it('判定には受信者ID と (target_table, action_type) の組を渡す', async () => {
    await service.processNotificationJob(likeJob);

    expect(notificationsService.isPushAllowedForKind).toHaveBeenCalledWith(
      RECIPIENT_ID,
      { targetTable: 'dish_media', actionType: 'like' },
    );
  });

  it('設定の読み取りに失敗したら例外を伝播させる（Cloud Tasks のリトライに乗せる）', async () => {
    notificationsService.isPushAllowedForKind.mockRejectedValue(
      new Error('DBUnavailable'),
    );

    await expect(service.processNotificationJob(likeJob)).rejects.toThrow(
      'DBUnavailable',
    );
    expect(notificationsService.sendPushNotification).not.toHaveBeenCalled();
  });
});
