// api/src/v1/locations/locations.module.ts
//
// ❶ "最小構成で早く動かす" + ❷ "あとから機能を足しても破綻しない"
//    ────────────────────────────────────────────────
// - Controller / Service を DI で結線
// - 共通横串（Logger, Auth）を imports に集約
// - Service を外部の Module から再利用しやすいよう `exports:` で公開
//

import { Module, forwardRef } from '@nestjs/common';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

// ─── 横串インフラ層 ──────────────────────────────────────────
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module'; // JWT Guard
import { ExternalApiModule } from 'src/core/external-api/external-api.module';

@Module({
  imports: [
    LoggerModule, // アプリ共通 Logger
    ExternalApiModule,
    forwardRef(() => AuthModule), // 双方向依存を避けるため forwardRef
  ],
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [
    LocationsService, // 他ドメインが再利用できる
  ],
})
export class LocationsModule { }
