// api/src/ops/resize-image/ops-resize-image.module.ts
//
// Module for operational resize-image actions
// #514 【設計】運用操作 - 失敗したリサイズジョブの再実行
//

import { Module, forwardRef } from '@nestjs/common';
import { OpsResizeImageController } from './ops-resize-image.controller';
import { OpsResizeImageService } from './ops-resize-image.service';

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
  controllers: [OpsResizeImageController],
  providers: [OpsResizeImageService],
  exports: [OpsResizeImageService],
})
export class OpsResizeImageModule {}
