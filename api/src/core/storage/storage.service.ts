import { Inject, Injectable } from '@nestjs/common';
import { Bucket, CopyOptions, Storage } from '@google-cloud/storage';
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
  /*                     Delete File (存在しなくても成功)                   */
  /* ---------------------------------------------------------------------- */
  /**
   * #1511 実体が無くてもエラーにしない削除。
   *
   * アカウント削除は **冪等**でなければならない（途中で落ちても再実行で完了できること）。
   * `deleteFile()` は 404 でも throw するため、2 回目の実行が必ず失敗してしまう。
   * 「消えている」は目的が達成された状態なので、ここでは成功として返す。
   *
   * @returns 実際に削除したら true / 元から無ければ false
   */
  async deleteFileIfExists(path: string): Promise<boolean> {
    try {
      await this.bucket.file(path).delete({ ignoreNotFound: true });
      return true;
    } catch (err) {
      this.logger.warn('GcsDeleteIfExistsError', 'deleteFileIfExists', {
        error_message: (err as Error).message,
        path,
      });
      return false;
    }
  }

  /* ---------------------------------------------------------------------- */
  /*                      Delete Files by Prefix (前方一致)                 */
  /* ---------------------------------------------------------------------- */
  /**
   * #1511 プレフィクス配下のオブジェクトをまとめて削除する。
   *
   * 派生ファイル（リサイズ画像 `resized-image/.../<size>.webp`、
   * トランスコード動画 `transcoded-video/.../<format>/...`）は
   * **名前を 1 つずつ再現できない**（サイズ・フォーマットの一覧を呼び出し側が知らない）。
   * 実体を残さないためには前方一致で消すしかない。
   *
   * ⚠️ prefix はディレクトリ境界（`/` 終わり）で渡すこと。`.../users/avatar_path/<id>`
   * のように `/` 無しで渡すと `<id>2` のような別レコードまで巻き込む。
   * ここでは呼び出し側の事故を防ぐため、末尾に `/` が無ければ付ける。
   *
   * @returns 削除を試みた prefix（ログ用）
   */
  async deleteFilesByPrefix(prefix: string): Promise<void> {
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    try {
      await this.bucket.deleteFiles({ prefix: normalized, force: true });
      this.logger.debug('GcsPrefixDeleted', 'deleteFilesByPrefix', {
        prefix: normalized,
      });
    } catch (err) {
      // 冪等性を優先し、ここでは throw しない（呼び出し側は再実行で回収できる）
      this.logger.warn('GcsPrefixDeleteError', 'deleteFilesByPrefix', {
        error_message: (err as Error).message,
        prefix: normalized,
      });
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
  /*                   #1599 一度きりの権利取得（claim）                     */
  /* ---------------------------------------------------------------------- */
  /**
   * #1599 **そのパスを «自分が最初に作れたか» で排他する。**
   *
   * 至れり尽くせりのロックではなく、«同じ副作用を二度起こさない» ための最小の仕掛け。
   * Cloud Tasks / Pub/Sub Push は at-least-once なので、
   * **課金や外部ジョブ作成を伴う処理は「やってから記録する」では守れない**
   * （記録の前に応答が落ちれば、次の配送でもう一度やってしまう）。
   * 先に権利を取り、取れた側だけが実行する。
   *
   * ⚠️ `fileExists()` してから書く形にしてはいけない。その隙間に別の配送が入り込む。
   * ここでは GCS の **`ifGenerationMatch: 0`（オブジェクトがまだ存在しないときだけ書く）**
   * という前提条件を使う。判定と書き込みが GCS 側で 1 つになるので、
   * 同時に 2 本来ても片方だけが成功する。
   *
   * ⚠️ **claim は自動では失効しない。** 取ったあと実行前にプロセスが落ちると、
   * その処理は二度と実行されない。呼び出し側は、実行に失敗したら
   * `deleteFileIfExists()` で claim を明示的に返すこと。
   *
   * @param path 権利の識別子になる GCS パス（1 つの副作用に 1 つ）
   * @param note claim ファイルへ残す補足（誰が・何のために取ったか。調査用）
   * @returns true = 自分が取れた（実行してよい）/ false = 既に誰かが取っている
   */
  async claimOnce(
    path: string,
    note: Record<string, string> = {},
  ): Promise<boolean> {
    try {
      await this.bucket
        .file(path)
        .save(
          JSON.stringify({ claimed_at: new Date().toISOString(), ...note }),
          {
            resumable: false,
            contentType: 'application/json',
            // 「まだ無いときだけ書く」。存在すれば GCS が 412 を返す
            preconditionOpts: { ifGenerationMatch: 0 },
          },
        );

      this.logger.log('GcsClaimAcquired', 'claimOnce', { path, ...note });
      return true;
    } catch (err) {
      // 412 = preconditionFailed = 既に誰かが作っている（＝正常系）
      if ((err as { code?: number }).code === 412) {
        this.logger.log('GcsClaimAlreadyHeld', 'claimOnce', { path, ...note });
        return false;
      }

      // それ以外（権限・ネットワーク）は «取れなかった» と «取られていた» の区別が
      // つかない。握り潰すと二重実行を許すので、呼び出し側へ投げてリトライさせる
      this.logger.error('GcsClaimError', 'claimOnce', {
        error_message: (err as Error).message,
        path,
      });
      throw err;
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
    const keyName = env.CDN_KEY_NAME;
    const keySecretB64url = env.CDN_KEY_SECRET_B64; // 登録済み Key の「RAW 16byte」を想定

    // 署名方式: URLPrefix か フル URL か
    if (opts?.urlPrefix) {
      const prefix = normalizePrefixFromUrl(u);
      const policy = buildUrlPrefixPolicy(prefix, expires, keyName);
      const signature = signPolicy(policy, keySecretB64url);

      const sep = u.search ? '&' : '?';
      const signed = `${u.toString()}${sep}${policy}&Signature=${signature}`;
      return signed;
    } else {
      // フル URL 署名（URL 全体に Expires/KeyName を付与し、その文字列を HMAC）
      const sep = u.search ? '&' : '?';
      const urlToSign = `${u.toString()}${sep}Expires=${expires}&KeyName=${keyName}`;
      const signature = signPolicy(urlToSign, keySecretB64url);
      const signed = `${urlToSign}&Signature=${signature}`;
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
   * @param urlPrefix - The URL prefix to protect (e.g., https://cdn.example.com/${env}/transcoded-video/dish_media/media_path/recordId/fileName/)
   * @returns Array of cookie strings ready for Set-Cookie headers
   */
  generateCdnSignedCookies(urlPrefix: string): string[] {
    try {
      // ---- normalize prefix -------------------------------------------------
      const u = new URL(urlPrefix);
      assertHttps(u, 'urlPrefix');
      const prefix = normalizePrefixFromUrl(u);
      const expires = makeExpires(env.CDN_SIGNED_COOKIE_TTL_SECONDS);
      const keyName = env.CDN_KEY_NAME;
      const keySecretB64url = env.CDN_KEY_SECRET_B64;

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

  /* ---------------------------------------------------------------------- */
  /*                          Copy to Public Bucket                         */
  /* ---------------------------------------------------------------------- */
  async copyToPublic(
    srcPath: string,
    destPath: string,
    copyOptions?: CopyOptions,
  ) {
    try {
      const srcBucket = this.bucket;
      const destBucket = this.storage.bucket(env.GCS_BUCKET_PUBLIC_NAME);

      const srcFile = srcBucket.file(srcPath);
      const destFile = destBucket.file(destPath);

      // GCS の copy API を利用
      await srcFile.copy(destFile, copyOptions);

      // 公開 URL を返すなど
      const publicUrl = `https://${env.CDN_PUBLIC_HOST}/${destPath}`;
      return { publicUrl };
    } catch (err) {
      this.logger.error('CopyToPublicError', 'copyToPublic', {
        error_message: (err as Error).message,
        srcPath,
        destPath,
        copyOptions,
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
