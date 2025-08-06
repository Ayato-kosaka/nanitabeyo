// api/src/v1/dish-categories/dish-categories.module.ts
//
// Module for dish categories
// Following the pattern from dish-media/dish-media.module.ts
//

import { Module, forwardRef } from '@nestjs/common';
import { DishCategoriesController } from './dish-categories.controller';
import { DishCategoriesService } from './dish-categories.service';
import { DishCategoriesRepository } from './dish-categories.repository';

// ─── 横串インフラ層 ──────────────────────────────────────────
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module';
import { ClaudeModule } from '../../core/claude/claude.module';

@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    ClaudeModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [DishCategoriesController],
  providers: [
    DishCategoriesService,
    DishCategoriesRepository,
  ],
  exports: [
    DishCategoriesService,
  ],
})
export class DishCategoriesModule {}