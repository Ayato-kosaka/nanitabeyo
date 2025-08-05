import { Inject, Injectable, Logger } from '@nestjs/common';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import chunk from 'lodash.chunk';

import {
  NOTIFIER_EXPO_CLIENT,
  NOTIFIER_CHUNK_SIZE,
} from './notifier.constants';
import { PushMessage, PushTicket } from './notifier.types';

@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);

  constructor(@Inject(NOTIFIER_EXPO_CLIENT) private readonly expo: Expo) {}

  /* ------------------------------------------------------------------ */
  /*                         Public send API                             */
  /* ------------------------------------------------------------------ */

  /**
   * Expo Push 送信（トークン自動バリデーション＆チャンク送信）
   */
  async sendPush(messages: PushMessage[]): Promise<PushTicket[]> {
    const validMessages = messages
      .filter((msg) => this.validateToken(msg.to))
      .map<ExpoPushMessage>((msg) => ({
        to: msg.to,
        title: msg.title,
        body: msg.body,
        data: msg.data,
        sound: msg.sound ?? 'default',
        ttl: msg.ttl,
        priority: msg.priority ?? 'default',
      }));

    if (!validMessages.length) return [];

    const chunks = chunk(validMessages, NOTIFIER_CHUNK_SIZE);
    const tickets: PushTicket[] = [];

    for (const chunkMsgs of chunks) {
      try {
        const resp = await this.expo.sendPushNotificationsAsync(chunkMsgs);
        tickets.push(
          ...resp.map<PushTicket>((t: ExpoPushTicket) => ({
            status: t.status,
            id: 'id' in t ? t.id : undefined,
            message: (t as any).message,
            details: (t as any).details,
          })),
        );
      } catch (err) {
        this.logger.error(
          `Expo push chunk failed: ${(err as Error).message}`,
          err as Error,
        );
        // チャンク丸ごと失敗時はステータス error で埋める
        tickets.push(
          ...chunkMsgs.map<PushTicket>(() => ({
            status: 'error',
            message: (err as Error).message,
          })),
        );
      }
    }
    return tickets;
  }

  /* ------------------------------------------------------------------ */
  /*                       Domain-specific helpers                       */
  /* ------------------------------------------------------------------ */
  // 必要に応じてアプリ層が override / 拡張

  validateToken(token: string): boolean {
    const ok = Expo.isExpoPushToken(token);
    if (!ok) {
      this.logger.warn(`Invalid Expo push token skipped: ${token}`);
    }
    return ok;
  }
}
