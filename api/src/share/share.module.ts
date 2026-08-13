// api/src/share/share.module.ts
//
// #721 【設計】`/s/:token` の SSR。
//
// v1 配下ではなくルート直下に生やすため、V1Module ではなく AppModule から読む
// （RobotsModule と同じ位置づけ）。

import { Module } from '@nestjs/common';
import { ShareController } from './share.controller';
import { ShareLinksModule } from '../v1/share-links/share-links.module';
import { StorageModule } from '../core/storage/storage.module';
import { LoggerModule } from '../core/logger/logger.module';

@Module({
  imports: [ShareLinksModule, StorageModule, LoggerModule],
  controllers: [ShareController],
})
export class ShareModule {}
