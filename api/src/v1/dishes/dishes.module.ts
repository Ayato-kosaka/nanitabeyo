// api/src/v1/dishes/dishes.module.ts
//
// Module for dishes

import { Module, forwardRef } from '@nestjs/common';
import { DishesController } from './dishes.controller';
import { DishesService } from './dishes.service';
import { DishesRepository } from './dishes.repository';

// Core modules
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module';
import { ExternalApiModule } from '../../core/external-api/external-api.module';

@Module({
  imports: [
    PrismaModule, // DB access
    LoggerModule, // App logger
    forwardRef(() => AuthModule), // JWT Guard
    ExternalApiModule, // Google APIs
  ],
  controllers: [DishesController],
  providers: [
    DishesService,
    DishesRepository,
  ],
  exports: [
    DishesService, // Export for potential reuse by other modules
  ],
})
export class DishesModule {}