import { Inject, Injectable } from '@nestjs/common';
import { Bucket, Storage } from '@google-cloud/storage';
import { env } from '../config/env';
import { AppLoggerService } from '../logger/logger.service';
import { STORAGE_CLIENT } from './storage.constants';
import { UploadFileParams, UploadResult } from './storage.types';
import { getExt, buildFileName, buildFullPath } from './storage.utils';

@Injectable()
export class StorageService {
  /** GCS バケットハンドル（ctor で安全に初期化） */
  private readonly bucket: Bucket;

  constructor(
    @Inject(STORAGE_CLIENT) private readonly storage: Storage,
    private readonly logger: AppLoggerService,
  ) {
    this.bucket = this.storage.bucket(env.GCS_BUCKET_NAME);
  }

  /* ---------------------------------------------------------------------- */
  /*                               Upload (Buffer)                          */
  /* ---------------------------------------------------------------------- */
  async uploadFile({
    buffer,
    mimeType,
    resourceType,
    usageType,
    identifier,
    fileName,
    metadata = {},
    expiresInSeconds = 24 * 60 * 60,
  }: UploadFileParams): Promise<UploadResult> {
    const ext = getExt(mimeType);
    const finalFileName = buildFileName(fileName ?? '', ext);
    const fullPath = buildFullPath({
      env: env.API_NODE_ENV,
      resourceType,
      usageType,
      identifier,
      finalFileName,
    });

    try {
      await this.bucket.file(fullPath).save(buffer, {
        metadata: {
          contentType: mimeType,
          metadata,
        },
        resumable: false,
      });

      const signedUrl = await this.generateSignedUrl(
        fullPath,
        expiresInSeconds,
      );

      return { path: fullPath, signedUrl };
    } catch (err) {
      this.logger.error('GcsUploadError', 'uploadFile', {
        error_message: (err as Error).message,
        path: fullPath,
      });
      throw err;
    }
  }

  /* ---------------------------------------------------------------------- */
  /*                            Signed URL (READ)                           */
  /* ---------------------------------------------------------------------- */
  async generateSignedUrl(
    path: string,
    expiresInSeconds = 24 * 60 * 60,
  ): Promise<string> {
    const [url] = await this.bucket.file(path).getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresInSeconds * 1_000,
    });
    return url;
  }

  /* ---------------------------------------------------------------------- */
  /*                           Signed URL (WRITE)                           */
  /* ---------------------------------------------------------------------- */
  async generateSignedUrlForUpload(
    path: string,
    expiresInSeconds = 15 * 60, // 15 minutes default
  ): Promise<string> {
    const [url] = await this.bucket.file(path).getSignedUrl({
      action: 'write',
      expires: Date.now() + expiresInSeconds * 1_000,
      contentType: 'application/octet-stream', // Generic content type
    });
    return url;
  }

  /* ---------------------------------------------------------------------- */
  /*                               Delete File                              */
  /* ---------------------------------------------------------------------- */
  async deleteFile(path: string): Promise<void> {
    try {
      await this.bucket.file(path).delete();
    } catch (err) {
      this.logger.error('GcsDeleteError', 'deleteFile', {
        error_message: (err as Error).message,
        path,
      });
      throw err;
    }
  }
}
