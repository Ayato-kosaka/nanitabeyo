// api/src/v1/dishes/dishes.module.ts
//
// ❶ "最小構成で早く動かす" + ❷ "あとから機能を足しても破綻しない"
//    ────────────────────────────────────────────────
// - Controller / Service / Repository を DI で結線
// - 共通横串（Prisma, Logger, Auth）と Google Maps サービスを imports に集約
// - Service を外部の Module から再利用しやすいよう `exports:` で公開
//

import { Module, forwardRef } from '@nestjs/common';
import { DishesController } from './dishes.controller';
import { DishesService } from './dishes.service';
import { DishesRepository } from './dishes.repository';

// ─── 横串インフラ層 ──────────────────────────────────────────
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module'; // JWT Guard / CurrentUser デコレータ
import { StorageModule } from 'src/core/storage/storage.module';
import { LocationsModule } from '../locations/locations.module'; // Google Places API 連携
import { RemoteConfigModule } from '../../core/remote-config/remote-config.module';

@Module({
  imports: [
    PrismaModule, // DB アクセス
    LoggerModule, // アプリ共通 Logger
    StorageModule, // 画像アップロードなどのストレージサービス
    forwardRef(() => AuthModule), // 双方向依存を避けるため forwardRef
    LocationsModule, // Google Places API 連携
    RemoteConfigModule, // Remote Config サービス
  ],
  controllers: [DishesController],
  providers: [DishesService, DishesRepository],
  exports: [
    DishesService, // 他ドメインが再利用できる
  ],
})
export class DishesModule {}
