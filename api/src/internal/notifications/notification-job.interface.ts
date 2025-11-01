// api/src/internal/notifications/notification-job.interface.ts
//
// Cloud Tasks から渡される通知ジョブのペイロード
//

export interface NotificationJobPayload {
  actionType: 'like' | 'save';
  targetTable: 'dish_media' | 'dish_reviews';
  targetId: string;
  actorId: string;
  idempotencyKey: string;
}
