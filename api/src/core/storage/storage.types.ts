import { EXTENSION_TABLE } from './storage.utils';

export interface UploadFileParams {
  /** File buffer  */
  buffer: Buffer;
  mimeType: keyof typeof EXTENSION_TABLE;

  /** e.g. 'user-uploads', 'system-generated' */
  resourceType: string;
  /** e.g. 'photos', 'audio-guides' */
  usageType: string;
  /** e.g. userId, spotId */
  identifier: string;

  /** メタデータ (request_id など) */
  metadata?: Record<string, string>;

  /** 署名 URL 有効期限 (秒) */
  expiresInSeconds?: number;
}

export interface UploadFileAtPathParams {
  /** File buffer */
  buffer: Buffer;
  mimeType: keyof typeof EXTENSION_TABLE;
  /** Full GCS path where the file should be stored */
  fullPath: string;
  /** メタデータ (request_id など) */
  metadata?: Record<string, string>;
  /** 署名 URL 有効期限 (秒) */
  expiresInSeconds?: number;
  /** 既存ファイルがある場合上書きするか */
  overwriteIfExists?: boolean;
}

export interface UploadResult {
  /** GCS 内フルパス  */
  path: string;
  /** 読み取り用署名 URL  */
  signedUrl: string;
}
