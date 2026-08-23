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
    const { title, body } = await this.buildNotificationMessage({
      actionType,
      targetTable,
      recipientId,
      actorId,
    });

    await this.service.sendPushNotification(recipientId, {
      title,
      body,
    });
  }

  /**
   * recipient を解決（対象の作者ID）
   */
  private async resolveRecipient(
    targetTable: string,
    targetId: string,
  ): Promise<{ user_id: string | null } | null> {
    if (targetTable === 'dish_media') {
      const media = await this.prisma.prisma.dish_media.findUnique({
        where: { id: targetId },
        select: { user_id: true },
      });
      return media ?? null;
    } else if (targetTable === 'dish_reviews') {
      const review = await this.prisma.prisma.dish_reviews.findUnique({
        where: { id: targetId },
        select: { user_id: true },
      });
      return review ?? null;
    }

    return null;
  }

  /**
   * 通知メッセージを構築
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
  }) {
    // 通知の送信者と受信者を取得
    const users = await this.userService.getUserByIds([actorId, recipientId]);
    const actor = users.find((u) => u.id === actorId);
    const recipient = users.find((u) => u.id === recipientId);
    if (!actor) throw new Error(`ActorUserNotFound: actorId=${actorId}`);
    if (!recipient)
      throw new Error(`RecipientUserNotFound: recipientId=${recipientId}`);

    // 通知のタイトルは、送信者の表示名を使う
    const title = actor.display_name ?? undefined;

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
