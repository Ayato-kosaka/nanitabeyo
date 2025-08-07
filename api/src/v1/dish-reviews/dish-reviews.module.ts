// api/src/v1/dish-reviews/dish-reviews.module.ts
//
// ❶ "最小構成で早く動かす" + ❷ "あとから機能を足しても破綻しない"
//    ────────────────────────────────────────────────
// - Controller / Service / Repository を DI で結線
// - 共通横串（Prisma, Logger, Notifier, Auth）を imports に集約
// - Service を外部の Module から再利用しやすいよう `exports:` で公開
//

import { Module, forwardRef } from '@nestjs/common';
import { DishReviewsController } from './dish-reviews.controller';
import { DishReviewsService } from './dish-reviews.service';
import { DishReviewsRepository } from './dish-reviews.repository';

// ─── 横串インフラ層 ──────────────────────────────────────────
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { NotifierModule } from '../../core/notifier/notifier.module';
import { AuthModule } from '../../core/auth/auth.module'; // JWT Guard / CurrentUser デコレータ

@Module({
  imports: [
    PrismaModule, // DB アクセス
    LoggerModule, // アプリ共通 Logger
    NotifierModule, // プッシュ通知
    forwardRef(() => AuthModule), // 双方向依存を避けるため forwardRef
  ],
  controllers: [DishReviewsController],
  providers: [DishReviewsService, DishReviewsRepository],
  exports: [
    DishReviewsService, // 他ドメインが再利用できる
  ],
})
export class DishReviewsModule {}
