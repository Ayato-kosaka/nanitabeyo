// api/src/v1/contribution-tasks/contribution-tasks.module.ts
//
// 🎯 目的
//   • ContributionTasks 機能の DI 設定
//   • Controller / Service / Repository を結線
//   • 必要な横串インフラ（Prisma, Logger, Auth）を import
//

import { Module } from '@nestjs/common';
import { ContributionTasksController } from './contribution-tasks.controller';
import { ContributionTasksService } from './contribution-tasks.service';
import { ContributionTasksRepository } from './contribution-tasks.repository';

// ─── 横串インフラ層 ──────────────────────────────────────────
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module';

@Module({
  imports: [
    PrismaModule, // DB アクセス
    LoggerModule, // アプリ共通 Logger
    AuthModule, // JWT Guard / CurrentUser デコレータ
  ],
  controllers: [ContributionTasksController],
  providers: [
    ContributionTasksService,
    ContributionTasksRepository,
  ],
  exports: [
    ContributionTasksService, // 他モジュールから利用可能にする
    ContributionTasksRepository,
  ],
})
export class ContributionTasksModule {}
