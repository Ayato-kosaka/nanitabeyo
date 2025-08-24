// api/src/v1/feedback/feedback.module.ts
//
// ❶ "最小構成で早く動かす" + ❂ "あとから機能を足しても破綻しない"
//    ────────────────────────────────────────────────
// - Controller / Service を DI で結線
// - 共通横串（Logger, Auth）を imports に集約
// - Service を外部の Module から再利用しやすいよう `exports:` で公開
//

import { Module, forwardRef } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

// ─── 横串インフラ層 ──────────────────────────────────────────
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module'; // JWT Guard

@Module({
  imports: [
    LoggerModule, // アプリ共通 Logger
    forwardRef(() => AuthModule), // 双方向依存を避けるため forwardRef
  ],
  controllers: [FeedbackController],
  providers: [FeedbackService],
  exports: [
    FeedbackService, // 他ドメインが再利用できる
  ],
})
export class FeedbackModule {}
