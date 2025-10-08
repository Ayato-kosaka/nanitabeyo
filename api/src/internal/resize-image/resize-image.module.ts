// api/src/internal/resize-image/resize-image.module.ts
//
// Module for resize-image functionality
//

import { Module } from '@nestjs/common';
import { ResizeImageController } from './resize-image.controller';
import { ResizeImageService } from './resize-image.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CoreModule } from '../../core/core.module';

@Module({
  imports: [PrismaModule, CoreModule],
  controllers: [ResizeImageController],
  providers: [ResizeImageService],
  exports: [ResizeImageService],
})
export class ResizeImageModule {}
