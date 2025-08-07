// api/src/v1/user-uploads/user-uploads.service.ts
//
// ❶ GCS 署名付き URL 発行サービス
// ❷ system-generated/${contentType}/${Timestamp}_${identifier} のパス生成
//

import { Injectable } from '@nestjs/common';
import { CreateUserUploadSignedUrlDto } from '@shared/v1/dto';
import { StorageService } from '../../core/storage/storage.service';
import { AppLoggerService } from '../../core/logger/logger.service';

@Injectable()
export class UserUploadsService {
  constructor(
    private readonly storage: StorageService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*             POST /v1/user-uploads/signed-url                       */
  /* ------------------------------------------------------------------ */
  async createSignedUrl(dto: CreateUserUploadSignedUrlDto, userId: string) {
    this.logger.debug('CreateSignedUrl', 'createSignedUrl', {
      contentType: dto.contentType,
      identifier: dto.identifier,
      userId,
    });

    // パス生成: system-generated/${contentType}/${Timestamp}_${identifier}
    const timestamp = Date.now();
    const objectPath = `system-generated/${dto.contentType}/${timestamp}_${dto.identifier}`;

    // 15分間有効な署名付きURL生成
    const expiresInSeconds = 15 * 60; // 15 minutes
    const putUrl = await this.storage.generateSignedUrlForUpload(
      objectPath,
      expiresInSeconds,
    );
    const expiresAt = new Date(
      Date.now() + expiresInSeconds * 1000,
    ).toISOString();

    this.logger.log('SignedUrlCreated', 'createSignedUrl', {
      objectPath,
      expiresAt,
      userId,
    });

    return {
      putUrl,
      objectPath,
      expiresAt,
    };
  }
}
