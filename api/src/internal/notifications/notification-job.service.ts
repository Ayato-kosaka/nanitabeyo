// api/src/internal/notifications/notification-job.service.ts
//
// ❶ Cloud Tasks から通知ジョブを受領し、通知作成＋Expo Push配信を実行
// ❷ 自己通知の skip、idempotency_key での集約、失効トークン削除
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';

import { NotificationJobPayload } from './notification-job.interface';
import { NotificationsRepository } from '../../v1/notifications/notifications.repository';
import { NotificationsService } from '../../v1/notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { UsersService } from 'src/v1/users/users.service';

@Injectable()
export class NotificationJobService {
  constructor(
    private readonly repo: NotificationsRepository,
    private readonly service: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly userService: UsersService,
  ) {}

  /**
   * 通知ジョブを処理
   */
  async processNotificationJob(payload: NotificationJobPayload): Promise<void> {
    const { actionType, targetTable, targetId, actorId, idempotencyKey } =
      payload;

    this.logger.debug('ProcessingNotificationJob', 'processNotificationJob', {
      actionType,
      targetTable,
      targetId,
      actorId,
      idempotencyKey,
    });

    // 1. recipient を解決（対象の作者ID）
    const recipient = await this.resolveRecipient(targetTable, targetId);
    if (!recipient) {
      throw new Error(
        `RecipientNotFound: Could not resolve recipient for targetTable=${targetTable}, targetId=${targetId}`,
      );
    }

    const recipientId = recipient.user_id;
    // 2-1. 作者なしなら skip
    if (!recipientId) {
      this.logger.debug('RecipientUserNotFound', 'processNotificationJob', {
        recipientId,
      });
      return;
    }
    // 2-2. 自己通知なら skip
    if (recipientId === actorId) {
      this.logger.debug('SelfNotificationSkipped', 'processNotificationJob', {
        recipientId,
      });
      return;
    }

    // 2-3. #1511 退会したユーザーが絡む通知は作らない（送らない）
    //
    // 退会者が actor 側なら通知の意味が無く、recipient 側なら宛先が居ない。
    // どちらも **成功として skip** するのが正しい。
    // ここを見ずに先へ進むと `buildNotificationMessage` が throw し、
    // Cloud Tasks が恒久的に失敗するジョブを再試行し続けることになる
    // （退会は「もう存在しない」であって、あとで直る類の失敗ではない）。
    //
    // ⚠️ #1557 «退会した» と «そもそも users 行が無い» を混同しないこと。
    // 共有リンク経由の匿名投票者には users 行が無いが、**通知は作らなければならない**
    // （表示名は receiver のロケールで「ゲスト」等に落ちる）。
    // `getUserByIds` は削除済みを返さないため、この 2 つが区別できない。
    // «行があって deleted_at が立っている» ときだけ弾く。
    const knownUsers = await this.userService.getUsersByIdsIncludingDeleted([
      actorId,
      recipientId,
    ]);
    const deletedUserIds = new Set(
      knownUsers.filter((u) => u.deleted_at != null).map((u) => u.id),
    );
    if (deletedUserIds.has(actorId) || deletedUserIds.has(recipientId)) {
      this.logger.log(
        'DeletedUserNotificationSkipped',
        'processNotificationJob',
        {
          actorId,
          recipientId,
          actorDeleted: deletedUserIds.has(actorId),
          recipientDeleted: deletedUserIds.has(recipientId),
        },
      );
      return;
    }

    // 3. トランザクション内で通知を upsert
    const { notificationId, isNew } = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.upsertNotification(
          tx,
          {
            action_type: actionType,
            target_table: targetTable,
            target_id: targetId,
            idempotency_key: idempotencyKey,
          },
          [recipientId],
          actorId,
        ),
    );

    this.logger.log('NotificationUpserted', 'processNotificationJob', {
      notificationId,
      isNew,
      actorId,
      recipientId,
    });

    // 4. #1510 SET-02 プッシュ配信の可否をユーザー設定で判定する
    //
    // 【設計】判定はここ（upsert 済み・push 直前）にしか置かない。
    //   - 「オフ = プッシュ送信のみ抑止。通知一覧には残す」がリーダー判断（Issue #1510）。
    //     手順 3 の upsert を条件付きにすると、後で再びオンにしても過去分は永久に見えない
    //     （抑止は可逆、レコード不作成は不可逆）。迷ったら可逆側に倒す
    //   - 未読バッジは `thread_updated_at > last_read_at` で数えるため、
    //     一覧に残す限りバッジも従来どおり動き、経路の分岐が増えない
    //   - `sendPushNotification()` の内側には入れない。あの関数は recipientId とメッセージしか
    //     受け取らず種別を知らないため、種別が手元にあるここで判定するほうが変更が局所で済む
    const { allowed, category } = await this.service.isPushAllowedForKind(
      recipientId,
      { targetTable, actionType },
    );
    if (!allowed) {
      this.logger.log(
        'NotificationPushSuppressedByPreference',
        'processNotificationJob',
        { notificationId, recipientId, category, actionType, targetTable },
      );
      return;
    }

    // 5. Expo Push を送信
    // 連打エラーなどは事前にエラーがスローされる想定。
    // #1557 【設計】message が null のときは push を送らない（匿名ホスト宛て。
    // 通知行は 3. で upsert 済みなので、後日アカウント登録すれば一覧には出る）
    const message = await this.buildNotificationMessage({
      actionType,
      targetTable,
      recipientId,
      actorId,
    });
    if (!message) return;

    // 6. #1599 【バグ】**再配送で同じ Push が 2 回届くのを止める。**
    //
    // Cloud Tasks は at-least-once 配送で、**ハンドラが成功したのに応答が届かなかった
    // 場合も再実行される**。手順 3 の upsert は idempotency_key で冪等なので «通知行» は
    // 二重にならないが、ここは無条件に走っていたため配信だけが二重になっていた。
    // 行の冪等性と配信の冪等性は別の話である。
    //
    // 【設計】`isNew` で分岐してはいけない。同じ投稿への 2 人目以降のいいねは
    // isNew: false の経路に入るので、**通知そのものが届かなくなる**。
    // 区別すべきは «再配送» と «正当な追加イベント» であって «新規» と «既存» ではない。
    //
    // 「送ってから記録する」ではなく **「記録できたら送る」**。逆順にすると、
    // 記録の前に落ちた場合にもう一度送ってしまう（＝直っていない）。
    const claimed = await this.repo.claimPushDelivery(
      notificationId,
      recipientId,
      actorId,
    );
    if (!claimed) {
      this.logger.log(
        'NotificationPushAlreadyDelivered',
        'processNotificationJob',
        { notificationId, recipientId, actorId },
      );
      return;
    }

    await this.service.sendPushNotification(recipientId, message);
  }

  /**
   * recipient を解決（対象の作者ID）
   */
  private async resolveRecipient(
    targetTable: string,
    targetId: string,
  ): Promise<{ user_id: string | null } | null> {
    // #1513 削除済みの投稿・レビューへの通知は作らない。「消したはずの投稿」への
    // いいね通知が届くと、通知タブから本文を開けない行が積まれる
    if (targetTable === 'dish_media') {
      const media = await this.prisma.prisma.dish_media.findFirst({
        where: { id: targetId, deleted_at: null },
        select: { user_id: true },
      });
      return media ?? null;
    } else if (targetTable === 'dish_reviews') {
      const review = await this.prisma.prisma.dish_reviews.findFirst({
        where: { id: targetId, deleted_at: null },
        select: { user_id: true },
      });
      return review ?? null;
    } else if (targetTable === 'dish_category_group_vote_sessions') {
      // #1506 GRP-04: recipient は投票セッションのホスト。
      const session =
        await this.prisma.prisma.dish_category_group_vote_sessions.findUnique({
          where: { id: targetId },
          select: { host_user_id: true },
        });
      return session ? { user_id: session.host_user_id } : null;
    }

    return null;
  }

  /**
   * 通知メッセージを構築
   *
   * #1557 【設計】このアプリの匿名ユーザーには users 行が存在しない
   * （20260807T0000_create_share_links.sql のヘッダ参照）。users 行の不在は
   * エラーではなく「匿名ユーザー」を意味するので、ここでは throw しない。
   * - actor 不在（匿名ユーザーの投票。友達投票は匿名参加が仕様 →
   *   dish-category-group-votes.controller.ts 冒頭）… ゲスト表示名で通知を作る
   * - recipient 不在（匿名ホスト）… null を返して push を skip する。匿名ユーザーは
   *   device token 登録も通知一覧の閲覧もできず（どちらも AuthUserGuard）配信先が無い。
   *   throw すると Cloud Tasks が永久に成功しないジョブを retry し続けるだけになる
   */
  private async buildNotificationMessage({
    actionType,
    targetTable,
    actorId,
    recipientId,
  }: {
    actionType: string;
    targetTable: string;
    actorId: string;
    recipientId: string;
  }): Promise<{ title: string | undefined; body: string } | null> {
    // 通知の送信者と受信者を取得
    const users = await this.userService.getUserByIds([actorId, recipientId]);
    const actor = users.find((u) => u.id === actorId);
    const recipient = users.find((u) => u.id === recipientId);
    if (!recipient) {
      this.logger.warn('RecipientUserRowMissing', 'buildNotificationMessage', {
        recipientId,
      });
      return null;
    }

    const SUPPORTED_LOCALES = [
      'ar',
      'en',
      'es',
      'fr',
      'hi',
      'ja',
      'ko',
      'zh',
    ] as const;
    // #1557 【互換性】匿名 actor の表示名。app-expo locales/*.json の
    // Profile.guestDisplayName と同じ文言（プロフィールのゲスト表示と揃える。
    // 新しい文言を増やさない）。8 ロケールは SUPPORTED_LOCALES と一致させること
    const GUEST_DISPLAY_NAMES: Record<
      (typeof SUPPORTED_LOCALES)[number],
      string
    > = {
      ar: 'ضيف',
      en: 'Guest',
      es: 'Invitado',
      fr: 'Invité',
      hi: 'अतिथि',
      ja: 'ゲスト',
      ko: '게스트',
      zh: '访客',
    };
    const NOTIFICATION_MESSAGES: Record<
      string,
      Record<string, Record<(typeof SUPPORTED_LOCALES)[number], string>>
    > = {
      dish_media: {
        like: {
          ar: 'أعجب بمنشورك',
          en: 'Liked your post',
          es: 'Le gustó tu publicación',
          fr: 'A aimé votre publication',
          hi: 'आपकी पोस्ट को पसंद किया',
          ja: 'あなたの投稿にいいねしました',
          ko: '귀하의 게시물을 좋아합니다',
          zh: '喜欢了你的帖子',
        },
        save: {
          ar: 'حفظ منشورك',
          en: 'Saved your post',
          es: 'Guardó tu publicación',
          fr: 'A enregistré votre publication',
          hi: 'आपकी पोस्ट को सहेजा',
          ja: 'あなたの投稿を保存しました',
          ko: '귀하의 게시물을 저장했습니다',
          zh: '保存了你的帖子',
        },
      },
      dish_reviews: {
        like: {
          ar: 'أعجب بتقييمك',
          en: 'Liked your review',
          es: 'Le gustó tu reseña',
          fr: 'A aimé votre avis',
          hi: 'आपकी समीक्षा को पसंद किया',
          ja: 'あなたのレビューにいいねしました',
          ko: '귀하의 리뷰를 좋아합니다',
          zh: '喜欢了你的评论',
        },
      },
      dish_category_group_vote_sessions: {
        vote: {
          ar: 'صوّت في مجموعتك',
          en: 'Voted in your group',
          es: 'Votó en tu grupo',
          fr: 'A voté dans votre groupe',
          hi: 'आपके ग्रुप में वोट किया',
          ja: 'あなたのグループ投票に投票しました',
          ko: '귀하의 그룹에 투표했습니다',
          zh: '在你的小组中投票了',
        },
      },
      default: {
        default: {
          ar: 'إشعار جديد',
          en: 'New Notification',
          es: 'Nueva notificación',
          fr: 'Nouvelle notification',
          hi: 'नई सूचना',
          ja: '新しい通知',
          ko: '새 알림',
          zh: '新通知',
        },
      },
    };

    // 通知の本文は、受信者の言語設定に合わせる
    let locale: (typeof SUPPORTED_LOCALES)[number] = 'en';
    const splitLocale = recipient.preferred_locale.split('-')[0];
    if (SUPPORTED_LOCALES.includes(recipient.preferred_locale as any)) {
      locale = recipient.preferred_locale as (typeof SUPPORTED_LOCALES)[number];
    } else if (splitLocale && SUPPORTED_LOCALES.includes(splitLocale as any)) {
      locale = splitLocale as (typeof SUPPORTED_LOCALES)[number];
    }

    // 通知のタイトルは、送信者の表示名を使う。
    // #1557 【設計】actor の users 行が無い＝匿名ユーザーの投票（正常系）。
    // 受信者ロケールのゲスト表示名を使う
    const title = actor
      ? (actor.display_name ?? undefined)
      : GUEST_DISPLAY_NAMES[locale];

    const actionMessages =
      NOTIFICATION_MESSAGES[targetTable]?.[actionType] ||
      NOTIFICATION_MESSAGES['default']['default'];
    const body = actionMessages[locale];

    return {
      title,
      body,
    };
  }
}
