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
import { ResizeImageService } from './resize-image.service';
import { OIDCGuard } from '../dishes/oidc.guard';
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
   */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async resizeImage(@Body() dto: ResizeImageDto): Promise<void> {
    this.logger.debug('ResizeImageRequestReceived', 'resizeImage', {
      table: dto.table,
      column: dto.column,
      recordId: dto.recordId,
      size: dto.size,
    });

    try {
      await this.resizeImageService.resizeAndStoreImage({
        table: dto.table,
        column: dto.column,
        recordId: dto.recordId,
        size: dto.size,
      });

      this.logger.log('ResizeImageRequestCompleted', 'resizeImage', {
        table: dto.table,
        recordId: dto.recordId,
        size: dto.size,
      });
    } catch (error) {
      this.logger.error('ResizeImageRequestError', 'resizeImage', {
        table: dto.table,
        recordId: dto.recordId,
        size: dto.size,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
