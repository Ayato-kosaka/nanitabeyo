// api/src/v1/share-links/share-links.module.ts
//
// #721 【設計】共有リンクの DI 設定。
// SSR 側（api/src/share/share.module.ts）が Service を使うため exports する。

import { Module } from '@nestjs/common';
import { ShareLinksController } from './share-links.controller';
import { ShareLinksService } from './share-links.service';
import { ShareLinksRepository } from './share-links.repository';
import { ShareLinkTargetResolvers } from './share-links.resolvers';

import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module';

@Module({
  imports: [PrismaModule, LoggerModule, AuthModule],
  controllers: [ShareLinksController],
  providers: [
    ShareLinksService,
    ShareLinksRepository,
    ShareLinkTargetResolvers,
  ],
  exports: [ShareLinksService],
})
export class ShareLinksModule {}
