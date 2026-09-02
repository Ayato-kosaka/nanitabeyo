// api/src/internal/resize-image/resize-image.service.ts
//
// Service for on-demand image resizing with Sharp
//

import { Injectable } from '@nestjs/common';
import * as sharp from 'sharp';
import { Jimp, JimpMime } from 'jimp';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../core/storage/storage.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { ResizeImageResult } from './resize-image.interface';
import { buildResizedPath } from 'src/core/storage/storage.utils';
import { ResizeImageDto } from './resize-image.dto';
import { MediaProcessingStatus } from '@shared/v1/res';

// 識別子の簡易バリデーション（必要に応じて厳しく）
function isSafeIdentifier(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

// Postgres の識別子クオート（" を "" にエスケープして二重引用符で囲む）
function quoteIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * 恒久的に処理できない画像エラーを表すカスタムエラークラス
 *
 * #514 【バグ】Cloud Tasks は 2xx を成功、それ以外をリトライ対象として扱う。
 * このエラーはリトライしても決して成功しないため、Controller で捕捉して
 * 204 を返し、キューから確実に取り除く（ログには残す）。
 */
export class PermanentImageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PermanentImageError';
  }
}

/**
 * 原本のダウンロードで「恒久失敗」と判定する HTTP ステータス。
 *
 * #514 原本が存在しないことを直接示すものだけを入れる。
 * - 404 Not Found: 原本が消えている（本番ログで実際に無限リトライを起こしていたのはこれ）
 * - 410 Gone: 原本が意図的に削除された
 *
 * ⚠️ ここへ他の 4xx（403 / 408 / 425 / 429 など）を足さないこと。
 * それらはリトライで成功しうるため、恒久扱いにすると画像が永久にリサイズされない。
 */
const PERMANENT_DOWNLOAD_STATUSES = new Set([404, 410]);

/**
 * #1425 【バグ】libvips が「そのフォーマットのデコーダを積んでいない」と言っているかを判定する。
 *
 * 本番で観測した実物（HEIC のアップロード）:
 *
 *   source: bad seek to 565836
 *   ...
 *   heif: Error while loading plugin: Support for this compression format has not been built in (11.6003)
 *
 * 先頭の `source: bad seek to` は**症状で、原因ではない**。真因は末尾の一行で、
 * sharp の同梱 libvips が HEVC 特許の都合で HEIF デコーダを含まないこと。
 *
 * ⚠️ **`heif:` だけでマッチさせないこと。** ここは «ジョブをキューから消す側» の判定なので、
 * 広く取ると本来リトライで救えるものまで恒久失敗にしてしまう。将来 HEIF 対応を積んだあとに出る
 * 別種の heif エラー（メモリ・I/O 起因など）を巻き込まないよう、
 * 「デコーダが組み込まれていない」という文言まで含めて**狭く**判定する。
 */
function isUnsupportedImageFormatError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message
    .toLowerCase()
    .includes('support for this compression format has not been built in');
}

/**
 * JPEGデコードエラーが再エンコードで救済可能かを判定
 * @param error エラーオブジェクト
 * @returns 再エンコードを試す対象ならtrue
 */
function isRecoverableJpegDecodeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  // #423 【バグ】libvipsのJPEGデコードエラーパターンを検出
  const patterns = [
    'invalid sos parameters for sequential jpeg',
    'vipsjpeg:',
    'jpeg',
  ];

  return patterns.some((pattern) => message.includes(pattern));
}

/**
 * Jimpを使用してJPEGを再エンコード
 * @param buffer 元の画像バッファ
 * @returns 再エンコード済みJPEGバッファ
 */
async function reencodeWithJimp(buffer: Buffer): Promise<Buffer> {
  const image = await Jimp.read(buffer);
  // #423 【設計】Jimp で JPEG に再エンコードして libvips が読める形式に正規化
  return await image.getBuffer(JimpMime.jpeg, { quality: 95 });
}

@Injectable()
export class ResizeImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * Get the original image path from database
   */
  private async getOriginalPath(
    table: string,
    column: string,
    recordId: string,
  ): Promise<string | null> {
    try {
      // まず識別子をチェック
      if (!isSafeIdentifier(table) || !isSafeIdentifier(column)) {
        throw new Error('Invalid table or column name');
      }

      const path = await this.prisma.withTransaction(async (tx) => {
        // information_schema で実在チェック（Postgres）
        const existsRes = await tx.$queryRaw<
          Array<{ exists: boolean }>
        >`SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE 1=1
            AND table_name = ${table}
            AND column_name = ${column}
        ) AS exists`;

        if (!existsRes?.[0]?.exists) {
          throw new Error(`Unknown table/column: ${table}.${column}`);
        }

        // 識別子はクオートして Unsafe で実行、値はプレースホルダで安全に渡す
        const sql = `
        SELECT ${quoteIdent(column)} AS value
        FROM ${quoteIdent(table)}
        WHERE id = $1::uuid
        LIMIT 1
      `;

        const rows = await tx.$queryRawUnsafe<Array<{ value: string }>>(
          sql,
          recordId,
        );

        if (!rows || rows.length === 0) return null;
        return rows[0]?.value ?? null;
      });

      if (!path) {
        this.logger.warn('OriginalPathEmpty', 'getOriginalPath', {
          table,
          column,
          recordId,
        });
        return null;
      }

      return path;
    } catch (error) {
      this.logger.error('GetOriginalPathError', 'getOriginalPath', {
        table,
        column,
        recordId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Download original image from GCS
   *
   * #514 【バグ】原本が存在しない（404 / 410）場合はリトライしても決して成功しないため
   * 恒久失敗として扱う。それ以外（5xx・ネットワークエラー・その他の 4xx）は
   * 従来どおりリトライさせる。
   */
  private async downloadOriginalImage(path: string): Promise<Buffer> {
    try {
      // Generate signed URL for download
      const signedUrl = await this.storage.generateSignedUrl(path);

      // Download the image
      const response = await fetch(signedUrl);
      if (!response.ok) {
        const message = `Failed to download image: ${response.status} ${response.statusText}`;

        // #514 【バグ】原本が存在しないことが確定した場合だけリトライループを止める。
        //
        // ⚠️ ここを「4xx なら恒久失敗」へ広げないこと（レビュー指摘）。
        // 署名付き URL は **試行のたびに新しく発行する**ため、次の 4xx はいずれも
        // リトライで成功しうる。恒久扱いにすると controller が 204 を返して
        // Cloud Tasks からジョブが消え、リサイズされない画像がそのまま残る。
        //   - 403: 署名の期限切れ・クロックスキュー（ExpiredToken / SignatureDoesNotMatch）
        //   - 408 / 425: 一時的なタイムアウト
        //   - 429: レート制限
        // #514 の本番ログで実際に無限リトライを起こしていたのは 404 なので、
        // 恒久扱いは「原本が無い」ことを直接示す 404 / 410 に限定する。
        if (PERMANENT_DOWNLOAD_STATUSES.has(response.status)) {
          this.logger.error(
            'DownloadOriginalImagePermanentFailure',
            'downloadOriginalImage',
            {
              path,
              status: response.status,
              statusText: response.statusText,
            },
          );

          throw new PermanentImageError(message, 'ORIGINAL_IMAGE_NOT_FOUND', {
            path,
            status: response.status,
          });
        }

        throw new Error(message);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      // 恒久失敗は上で専用イベントを出力済み。ここで一時失敗用のイベントを
      // 重ねると恒久／一時の区別がログから失われるため通す。
      if (error instanceof PermanentImageError) {
        throw error;
      }

      this.logger.error('DownloadOriginalImageError', 'downloadOriginalImage', {
        path,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * 画像をリサイズしてWebPに変換
   * JPEGデコードエラー時はJimpで再エンコードして再試行
   */
  private async resizeImage(
    buffer: Buffer,
    width: number,
    option?: {
      aspectRatio?: number;
    },
  ): Promise<Buffer> {
    try {
      // #423 【設計】まずは通常通りsharpでリサイズを試行
      return await this.performResize(buffer, width, option);
    } catch (error) {
      // #1425 【バグ】デコーダが無い形式（HEIC 等）はリトライしても結果が変わらない。
      //
      // 原本は GCS 上の不変ファイルなので、何度読み直しても同じバイナリ・同じ結果になる。
      // ここで恒久失敗と宣言しないと Cloud Tasks が上限まで再試行し、1 枚の画像で
      // Cloud Run の起動と error ログを 8 回ずつ（media_path と thumbnail_path で計 16 件）
      // 無駄に積む。本番で実際にそうなっていた。
      //
      // ⚠️ **JPEG の再エンコード分岐より前に置くこと。** 後ろに置くと Jimp（HEIC を読めない）を
      // 一度通すことになり、無駄な再エンコード試行とログが 1 段増えるだけになる。
      if (isUnsupportedImageFormatError(error)) {
        this.logger.error('ResizeImageUnsupportedFormat', 'resizeImage', {
          size: width,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        throw new PermanentImageError(
          'Unsupported image format (decoder not built in)',
          'UNSUPPORTED_IMAGE_FORMAT',
          {
            originalError: error instanceof Error ? error.message : 'Unknown',
          },
        );
      }

      // #423 【バグ】JPEGデコードエラーの場合、Jimpで再エンコードして再試行
      if (isRecoverableJpegDecodeError(error)) {
        this.logger.warn('ResizeImageDecodeError', 'resizeImage', {
          size: width,
          error: error instanceof Error ? error.message : 'Unknown error',
          attemptingReencode: true,
        });

        try {
          // Jimpで再エンコード
          const reencodedBuffer = await reencodeWithJimp(buffer);

          this.logger.log('ImageReencoded', 'resizeImage', {
            originalSize: buffer.length,
            reencodedSize: reencodedBuffer.length,
          });

          // 再エンコード済みバッファで再度リサイズ
          const result = await this.performResize(
            reencodedBuffer,
            width,
            option,
          );

          this.logger.log('ResizeImageCompletedAfterReencode', 'resizeImage', {
            size: width,
          });

          return result;
        } catch (reencodeError) {
          // #423 【設計】再エンコードでも失敗した場合は恒久エラー
          this.logger.error('ImageRepairFailed', 'resizeImage', {
            size: width,
            originalError: error instanceof Error ? error.message : 'Unknown',
            reencodeError:
              reencodeError instanceof Error
                ? reencodeError.message
                : 'Unknown',
          });

          throw new PermanentImageError(
            'Failed to resize image even after re-encoding',
            'RESIZE_PERMANENT_FAILURE',
            {
              originalError: error instanceof Error ? error.message : 'Unknown',
              reencodeError:
                reencodeError instanceof Error
                  ? reencodeError.message
                  : 'Unknown',
            },
          );
        }
      }

      // 再エンコード対象外のエラーはそのまま伝播
      this.logger.error('ResizeImageError', 'resizeImage', {
        size: width,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Sharpを使用して実際のリサイズ処理を実行
   */
  private async performResize(
    buffer: Buffer,
    width: number,
    option?: {
      aspectRatio?: number;
    },
  ): Promise<Buffer> {
    let height: number | undefined = undefined;
    let fit: keyof sharp.FitEnum = 'inside'; // デフォルトはトリミングなし

    if (option?.aspectRatio) {
      height = Math.round(width / option.aspectRatio);
      fit = 'cover'; // 縦横比を守りつつ埋める、必要ならトリミング
    }

    // #514 【バグ】failOn: 'none' で libvips の警告レベルの破損を致命扱いしない。
    // 本番で最多の "Corrupt JPEG data: N extraneous bytes before marker 0xc4" /
    // "Invalid SOS parameters for sequential JPEG" は、これで読み切れる。
    // 画像として解釈できない入力（マジックバイト不正など）は引き続き失敗するため、
    // 恒久失敗の検知能力は落ちない。
    // 【バグ】EXIF Orientation を正規化して縦長画像の横回転を防止
    const resized = await sharp(buffer, { failOn: 'none' })
      .rotate() // EXIF Orientation を適用して正規化
      .resize(width, height, {
        fit,
        position: 'center',
      })
      .webp({ quality: 85 })
      .toBuffer();

    this.logger.debug('ImageResized', 'performResize', {
      originalSize: buffer.length,
      resizedSize: resized.length,
      targetWidth: width,
      targetHeight: height,
    });

    return resized;
  }

  /**
   * #511 【設計】dish_media テーブルの processing_status を更新
   *
   * #1599 【バグ】**既にそのステータスなら 1 行も書かない。**
   *
   * Cloud Tasks は at-least-once 配送で、ハンドラが成功しても応答が届かなければ
   * 再実行される。`resizeAndStoreImage` は再実行されると
   * 「リサイズ済みが既にある」経路（`alreadyExisted`）へ入り、そこから
   * **同じ status で**ここへ来る。以前は無条件 UPDATE だったので、再配送のたびに
   *
   *   - `lock_no` が 1 つ進む
   *   - `updated_at` が «何も変わっていないのに» 現在時刻へ動く
   *   - 行の新しいバージョンが書かれる（WAL・VACUUM 対象が増える）
   *
   * が起きていた。`updated_at` は «最後に中身が変わった時刻» として読める必要があり、
   * 再配送の回数で動く値になっていると、後からログと突き合わせられない。
   *
   * 判定は `WHERE <statusColumn> <> :status` で **DB 側に 1 文で持たせる**。
   * 「読んでから比べて書く」にすると、その隙間に別のタスクが書き込める。
   *
   * ⚠️ `update` ではなく `updateMany` なのは、条件に一致しないことを
   * «例外» ではなく «0 行» で受け取るためである（`update` は P2025 を投げる）。
   * そのぶん «行が無い» と «既にそのステータス» が区別できなくなるので、
   * 0 行のときは両方を疑えるログを残す。
   *
   * @param recordId dish_media レコードの ID
   * @param column 対象カラム（media_path / thumbnail_path）
   * @param status 更新後のステータス
   */
  private async updateDishMediaProcessingStatus(
    recordId: string,
    column: string,
    status: MediaProcessingStatus,
  ): Promise<void> {
    const statusColumn =
      column === 'media_path'
        ? 'media_processing_status'
        : 'thumbnail_processing_status';

    try {
      const { count } = await this.prisma.prisma.dish_media.updateMany({
        where: { id: recordId, NOT: { [statusColumn]: status } },
        data: {
          [statusColumn]: status,
          updated_at: new Date(),
          lock_no: { increment: 1 },
        },
      });

      if (count === 0) {
        this.logger.log(
          'DishMediaProcessingStatusUnchanged',
          'updateDishMediaProcessingStatus',
          {
            recordId,
            statusColumn,
            status,
            reason: 'already_in_status_or_record_missing',
          },
        );
        return;
      }

      this.logger.log(
        'DishMediaProcessingStatusUpdated',
        'updateDishMediaProcessingStatus',
        {
          recordId,
          statusColumn,
          status,
        },
      );
    } catch (error) {
      this.logger.error(
        'UpdateDishMediaProcessingStatusError',
        'updateDishMediaProcessingStatus',
        {
          recordId,
          statusColumn,
          status,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
      // ステータス更新失敗はリサイズ処理自体の失敗とは別扱い（ログのみ）
    }
  }

  /**
   * Main method to resize and store image
   */
  async resizeAndStoreImage(
    params: ResizeImageDto,
  ): Promise<ResizeImageResult> {
    const resizedPath = buildResizedPath(params);

    this.logger.debug('ResizeImageStarted', 'resizeAndStoreImage', {
      ...params,
      resizedPath,
    });

    try {
      // Check if resized image already exists (idempotency)
      const exists = await this.storage.fileExists(resizedPath);

      if (exists) {
        this.logger.debug('ResizedImageAlreadyExists', 'resizeAndStoreImage', {
          resizedPath,
        });

        // #511 【設計】dish_media テーブルの場合はステータスを completed に更新
        if (params.table === 'dish_media') {
          await this.updateDishMediaProcessingStatus(
            params.recordId,
            params.column,
            'completed',
          );
        }

        // Generate signed URL for existing resized image
        const signedUrl = await this.storage.generateSignedUrl(resizedPath);

        return {
          path: resizedPath,
          signedUrl,
          alreadyExisted: true,
        };
      }

      // Download original image
      const originalBuffer = await this.downloadOriginalImage(
        params.originalPath,
      );

      // Resize image
      const resizedBuffer = await this.resizeImage(
        originalBuffer,
        params.size,
        {
          aspectRatio: params.aspectRatio,
        },
      );

      // Upload resized image with cache headers
      const result = await this.storage.uploadFileAtPath({
        buffer: resizedBuffer,
        mimeType: 'image/webp',
        fullPath: resizedPath,
        overwriteIfExists: false,
        metadata: {
          cacheControl: 'public, max-age=31536000, immutable',
          table: params.table,
          column: params.column,
          recordId: params.recordId,
          size: params.size.toString(),
        },
      });

      // #511 【設計】dish_media テーブルの場合はステータスを completed に更新
      if (params.table === 'dish_media') {
        await this.updateDishMediaProcessingStatus(
          params.recordId,
          params.column,
          'completed',
        );
      }

      this.logger.log('ResizeImageCompleted', 'resizeAndStoreImage', {
        resizedPath: result.path,
        size: params.size,
      });

      return {
        path: result.path,
        signedUrl: result.signedUrl,
        alreadyExisted: false,
      };
    } catch (error) {
      // #511 【設計】dish_media テーブルの場合はステータスを failed に更新
      if (params.table === 'dish_media') {
        await this.updateDishMediaProcessingStatus(
          params.recordId,
          params.column,
          'failed',
        );
      }

      // #423 【設計】恒久エラーも含めすべてのエラーをログに記録
      if (error instanceof PermanentImageError) {
        this.logger.error(
          'ResizeAndStoreImagePermanentFailure',
          'resizeAndStoreImage',
          {
            params,
            code: error.code,
            details: error.details,
            message: error.message,
          },
        );
      } else {
        this.logger.error('ResizeAndStoreImageError', 'resizeAndStoreImage', {
          params,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      // #423 【設計】すべてのエラーを上位に伝播（Controller で5xx返却）
      throw error;
    }
  }
}
