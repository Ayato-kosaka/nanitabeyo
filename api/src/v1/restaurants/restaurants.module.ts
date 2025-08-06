// api/src/v1/restaurants/restaurants.module.ts
//
// ❶ "最小構成で早く動かす" + ❂ "あとから機能を足しても破綻しない"
//    ────────────────────────────────────────────────
// - Controller / Service / Repository を DI で結線
// - 共通横串（Prisma, Logger, Storage, Auth）を imports に集約
// - Service を外部の Module から再利用しやすいよう `exports:` で公開
//

import { Module, forwardRef } from '@nestjs/common';
import { RestaurantsController } from './restaurants.controller';
import { RestaurantsService } from './restaurants.service';
import { RestaurantsRepository } from './restaurants.repository';
import { RestaurantsMapper } from './restaurants.mapper';

// ─── 横串インフラ層 ──────────────────────────────────────────
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module'; // JWT Guard / CurrentUser デコレータ
import { ExternalApiModule } from '../../core/external-api/external-api.module'; // Google Places API

@Module({
  imports: [
    PrismaModule, // DB アクセス（@Global でも明示的 import が可読性↑）
    LoggerModule, // アプリ共通 Logger
    ExternalApiModule, // Google Places API / Payment API
    forwardRef(() => AuthModule), // 双方向依存を避けるため forwardRef
  ],
  controllers: [RestaurantsController],
  providers: [
    RestaurantsService,
    RestaurantsRepository, // ← ここで DI できるので Service から注入可能
    RestaurantsMapper, // ← データ変換用
  ],
  exports: [
    RestaurantsService, // 他ドメインが "レストラン検索" 等で再利用できる
  ],
})
export class RestaurantsModule {}