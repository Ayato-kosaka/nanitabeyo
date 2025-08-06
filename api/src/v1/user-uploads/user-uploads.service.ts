// api/src/v1/user-uploads/user-uploads.service.ts
//
// ❶ Controller から渡される DTO を受け取り Storage Service を編成
// ❂ GCS 署名付き URL 発行処理
// ❸ system-generated パスの生成ロジック
//

import { Injectable } from '@nestjs/common';
import { CreateUserUploadSignedUrlDto } from '@shared/v1/dto';
import { CreateUserUploadSignedUrlResponse } from '@shared/v1/res';

import { StorageService } from '../../core/storage/storage.service';
import { AppLoggerService } from '../../core/logger/logger.service';

@Injectable()
export class UserUploadsService {
  constructor(
    private readonly storage: StorageService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*               POST /v1/user-uploads/signed-url                     */
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

    // Generate object path following the pattern: system-generated/${contentType}/${Timestamp}_${identifier}
    const timestamp = Date.now();
    const objectPath = `system-generated/${dto.contentType}/${timestamp}_${dto.identifier}`;

    // Generate signed URL for upload (15 minutes expiration)
    const result = await this.storage.generateSignedUrlForUpload(
      objectPath,
      dto.contentType,
      15 * 60, // 15 minutes
    );

    this.logger.log('SignedUrlCreated', 'createSignedUrl', {
      objectPath: result.objectPath,
      userId,
      expiresAt: result.expiresAt,
    });

    return {
      putUrl: result.putUrl,
      objectPath: result.objectPath,
      expiresAt: result.expiresAt,
    };
  }
}