// api/src/internal/resize-image/resize-image.service.ts
//
// Service for on-demand image resizing with Sharp
//

import { Injectable } from '@nestjs/common';
import * as sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../core/storage/storage.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { ResizeImageResult } from './resize-image.interface';
import { buildResizedPath } from 'src/core/storage/storage.utils';
import { ResizeImageDto } from './resize-image.dto';

// 識別子の簡易バリデーション（必要に応じて厳しく）
function isSafeIdentifier(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

// Postgres の識別子クオート（" を "" にエスケープして二重引用符で囲む）
function quoteIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

@Injectable()
export class ResizeImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly logger: AppLoggerService,
  ) { }

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
   */
  private async downloadOriginalImage(path: string): Promise<Buffer> {
    try {
      // Generate signed URL for download
      const signedUrl = await this.storage.generateSignedUrl(path);

      // Download the image
      const response = await fetch(signedUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to download image: ${response.status} ${response.statusText}`,
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      this.logger.error('DownloadOriginalImageError', 'downloadOriginalImage', {
        path,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Resize image using Sharp with 9:16 aspect ratio
   */
  private async resizeImage(buffer: Buffer, size: number): Promise<Buffer> {
    try {
      // Calculate height for 9:16 aspect ratio
      const width = size;
      const height = Math.round((size * 16) / 9);

      const resized = await sharp(buffer)
        .resize(width, height, {
          fit: 'cover',
          position: 'attention',
        })
        .webp({ quality: 85 })
        .toBuffer();

      this.logger.debug('ImageResized', 'resizeImage', {
        originalSize: buffer.length,
        resizedSize: resized.length,
        targetWidth: width,
        targetHeight: height,
      });

      return resized;
    } catch (error) {
      this.logger.error('ResizeImageError', 'resizeImage', {
        size,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
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

        // Generate signed URL for existing resized image
        const signedUrl = await this.storage.generateSignedUrl(resizedPath);

        return {
          path: resizedPath,
          signedUrl,
          alreadyExisted: true,
        };
      }

      // Download original image
      const originalBuffer = await this.downloadOriginalImage(params.originalPath);

      // Resize image
      const resizedBuffer = await this.resizeImage(originalBuffer, params.size);

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
      this.logger.error('ResizeAndStoreImageError', 'resizeAndStoreImage', {
        params,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
