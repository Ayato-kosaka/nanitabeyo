// api/src/core/cookie-queue/cookie-queue.module.ts

import { Module } from '@nestjs/common';
import { CookieQueueService } from './cookie-queue.service';

@Module({
  providers: [CookieQueueService],
  exports: [CookieQueueService],
})
export class CookieQueueModule {}
