// api/src/internal/transcoder/transcoder-webhook.interface.ts
//
// Pub/Sub メッセージおよび Transcoder Job 通知のインターフェース
//

import { protos } from '@google-cloud/video-transcoder';

/**
 * Pub/Sub Push メッセージの形式
 */
export interface PubSubPushMessage {
  message: {
    data: string; // Base64 encoded JSON
    messageId: string;
    publishTime: string;
    attributes?: Record<string, string>;
  };
  subscription: string;
}

/**
 * PubSubPushMessage の message.data 部分のデコード後ペイロード
 */
export interface TranscoderJobPayload {
  job: {
    name: string;
    state: string;
    error?: protos.google.rpc.IStatus | null;
    labels?: TranscoderJobLabels | null;
    inputUri?: string | null;
    outputUri?: string | null;
  };
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
