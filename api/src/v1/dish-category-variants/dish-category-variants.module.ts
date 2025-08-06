// api/src/v1/dish-category-variants/dish-category-variants.module.ts
//
// Module for dish category variants
// Following the pattern from dish-media/dish-media.module.ts
//

import { Module, forwardRef } from '@nestjs/common';
import { DishCategoryVariantsController } from './dish-category-variants.controller';
import { DishCategoryVariantsService } from './dish-category-variants.service';
import { DishCategoryVariantsRepository } from './dish-category-variants.repository';

// ─── 横串インフラ層 ──────────────────────────────────────────
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module';
import { ExternalApiModule } from '../../core/external-api/external-api.module';

@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    ExternalApiModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [DishCategoryVariantsController],
  providers: [DishCategoryVariantsService, DishCategoryVariantsRepository],
  exports: [DishCategoryVariantsService],
})
export class DishCategoryVariantsModule {}
