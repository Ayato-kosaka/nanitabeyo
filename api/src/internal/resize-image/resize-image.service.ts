// api/src/internal/resize-image/resize-image.service.ts
//
// Service for on-demand image resizing with Sharp
//

import { Injectable } from '@nestjs/common';
import * as sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../core/storage/storage.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { env } from '../../core/config/env';
import { ResizeImageParams, ResizeImageResult } from './resize-image.interface';

@Injectable()
export class ResizeImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * Build the resized image path based on naming convention
   * ${env}/resized-image/${table}/${column}/${recordId}/${size}.webp
   */
  private buildResizedPath(params: ResizeImageParams): string {
    return `${env.API_NODE_ENV}/resized-image/${params.table}/${params.column}/${params.recordId}/${params.size}.webp`;
  }

  /**
   * Get the original image path from database
   */
  private async getOriginalPath(
    table: string,
    column: string,
    recordId: string,
  ): Promise<string | null> {
    try {
      // For now, we only support dish_media table
      if (table !== 'dish_media') {
        throw new Error(`Unsupported table: ${table}`);
      }

      // Only allow specific columns for safety
      if (column !== 'media_path' && column !== 'thumbnail_path') {
        throw new Error(`Unsupported column: ${column}`);
      }

      const record = await this.prisma.prisma.dish_media.findUnique({
        where: { id: recordId },
        select: {
          media_path: column === 'media_path',
          thumbnail_path: column === 'thumbnail_path',
        },
      });

      if (!record) {
        this.logger.warn('OriginalPathNotFound', 'getOriginalPath', {
          table,
          column,
          recordId,
        });
        return null;
      }

      const path =
        column === 'media_path' ? record.media_path : record.thumbnail_path;

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
    params: ResizeImageParams,
  ): Promise<ResizeImageResult> {
    const resizedPath = this.buildResizedPath(params);

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

      // Get original image path
      const originalPath = await this.getOriginalPath(
        params.table,
        params.column,
        params.recordId,
      );
      if (!originalPath) {
        throw new Error('Original image path not found');
      }

      // Download original image
      const originalBuffer = await this.downloadOriginalImage(originalPath);

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
        originalPath,
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
