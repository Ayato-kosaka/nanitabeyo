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
import {
  getExt,
  buildFileName,
  buildFullPath,
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
  /*                      CDN Signed Cookie Generation                      */
  /* ---------------------------------------------------------------------- */
  /**
   * Generate CDN signed cookies for URL prefix-based authentication
   * Used for HLS video playback where multiple files need to be accessed
   *
   * @param urlPrefix - The URL prefix to protect (e.g., https://cdn.example.com/prod/transcoded/dish_media/media_path/recordId/)
   * @returns Array of cookie strings ready for Set-Cookie headers
   */
  generateCdnSignedCookies(urlPrefix: string): string[] {
    try {
      // ---- normalize prefix -------------------------------------------------
      const u = new URL(urlPrefix);
      if (u.protocol !== 'https:') {
        throw new Error(`urlPrefix must be https: got ${u.protocol}`);
      }
      // ensure trailing slash for a clean prefix match
      if (!u.pathname.endsWith('/')) u.pathname = `${u.pathname}/`;
      u.search = '';
      u.hash = '';
      const normalizedPrefix = u.toString(); // https://cdn.../<path>/

      // ---- build policy -----------------------------------------------------
      // 1) base64url(URLPrefix)  ※パディングなし
      const urlPrefixB64url = b64url(Buffer.from(normalizedPrefix, 'utf8'));

      const expires =
        Math.floor(Date.now() / 1000) + env.CDN_SIGNED_COOKIE_TTL_SECONDS;
      const keyName = env.CDN_KEY_NAME;

      // 2) Cloud CDN 形式は "URLPrefix=<b64url>:Expires=<ts>:KeyName=<name>"
      const policy = `URLPrefix=${urlPrefixB64url}:Expires=${expires}:KeyName=${keyName}`;

      // ---- sign (HMAC-SHA1 with RAW key bytes) -----------------------------
      // env.CDN_KEY_SECRET_B64 は「Cloud CDN に登録した鍵」＝base64url 文字列を想定
      const keyRaw = fromB64url(env.CDN_KEY_SECRET_B64);

      const sigRaw = crypto.createHmac('sha1', keyRaw).update(policy).digest();
      const signature = b64url(sigRaw); // base64url (no padding)

      // ---- build Set-Cookie -------------------------------------------------
      const cookieValue = `${policy}:Signature=${signature}`;
      const cookiePath = u.pathname; // cookie の Path は prefix のパス部分

      const cookie =
        `Cloud-CDN-Cookie=${cookieValue}; ` +
        `Domain=.${u.hostname.includes('.') ? u.hostname.split('.').slice(1).join('.') : u.hostname}; ` +
        `Path=${cookiePath}; ` +
        `Max-Age=${env.CDN_SIGNED_COOKIE_TTL_SECONDS}; ` +
        `HttpOnly; Secure; SameSite=None; Partitioned`;

      this.logger.debug(
        'CdnSignedCookiesGenerated',
        'generateCdnSignedCookies',
        {
          urlPrefix: normalizedPrefix,
          expires: new Date(expires * 1000).toISOString(),
          cookiePreview: cookie.slice(0, 200) + '...',
        },
      );

      // 1枚クッキー方式（Cloud-CDN-Cookie）で返す。
      // ※運用が「3分割クッキー」なら、Policy/Signature/KeyName を別々に出す実装を追加してください。
      return [cookie];
    } catch (err) {
      this.logger.error('CdnSignedCookieError', 'generateCdnSignedCookies', {
        error_message: (err as Error).message,
        urlPrefix,
      });
      throw err;
    }
  }
}

function b64url(buf: Buffer) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function fromB64url(s: string) {
  return Buffer.from(
    s
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(s.length / 4) * 4, '='),
    'base64',
  );
}
