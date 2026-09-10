// api/src/v1/restaurants/restaurants.module.ts
//
// ❶ Module for restaurants domain
// ❷ Following the pattern from dish-media/dish-media.module.ts
// ❸ Provides restaurant search, creation, and dish media queries

import { Module, forwardRef } from '@nestjs/common';
import { RestaurantsController } from './restaurants.controller';
import { RestaurantsService } from './restaurants.service';
import { RestaurantsRepository } from './restaurants.repository';

// ─── 横串インフラ層 ──────────────────────────────────────────
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { ExternalApiModule } from '../../core/external-api/external-api.module';
import { AuthModule } from '../../core/auth/auth.module';
import { DishesModule } from '../dishes/dishes.module';
import { DishMediaModule } from '../dish-media/dish-media.module';
import { LocationsModule } from '../locations/locations.module';
import { StorageModule } from 'src/core/storage/storage.module';
import { RestaurantsAssembler } from './restaurants.assembler';

@Module({
  imports: [
    PrismaModule, // DB アクセス
    LoggerModule, // アプリ共通 Logger
    ExternalApiModule, // Google Place API 呼び出し
    LocationsModule, // LocationsService を利用するため
    StorageModule, // RestaurantsAssembler が StorageService を利用するため
    forwardRef(() => AuthModule), // 双方向依存を避けるため forwardRef
    forwardRef(() => DishesModule), // DishesRepository を利用するため
    forwardRef(() => DishMediaModule), // DishMediaService を利用するため
  ],
  controllers: [RestaurantsController],
  providers: [RestaurantsService, RestaurantsRepository, RestaurantsAssembler],
  exports: [
    RestaurantsService, // 他ドメインから利用できるよう export
    RestaurantsRepository,
    RestaurantsAssembler,
  ],
})
export class RestaurantsModule {}
