// api/src/tools/resize-image/tools-resize-image.module.ts
//
// Module for tools resize-image
// #514 【設計】運営用ツール - 失敗したリサイズジョブの再実行
//

import { Module, forwardRef } from '@nestjs/common';
import { ToolsResizeImageController } from './tools-resize-image.controller';
import { ToolsResizeImageService } from './tools-resize-image.service';

// 横串インフラ層
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module';
import { CloudTasksModule } from '../../core/cloud-tasks/cloud-tasks.module';

@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    CloudTasksModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [ToolsResizeImageController],
  providers: [ToolsResizeImageService],
  exports: [ToolsResizeImageService],
})
export class ToolsResizeImageModule {}
