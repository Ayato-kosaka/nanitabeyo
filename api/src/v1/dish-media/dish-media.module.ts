// api/src/modules/dish-media/dish-media.module.ts
//
// ❶ “最小構成で早く動かす” + ❷ “あとから機能を足しても破綻しない”
//    ────────────────────────────────────────────────
// - Controller / Service / Repository を DI で結線
// - 共通横串（Prisma, Logger, Storage, Auth）を imports に集約
// - Service を外部の Module から再利用しやすいよう `exports:` で公開
//

import { Module, forwardRef } from '@nestjs/common';
import { DishMediaController } from './dish-media.controller';
import { DishMediaService } from './dish-media.service';
import { DishMediaRepository } from './dish-media.repository';

// ─── 横串インフラ層 ──────────────────────────────────────────
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { StorageModule } from '../../core/storage/storage.module'; // 署名 URL 発行用
import { AuthModule } from '../../core/auth/auth.module'; // JWT Guard / CurrentUser デコレータ
import { TranscoderModule } from '../../core/transcoder/transcoder.module';
import { CloudTasksModule } from '../../core/cloud-tasks/cloud-tasks.module';
import { DishMediaAssembler } from './dish-media.assembler';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import { CookieQueueModule } from 'src/core/cookie-queue/cookie-queue.module';

@Module({
  imports: [
    PrismaModule, // DB アクセス（@Global でも明示的 import が可読性↑）
    LoggerModule, // アプリ共通 Logger
    StorageModule, // 画像用 GCS / S3 署名 URL ユーティリティ
    TranscoderModule, // Video transcoding service
    CloudTasksModule, // Cloud Tasks サービス
    CookieQueueModule, // CDN Signed Cookie キューイングサービス
    forwardRef(() => RestaurantsModule), // RestaurantsAssembler で署名付きURL生成のため
    forwardRef(() => AuthModule), // 双方向依存を避けるため forwardRef
  ],
  controllers: [DishMediaController],
  providers: [
    DishMediaService,
    DishMediaRepository, // ← ここで DI できるので Service から注入可能
    DishMediaAssembler, // 追加: DishMediaAssembler をプロバイダーとして登録
  ],
  exports: [
    DishMediaService, // 他ドメインが “いいね数集計” 等で再利用できる
    DishMediaRepository,
    // #1395 my-dishes の Map ピンが getThumbnailImageUrl() を再利用する
    // （サムネイル URL の組み立てを 2 箇所に持たないため）
    DishMediaAssembler,
  ],
})
export class DishMediaModule {}
