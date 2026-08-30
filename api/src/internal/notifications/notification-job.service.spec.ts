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
  /**
   * #1599 «この受取人へ、この actor 分の Push を送る権利» の台帳。
   * 実装（notification_recipients.last_pushed_actor_id への条件付き UPDATE）と
   * 同じ判定をなぞる。ここを素通しの jest.fn() にすると、
   * «再配送で二重に送る» 欠陥がテストからは見えなくなる
   */
  let pushedActorByRecipient: Map<string, string>;

  let repo: {
    upsertNotification: jest.Mock;
    claimPushDelivery: jest.Mock;
  };
  let notificationsService: {
    sendPushNotification: jest.Mock;
    isPushAllowedForKind: jest.Mock;
  };
  let prisma: {
    withTransaction: jest.Mock;
    prisma: {
      dish_media: { findUnique: jest.Mock };
      dish_reviews: { findUnique: jest.Mock };
      dish_category_group_vote_sessions: { findUnique: jest.Mock };
    };
  };
  let usersService: {
    getUserByIds: jest.Mock;
    getUsersByIdsIncludingDeleted: jest.Mock;
  };
  let logger: {
    debug: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    log: jest.Mock;
  };

  beforeEach(async () => {
    notificationsByKey = new Map();
    nextId = 0;
    pushedActorByRecipient = new Map();

    repo = {
      upsertNotification: jest.fn(
        async (
          _tx: unknown,
          notification: { idempotency_key: string },
          recipientIds: string[],
          actorId: string,
        ) => {
          const existing = notificationsByKey.get(notification.idempotency_key);
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
      claimPushDelivery: jest.fn(
        async (
          notificationId: string,
          recipientId: string,
          actorId: string,
        ) => {
          const key = `${notificationId}:${recipientId}`;
          // 実装の `last_pushed_actor_id IS DISTINCT FROM :actorId` と同じ
          if (pushedActorByRecipient.get(key) === actorId) return false;
          pushedActorByRecipient.set(key, actorId);
          return true;
        },
      ),
    };

    notificationsService = {
      sendPushNotification: jest.fn().mockResolvedValue(undefined),
      // #1510 SET-02 で processNotificationJob が push 直前に呼ぶようになった判定。
      // 本体へ足したときにこのモックを更新し忘れ、**この suite の 14 件が
      // «is not a function» で全滅したまま緑扱いになっていた**（api の jest は
      // PR ゲートに載っていないため誰も気づけなかった）。既定は「送ってよい」。
      isPushAllowedForKind: jest
        .fn()
        .mockResolvedValue({ allowed: true, category: 'votes' }),
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
      getUserByIds: jest.fn().mockResolvedValue([HOST_USER, VOTER_USER]),
      // #1511 / #1557 «退会» と «users 行が無い（匿名）» を区別する取得。
      // 既定では getUserByIds と同じ集合を返す = 「誰も退会していない」。
      // 退会を模す test だけがこちらを個別に上書きする。
      getUsersByIdsIncludingDeleted: jest.fn((ids: string[]) =>
        usersService.getUserByIds(ids),
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

  // #1557 匿名ユーザーには users 行が存在しない（20260807T0000_create_share_links.sql）。
  // 友達投票は匿名参加が仕様（dish-category-group-votes.controller.ts 冒頭）なので、
  // actor の users 行が無くても通知が作られ、push が届くことを固定する。
  describe('#1557 匿名 actor（users 行なし）の投票', () => {
    const ANON_VOTER_ID = 'anon-voter-uuid';

    it('匿名ユーザーが投票してもホストへ通知が作られ push が届く', async () => {
      // 匿名 actor は users テーブルに行が無い → getUserByIds はホストだけを返す
      usersService.getUserByIds.mockResolvedValue([HOST_USER]);

      await service.processNotificationJob(votePayload(ANON_VOTER_ID));

      expect(repo.upsertNotification).toHaveBeenCalledTimes(1);
      expect(notificationsByKey.get(IDEMPOTENCY_KEY)?.actorIds).toEqual([
        ANON_VOTER_ID,
      ]);
      expect(notificationsService.sendPushNotification).toHaveBeenCalledWith(
        HOST_ID,
        expect.objectContaining({ title: 'Guest' }),
      );
    });

    // 受け入れ条件「通知の表示名がゲスト表現になっている（8 ロケール）」。
    // 文言は app-expo locales/*.json の Profile.guestDisplayName と同一であること
    it.each([
      ['ar', 'ضيف'],
      ['en', 'Guest'],
      ['es', 'Invitado'],
      ['fr', 'Invité'],
      ['hi', 'अतिथि'],
      ['ja', 'ゲスト'],
      ['ko', '게스트'],
      ['zh', '访客'],
    ])(
      '匿名 actor のタイトルは受信者ロケール %s で「%s」になる',
      async (locale, expectedGuestName) => {
        usersService.getUserByIds.mockResolvedValue([
          { ...HOST_USER, preferred_locale: locale },
        ]);

        await service.processNotificationJob(votePayload(ANON_VOTER_ID));

        expect(notificationsService.sendPushNotification).toHaveBeenCalledWith(
          HOST_ID,
          expect.objectContaining({ title: expectedGuestName }),
        );
      },
    );
  });

  // #1557 recipient（ホスト）の users 行が無い＝匿名ホスト。匿名ユーザーは device token 登録も
  // 通知一覧の閲覧もできない（どちらも AuthUserGuard）ため push の配信先が無い。
  // throw すると Cloud Tasks が永久に失敗するジョブを retry し続けるので、skip を固定する。
  it('匿名ホスト（users 行なし）宛ては通知行だけ作り push を skip する（throw しない）', async () => {
    usersService.getUserByIds.mockResolvedValue([VOTER_USER]);

    await service.processNotificationJob(votePayload(VOTER_ID));

    // 通知行は作られる（ホストが後日アカウント登録すれば一覧に出る）
    expect(repo.upsertNotification).toHaveBeenCalledTimes(1);
    expect(notificationsService.sendPushNotification).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'RecipientUserRowMissing',
      'buildNotificationMessage',
      { recipientId: HOST_ID },
    );
  });

  // #1511 退会したユーザーが絡む通知は作らない。
  // #1557 の «users 行が無い匿名ユーザー» と混同すると、匿名投票の通知が丸ごと消える
  // （実際に一度そうなった）。«行があって deleted_at が立っている» ときだけ弾くこと。
  describe('#1511 退会したユーザーが絡む通知', () => {
    it('actor が退会済みなら通知を作らない', async () => {
      usersService.getUsersByIdsIncludingDeleted.mockResolvedValue([
        HOST_USER,
        { ...VOTER_USER, deleted_at: new Date() },
      ]);

      await service.processNotificationJob(votePayload(VOTER_ID));

      expect(repo.upsertNotification).not.toHaveBeenCalled();
      expect(notificationsService.sendPushNotification).not.toHaveBeenCalled();
    });

    it('recipient が退会済みなら通知を作らない', async () => {
      usersService.getUsersByIdsIncludingDeleted.mockResolvedValue([
        { ...HOST_USER, deleted_at: new Date() },
        VOTER_USER,
      ]);

      await service.processNotificationJob(votePayload(VOTER_ID));

      expect(repo.upsertNotification).not.toHaveBeenCalled();
      expect(notificationsService.sendPushNotification).not.toHaveBeenCalled();
    });

    it('users 行が無いだけ（匿名）なら退会扱いにせず通知を作る', async () => {
      const ANON_ID = 'anon-not-deleted-uuid';
      // 行が存在しない = 配列に現れない。deleted_at が立っている行は 1 つも無い
      usersService.getUsersByIdsIncludingDeleted.mockResolvedValue([HOST_USER]);
      usersService.getUserByIds.mockResolvedValue([HOST_USER]);

      await service.processNotificationJob(votePayload(ANON_ID));

      expect(repo.upsertNotification).toHaveBeenCalledTimes(1);
    });
  });

  it('別の参加者が同じセッションに投票すると同一スレッドへ集約される', async () => {
    const OTHER_VOTER_ID = 'other-voter-uuid';
    usersService.getUserByIds.mockResolvedValue([
      HOST_USER,
      VOTER_USER,
      {
        id: OTHER_VOTER_ID,
        display_name: 'Other Voter',
        preferred_locale: 'en',
      },
    ]);

    await service.processNotificationJob(votePayload(VOTER_ID));
    await service.processNotificationJob(votePayload(OTHER_VOTER_ID));

    expect(notificationsByKey.size).toBe(1);
    const stored = notificationsByKey.get(IDEMPOTENCY_KEY);
    expect(stored?.actorIds).toEqual([OTHER_VOTER_ID, VOTER_ID]);
    expect(notificationsService.sendPushNotification).toHaveBeenCalledTimes(2);
  });
});
