// api/src/v1/logs/logs.module.ts
//
// #487 【設計】フロントログ送信経路変更（Prisma 廃止 / Cloud Logging 対応）
// Logs モジュール定義
//

import { Module, forwardRef } from '@nestjs/common';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';

// ─── 横串インフラ層 ──────────────────────────────────────────
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module';

@Module({
  imports: [LoggerModule, forwardRef(() => AuthModule)],
  controllers: [LogsController],
  providers: [LogsService],
  exports: [LogsService],
})
export class LogsModule {}
