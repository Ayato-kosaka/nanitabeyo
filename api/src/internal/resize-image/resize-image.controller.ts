// api/src/internal/resize-image/resize-image.controller.ts
//
// Controller for on-demand image resizing
// Handles POST /internal/resize-image endpoint
//

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ResizeImageDto } from './resize-image.dto';
import {
  ResizeImageService,
  PermanentImageError,
} from './resize-image.service';
import { OIDCGuard } from '../oidc.guard';
import { AppLoggerService } from '../../core/logger/logger.service';

/**
 * Internal resize-image endpoint
 * Protected by OIDC guard for Cloud Tasks authentication
 */
@Controller('internal/resize-image')
@UseGuards(OIDCGuard)
export class ResizeImageController {
  constructor(
    private readonly resizeImageService: ResizeImageService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * POST /internal/resize-image
   *
   * Resize image on-demand and store in GCS
   *
   * #514 【バグ】Cloud Tasks は 2xx を成功、それ以外をリトライ対象として扱う。
   * 恒久失敗（原本が 404 / 再エンコードしても読めない）は何度試しても成功しないので
   * 204 で終端させ、リトライによる無駄な Cloud Run 起動を止める。
   * 一時的なエラーは従来どおり throw して 5xx を返し、リトライさせる。
   */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async resizeImage(@Body() dto: ResizeImageDto): Promise<void> {
    try {
      await this.resizeImageService.resizeAndStoreImage(dto);
    } catch (error) {
      if (error instanceof PermanentImageError) {
        this.logger.warn(
          'ResizeImagePermanentFailureAcknowledged',
          'resizeImage',
          {
            params: dto,
            code: error.code,
            message: error.message,
            details: error.details,
          },
        );
        return;
      }
      throw error;
    }
  }
}
