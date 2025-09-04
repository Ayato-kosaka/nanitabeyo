// api/src/v1/user-uploads/user-uploads.service.ts
//
// ❶ Service for user-uploads domain - signed URL generation
// ❷ Following the pattern from dish-media/dish-media.service.ts
// ❸ Handles GCS signed URL generation for user file uploads

import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../core/logger/logger.service';
import { StorageService } from '../../core/storage/storage.service';
import { env } from '../../core/config/env';
import {
  CreateUserUploadSignedUrlDto,
} from '@shared/v1/dto';
import {
  CreateUserUploadSignedUrlResponse,
} from '@shared/v1/res';

@Injectable()
export class UserUploadsService {
  constructor(
    private readonly storage: StorageService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*          POST /v1/user-uploads/signed-url (署名付きURL発行)         */
  /* ------------------------------------------------------------------ */
  async createSignedUrl(
    dto: CreateUserUploadSignedUrlDto,
    userId: string,
  ): Promise<CreateUserUploadSignedUrlResponse> {
    this.logger.debug('CreateSignedUrl', 'createSignedUrl', {
      contentType: dto.contentType,
      identifier: dto.identifier,
      userId,
    });

    // パス生成: system-generated/${contentType}/${Timestamp}_${identifier}
    const timestamp = Date.now();
    const sanitizedContentType = dto.contentType.replace(/[^a-zA-Z0-9]/g, '-');
    const sanitizedIdentifier = dto.identifier.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${timestamp}_${sanitizedIdentifier}`;
    
    // ファイル拡張子を推測
    const extension = this.getFileExtension(dto.contentType);
    const fullFileName = extension ? `${fileName}.${extension}` : fileName;
    
    const objectPath = `system-generated/${sanitizedContentType}/${fullFileName}`;

    try {
      // GCS 署名付き PUT URL を生成
      const result = await this.storage.generateSignedPutUrl(
        objectPath,
        dto.contentType,
        15 * 60, // 15分間有効
      );

      this.logger.debug('SignedUrlCreated', 'createSignedUrl', {
        objectPath: result.objectPath,
        expiresAt: result.expiresAt,
        userId,
      });

      return {
        putUrl: result.putUrl,
        objectPath: result.objectPath,
        expiresAt: result.expiresAt,
      };
    } catch (error) {
      this.logger.error('SignedUrlCreationFailed', 'createSignedUrl', {
        error: (error as Error).message,
        contentType: dto.contentType,
        identifier: dto.identifier,
        userId,
      });
      throw error;
    }
  }

  /**
   * Content-Type からファイル拡張子を推測
   */
  private getFileExtension(contentType: string): string {
    const extensionMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/x-msvideo': 'avi',
      'application/pdf': 'pdf',
      'text/plain': 'txt',
      'application/json': 'json',
    };

    return extensionMap[contentType.toLowerCase()] || '';
  }
}