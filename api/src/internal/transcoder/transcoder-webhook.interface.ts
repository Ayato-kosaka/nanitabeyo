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
  table_name: string;
  column_name: string;
  record_id: string;
  retry?: string;
  video_only?: 'true' | 'false';
};
