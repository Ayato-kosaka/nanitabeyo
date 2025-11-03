// api/src/internal/notifications/notification-job.interface.ts
//
// Cloud Tasks から渡される通知ジョブのペイロード
//

import { NotificationResponse } from "@shared/v1/res";

export interface NotificationJobPayload {
  actionType: NotificationResponse['action_type'];
  targetTable: NotificationResponse['target_table'];
  targetId: string;
  actorId: string;
  idempotencyKey: string;
}
