// api/src/core/core.module.ts

import { Module } from '@nestjs/common';
import { LoggerModule } from './logger/logger.module';
import { StorageModule } from './storage/storage.module';
import { RemoteConfigModule } from './remote-config/remote-config.module';
import { CloudTasksModule } from './cloud-tasks/cloud-tasks.module';
import { AuthModule } from './auth/auth.module';
import { NotifierModule } from './notifier/notifier.module';
import { ClaudeModule } from './claude/claude.module';
import { ExternalApiModule } from './external-api/external-api.module';
import { PromptModule } from './prompt/prompt.module';

@Module({
  imports: [
    LoggerModule,
    StorageModule,
    RemoteConfigModule,
    CloudTasksModule,
    AuthModule,
    NotifierModule,
    ClaudeModule,
    ExternalApiModule,
    PromptModule,
  ],
  exports: [
    LoggerModule,
    StorageModule,
    RemoteConfigModule,
    CloudTasksModule,
    AuthModule,
    NotifierModule,
    ClaudeModule,
    ExternalApiModule,
    PromptModule,
  ],
})
export class CoreModule {}
