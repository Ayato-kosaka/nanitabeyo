// api/src/core/safe-fetch/safe-fetch.module.ts

import { Module } from '@nestjs/common';

import { LoggerModule } from '../logger/logger.module';
import { NodeSafeFetchTransport } from './node-safe-fetch.transport';
import { SafeFetchService } from './safe-fetch.service';
import { SAFE_FETCH_TRANSPORT } from './safe-fetch.types';

@Module({
  imports: [LoggerModule],
  providers: [
    SafeFetchService,
    // ソケットに触る実装は差し替え可能にしてある（テストは外部へ出さない）
    { provide: SAFE_FETCH_TRANSPORT, useClass: NodeSafeFetchTransport },
  ],
  exports: [SafeFetchService],
})
export class SafeFetchModule {}
