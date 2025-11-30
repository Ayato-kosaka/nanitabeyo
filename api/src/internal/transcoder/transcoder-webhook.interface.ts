// api/src/internal/transcoder/transcoder-webhook.interface.ts
//
// Pub/Sub メッセージおよび Transcoder Job 通知のインターフェース
//

/**
 * Pub/Sub Push メッセージの形式
 */
export interface PubSubPushMessage {
  message: {
    data: string; // Base64 encoded
    messageId: string;
    publishTime: string;
    attributes?: Record<string, string>;
  };
  subscription: string;
}

/**
 * Transcoder Job 完了通知の attributes（Pub/Sub message attributes）
 */
export interface TranscoderJobNotificationAttributes {
  jobId: string;
  state: string;
}

/**
 * Transcoder Job の labels（tableName, columnName, recordId など）
 */
export type TranscoderJobLabels = Record<string, string> & {
  tableName: string;
  columnName: string;
  recordId: string;
  retry?: string;
  videoOnly?: 'true' | 'false';
}
