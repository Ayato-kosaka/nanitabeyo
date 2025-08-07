import { EXTENSION_TABLE } from "./storage.utils";

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

export interface UploadResult {
  /** GCS 内フルパス  */
  path: string;
  /** 読み取り用署名 URL  */
  signedUrl: string;
}
