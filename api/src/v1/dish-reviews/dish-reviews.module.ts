// api/src/v1/dish-reviews/dish-reviews.module.ts
//
// Module for dish reviews
// Following the dish-media module pattern

import { Module, forwardRef } from '@nestjs/common';
import { DishReviewsController } from './dish-reviews.controller';
import { DishReviewsService } from './dish-reviews.service';
import { DishReviewsRepository } from './dish-reviews.repository';

// Core modules
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module';

@Module({
  imports: [
    PrismaModule, // DB access
    LoggerModule, // App logger
    forwardRef(() => AuthModule), // JWT Guard / CurrentUser decorator
  ],
  controllers: [DishReviewsController],
  providers: [
    DishReviewsService,
    DishReviewsRepository,
  ],
  exports: [
    DishReviewsService, // Export for potential reuse by other modules
  ],
})
export class DishReviewsModule {}