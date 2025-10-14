import { Inject, Injectable } from '@nestjs/common';
import { Bucket, Storage } from '@google-cloud/storage';
import { env } from '../config/env';
import { AppLoggerService } from '../logger/logger.service';
import { STORAGE_CLIENT } from './storage.constants';
import {
  UploadFileParams,
  UploadFileAtPathParams,
  UploadResult,
  GetResizedSignedUrlParams,
} from './storage.types';
import {
  getExt,
  buildFileName,
  buildFullPath,
  buildResizedPath,
} from './storage.utils';
import { CloudTasksService } from '../cloud-tasks/cloud-tasks.service';
import * as crypto from 'crypto';

@Injectable()
export class StorageService {
  /** GCS バケットハンドル（ctor で安全に初期化） */
  private readonly bucket: Bucket;

  constructor(
    @Inject(STORAGE_CLIENT) private readonly storage: Storage,
    private readonly logger: AppLoggerService,
    private readonly cloudTasks: CloudTasksService,
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

  /* ---------------------------------------------------------------------- */
  /*                           Check File Exists                            */
  /* ---------------------------------------------------------------------- */
  async fileExists(path: string): Promise<boolean> {
    try {
      const [exists] = await this.bucket.file(path).exists();
      return exists;
    } catch (err) {
      this.logger.error('GcsFileExistsError', 'fileExists', {
        error_message: (err as Error).message,
        path,
      });
      return false;
    }
  }

  /* ---------------------------------------------------------------------- */
  /*                  Get or Queue Resized Signed URL                       */
  /* ---------------------------------------------------------------------- */
  /**
   * Get signed URL for resized image, or queue resize if not exists
   * Returns original signed URL if resize is queued
   */
  async getOrQueueResizedSignedUrl(
    params: GetResizedSignedUrlParams,
    originalPath: string,
    expiresInSeconds = 24 * 60 * 60,
  ): Promise<string> {
    // Build resized image path following naming convention
    const resizedPath = buildResizedPath(params);

    try {
      const [exists, resizedSignedUrl, originalSignedUrl] = await Promise.all([
        this.fileExists(resizedPath), // ネットワーク
        this.generateSignedUrl(resizedPath, expiresInSeconds), // ローカル署名
        this.generateSignedUrl(originalPath, expiresInSeconds), // ローカル署名
      ]);

      if (exists) {
        // Return resized image signed URL
        this.logger.debug('ResizedImageExists', 'getOrQueueResizedSignedUrl', {
          resizedPath,
        });
        return resizedSignedUrl;
      }

      // Resized image doesn't exist, queue async resize
      this.logger.debug('ResizedImageNotFound', 'getOrQueueResizedSignedUrl', {
        resizedPath,
        queueingResize: true,
      });

      // Queue async resize using CloudTasksService
      this.cloudTasks.enqueueResizeImage(params).catch((err) => {
        this.logger.warn('ResizeQueueError', 'getOrQueueResizedSignedUrl', {
          params,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });

      // Return original image signed URL for now
      return originalSignedUrl;
    } catch (err) {
      this.logger.error(
        'GetOrQueueResizedSignedUrlError',
        'getOrQueueResizedSignedUrl',
        {
          params,
          error: (err as Error).message,
        },
      );
      // Fallback to original on error
      return this.generateSignedUrl(originalPath, expiresInSeconds);
    }
  }

  /* ---------------------------------------------------------------------- */
  /*                      CDN Signed Cookie Generation                      */
  /* ---------------------------------------------------------------------- */
  /**
   * Generate CDN signed cookies for URL prefix-based authentication
   * Used for HLS video playback where multiple files need to be accessed
   * 
   * @param urlPrefix - The URL prefix to protect (e.g., https://cdn.example.com/prod/transcoded/dish_media/media_path/recordId/)
   * @param recordId - The record ID for cookie path scoping
   * @returns Array of cookie strings ready for Set-Cookie headers
   */
  generateCdnSignedCookies(
    urlPrefix: string,
    recordId: string,
  ): string[] | null {
    // Return null if CDN configuration is not available
    if (!env.CDN_HOST || !env.CDN_KEY_NAME || !env.CDN_KEY_SECRET_B64) {
      this.logger.warn('CdnConfigMissing', 'generateCdnSignedCookies', {
        urlPrefix,
        recordId,
      });
      return null;
    }

    try {
      const keySecret = Buffer.from(env.CDN_KEY_SECRET_B64, 'base64');
      const expires = Math.floor(Date.now() / 1000) + env.CDN_SIGNED_COOKIE_TTL_SECONDS;
      
      // Create signature for Cloud CDN signed cookies
      // Format: URLPrefix=<prefix>&Expires=<timestamp>&KeyName=<keyname>
      const toSign = `URLPrefix=${urlPrefix}&Expires=${expires}&KeyName=${env.CDN_KEY_NAME}`;
      
      const signature = crypto
        .createHmac('sha1', keySecret)
        .update(toSign)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      // Build cookie path from URL prefix
      const urlObj = new URL(urlPrefix);
      const cookiePath = urlObj.pathname;

      // Create the three required cookies for Cloud CDN signed URLs
      const cookies = [
        `Cloud-CDN-Cookie=URLPrefix=${urlPrefix}:Expires=${expires}:KeyName=${env.CDN_KEY_NAME}:Signature=${signature}; Domain=${env.CDN_HOST}; Path=${cookiePath}; Max-Age=${env.CDN_SIGNED_COOKIE_TTL_SECONDS}; HttpOnly; Secure; SameSite=None`,
      ];

      this.logger.debug('CdnSignedCookiesGenerated', 'generateCdnSignedCookies', {
        urlPrefix,
        recordId,
        expires: new Date(expires * 1000).toISOString(),
        cookieCount: cookies.length,
      });

      return cookies;
    } catch (err) {
      this.logger.error('CdnSignedCookieError', 'generateCdnSignedCookies', {
        error_message: (err as Error).message,
        urlPrefix,
        recordId,
      });
      return null;
    }
  }
}
