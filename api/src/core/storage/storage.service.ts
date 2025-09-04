import { Inject, Injectable } from '@nestjs/common';
import { Bucket, Storage } from '@google-cloud/storage';
import { env } from '../config/env';
import { AppLoggerService } from '../logger/logger.service';
import { STORAGE_CLIENT } from './storage.constants';
import {
  UploadFileParams,
  UploadFileAtPathParams,
  UploadResult,
} from './storage.types';
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
    metadata = {},
    expiresInSeconds = 24 * 60 * 60,
  }: UploadFileParams): Promise<UploadResult> {
    const ext = getExt(mimeType);
    const finalFileName = buildFileName(identifier, ext);
    const fullPath = buildFullPath({
      env: env.API_NODE_ENV,
      resourceType,
      usageType,
      finalFileName,
    });

    return this.saveAndSign(
      fullPath,
      buffer,
      mimeType,
      metadata,
      expiresInSeconds,
      true, // Allow overwrite for existing uploadFile behavior
    );
  }

  /* ---------------------------------------------------------------------- */
  /*                          Upload at Specific Path                       */
  /* ---------------------------------------------------------------------- */
  async uploadFileAtPath({
    buffer,
    mimeType,
    fullPath,
    metadata = {},
    expiresInSeconds = 24 * 60 * 60,
    overwriteIfExists = false,
  }: UploadFileAtPathParams): Promise<UploadResult> {
    return this.saveAndSign(
      fullPath,
      buffer,
      mimeType,
      metadata,
      expiresInSeconds,
      overwriteIfExists,
    );
  }

  /* ---------------------------------------------------------------------- */
  /*                       Common Save and Sign Logic                       */
  /* ---------------------------------------------------------------------- */
  private async saveAndSign(
    fullPath: string,
    buffer: Buffer,
    mimeType: string,
    metadata: Record<string, string>,
    expiresInSeconds: number,
    overwriteIfExists: boolean,
  ): Promise<UploadResult> {
    try {
      const file = this.bucket.file(fullPath);

      // Check if file exists and handle overwrite logic
      if (!overwriteIfExists) {
        const [exists] = await file.exists();
        if (exists) {
          this.logger.debug('FileAlreadyExists', 'saveAndSign', {
            path: fullPath,
            action: 'skipping_upload',
          });
          // Return existing file's signed URL
          const signedUrl = await this.generateSignedUrl(
            fullPath,
            expiresInSeconds,
          );
          return { path: fullPath, signedUrl };
        }
      }

      await file.save(buffer, {
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
      this.logger.error('GcsUploadError', 'saveAndSign', {
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
  /*                        Signed URL (PUT) for Upload                    */
  /* ---------------------------------------------------------------------- */
  async generateSignedPutUrl(
    path: string,
    contentType: string,
    expiresInSeconds = 15 * 60, // 15分
  ): Promise<{ putUrl: string; objectPath: string; expiresAt: string }> {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1_000);
    
    try {
      const [url] = await this.bucket.file(path).getSignedUrl({
        action: 'write',
        expires: expiresAt,
        contentType,
      });

      this.logger.debug('SignedPutUrlGenerated', 'generateSignedPutUrl', {
        path,
        contentType,
        expiresAt: expiresAt.toISOString(),
      });

      return {
        putUrl: url,
        objectPath: path,
        expiresAt: expiresAt.toISOString(),
      };
    } catch (err) {
      this.logger.error('GcsSignedPutUrlError', 'generateSignedPutUrl', {
        error_message: (err as Error).message,
        path,
        contentType,
      });
      throw err;
    }
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
