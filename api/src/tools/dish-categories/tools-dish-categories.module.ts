// api/src/tools/dish-categories/tools-dish-categories.module.ts
//
// Module for tools dish categories
// #494 【設計】運営用ツール - dish_categories画像最適化
//

import { Module, forwardRef } from '@nestjs/common';
import { ToolsDishCategoriesController } from './tools-dish-categories.controller';
import { ToolsDishCategoriesService } from './tools-dish-categories.service';
import { ToolsDishCategoriesRepository } from './tools-dish-categories.repository';

// 横串インフラ層
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module';
import { StorageModule } from '../../core/storage/storage.module';

@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    StorageModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [ToolsDishCategoriesController],
  providers: [ToolsDishCategoriesService, ToolsDishCategoriesRepository],
  exports: [ToolsDishCategoriesService],
})
export class ToolsDishCategoriesModule {}
