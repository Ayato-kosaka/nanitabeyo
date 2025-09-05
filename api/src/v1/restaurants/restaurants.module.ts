// api/src/v1/restaurants/restaurants.module.ts
//
// ❶ Module for restaurants domain
// ❷ Following the pattern from dish-media/dish-media.module.ts
// ❸ Provides restaurant search, creation, and dish media queries

import { Module, forwardRef } from '@nestjs/common';
import { RestaurantsController } from './restaurants.controller';
import { RestaurantsService } from './restaurants.service';
import { RestaurantsRepository } from './restaurants.repository';
import { RestaurantsMapper } from './restaurants.mapper';

// ─── 横串インフラ層 ──────────────────────────────────────────
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { ExternalApiModule } from '../../core/external-api/external-api.module';
import { AuthModule } from '../../core/auth/auth.module';

@Module({
  imports: [
    PrismaModule, // DB アクセス
    LoggerModule, // アプリ共通 Logger
    ExternalApiModule, // Google Place API 呼び出し
    forwardRef(() => AuthModule), // 双方向依存を避けるため forwardRef
  ],
  controllers: [RestaurantsController],
  providers: [RestaurantsService, RestaurantsRepository, RestaurantsMapper],
  exports: [
    RestaurantsService, // 他ドメインから利用できるよう export
  ],
})
export class RestaurantsModule {}
