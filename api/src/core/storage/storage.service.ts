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

  /**
   * ----------------------------------------------------------------------
   *                          CDN Signed URL Generation
   * ----------------------------------------------------------------------
   * Cloud CDN の Signed URL を生成する
   *  - デフォルト: フル URL 署名（?Expires=&KeyName= まで付けた URL 全体を HMAC-SHA1）
   *  - urlPrefix 指定時: URLPrefix 方式（URLPrefix&Expires&KeyName を HMAC-SHA1、元URLに各QPを付与）
   *
   * @param url        署名対象の URL（https 必須）
   * @param opts
   *   - ttlSeconds?:  有効期限（秒）未指定時は 24時間
   *   - urlPrefix?:   URLPrefix 方式で署名する場合のプレフィックス（https://.../ で終わるのを推奨）
   * @returns 署名済み URL
   *
   * 参考:
   *  - Signed URL の作り方（順序/HMAC/エンコード等）:contentReference[oaicite:1]{index=1}
   *  - URLPrefix を使った署名方法（パラメータと署名対象）:contentReference[oaicite:2]{index=2}
   */
  generateCdnSignedURL(
    url: string,
    opts?: { ttlSeconds?: number; urlPrefix?: boolean },
  ): string {
    // ---- validate & normalize URL -----------------------------------------
    const u = new URL(url);
    assertHttps(u, 'url');

    const ttl = opts?.ttlSeconds !== undefined ? opts.ttlSeconds : 24 * 60 * 60;
    if (ttl <= 0) throw new Error('ttlSeconds must be > 0');

    const expires = makeExpires(ttl);
    const keyName = env.CDN_KEY_NAME as string;
    const keySecretB64url = env.CDN_KEY_SECRET_B64 as string; // 登録済み Key の「RAW 16byte」を想定

    // 署名方式: URLPrefix か フル URL か
    if (opts?.urlPrefix) {
      const prefix = normalizePrefixFromUrl(u);
      const policy = buildUrlPrefixPolicy(prefix, expires, keyName);
      const signature = signPolicy(policy, keySecretB64url);

      const sep = u.search ? '&' : '?';
      const signed = `${u.toString()}${sep}${policy}&Signature=${signature}`;

      this.logger.debug('CdnSignedURLGenerated', 'generateCdnSignedURL', {
        mode: 'URLPrefix',
        prefix,
        expires: new Date(expires * 1000).toISOString(),
        preview: signed.slice(0, 200) + '...',
      });
      return signed;
    } else {
      // フル URL 署名（URL 全体に Expires/KeyName を付与し、その文字列を HMAC）
      const sep = u.search ? '&' : '?';
      const urlToSign = `${u.toString()}${sep}Expires=${expires}&KeyName=${keyName}`;
      const signature = signPolicy(urlToSign, keySecretB64url);
      const signed = `${urlToSign}&Signature=${signature}`;

      this.logger.debug('CdnSignedURLGenerated', 'generateCdnSignedURL', {
        mode: 'FullURL',
        expires: new Date(expires * 1000).toISOString(),
        preview: signed.slice(0, 200) + '...',
      });
      return signed;
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
   * @deprecated
   */
  generateCdnSignedCookies(urlPrefix: string): string[] {
    try {
      // ---- normalize prefix -------------------------------------------------
      const u = new URL(urlPrefix);
      assertHttps(u, 'urlPrefix');
      const prefix = normalizePrefixFromUrl(u);
      const expires = makeExpires(env.CDN_SIGNED_COOKIE_TTL_SECONDS);
      const keyName = env.CDN_KEY_NAME as string;
      const keySecretB64url = env.CDN_KEY_SECRET_B64 as string;

      const policy = buildCookiePolicy(prefix, expires, keyName);
      const signature = signPolicy(policy, keySecretB64url);
      const cookieValue = `${policy}:Signature=${signature}`;

      const cookiePath = new URL(prefix).pathname;
      const cookie =
        `Cloud-CDN-Cookie=${cookieValue}; ` +
        `Domain=${domainForCookie(u.hostname)}; ` +
        `Path=${cookiePath}; ` +
        `Max-Age=${env.CDN_SIGNED_COOKIE_TTL_SECONDS}; ` +
        `HttpOnly; Secure; SameSite=None; Partitioned`;

      this.logger.debug(
        'CdnSignedCookiesGenerated',
        'generateCdnSignedCookies',
        {
          urlPrefix: prefix,
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

/* ================================================================
 *                   Base64URL helpers (共通)
 * ================================================================ */
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

/* ================================================================
 *                   URL utilities (共通)
 * ================================================================ */
function assertHttps(u: URL, label = 'url') {
  if (u.protocol !== 'https:') {
    throw new Error(`${label} must be https: got ${u.protocol}`);
  }
}

function normalizePrefixFromUrl(u: URL): string {
  // クエリ/ハッシュ無効化、ファイル名を落として「ディレクトリ末尾 /」に統一
  const pu = new URL(u.toString());
  pu.search = '';
  pu.hash = '';
  const parts = pu.pathname.split('/');
  if (parts.length && parts[parts.length - 1] !== '') {
    parts.pop(); // ファイル名相当を削る
  }
  pu.pathname = parts.join('/');
  if (!pu.pathname.endsWith('/')) pu.pathname = pu.pathname + '/';
  return pu.toString();
}

function domainForCookie(hostname: string): string {
  // 2LD/3LD のざっくり対応（既存実装踏襲）
  return `.${hostname.includes('.') ? hostname.split('.').slice(1).join('.') : hostname}`;
}

/* ================================================================
 *                   Policy / Sign (共通)
 * ================================================================ */
type CommonOpts = {
  ttlSeconds: number;
  keyName: string;
  keySecretB64url: string; // Cloud CDN に登録した鍵（base64url）
};

function makeExpires(ttlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('ttlSeconds must be > 0');
  }
  return Math.floor(Date.now() / 1000) + Math.floor(ttlSeconds);
}

function signPolicy(policy: string, keySecretB64url: string): string {
  const keyRaw = fromB64url(keySecretB64url);
  const sigRaw = crypto.createHmac('sha1', keyRaw).update(policy).digest();
  return b64url(sigRaw);
}

/** URLPrefix 方式の policy 文字列を作る（& 区切り） */
function buildUrlPrefixPolicy(
  prefix: string,
  expires: number,
  keyName: string,
): string {
  const urlPrefixB64url = b64url(Buffer.from(prefix, 'utf8'));
  return `URLPrefix=${urlPrefixB64url}&Expires=${expires}&KeyName=${keyName}`;
}

/** Cookie 方式の policy 文字列（: 区切り / 既存仕様踏襲） */
function buildCookiePolicy(
  prefix: string,
  expires: number,
  keyName: string,
): string {
  const urlPrefixB64url = b64url(Buffer.from(prefix, 'utf8'));
  return `URLPrefix=${urlPrefixB64url}:Expires=${expires}:KeyName=${keyName}`;
}
