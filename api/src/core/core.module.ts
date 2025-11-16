// api/src/core/core.module.ts

import { Module } from '@nestjs/common';
import { LoggerModule } from './logger/logger.module';
import { StorageModule } from './storage/storage.module';
import { RemoteConfigModule } from './remote-config/remote-config.module';
import { CloudTasksModule } from './cloud-tasks/cloud-tasks.module';
import { AuthModule } from './auth/auth.module';
import { ClaudeModule } from './claude/claude.module';
import { ExternalApiModule } from './external-api/external-api.module';
import { PromptModule } from './prompt/prompt.module';
import { TranscoderModule } from './transcoder/transcoder.module';
import { CookieQueueModule } from './cookie-queue/cookie-queue.module';

@Module({
  imports: [
    LoggerModule,
    StorageModule,
    RemoteConfigModule,
    CloudTasksModule,
    AuthModule,
    ClaudeModule,
    ExternalApiModule,
    PromptModule,
    TranscoderModule,
    CookieQueueModule,
  ],
  exports: [
    LoggerModule,
    StorageModule,
    RemoteConfigModule,
    CloudTasksModule,
    AuthModule,
    ClaudeModule,
    ExternalApiModule,
    PromptModule,
    TranscoderModule,
    CookieQueueModule,
  ],
})
export class CoreModule {}
