// api/src/v1/content-reports/content-reports.module.ts
//
// #1514 (SAF-01) 【設計】投稿の通報の DI 設定。

import { Module } from '@nestjs/common';
import { ContentReportsController } from './content-reports.controller';
import { MeContentReportsController } from './me-content-reports.controller';
import { ContentReportsService } from './content-reports.service';
import { ContentReportsRepository } from './content-reports.repository';

import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module';

@Module({
  imports: [PrismaModule, LoggerModule, AuthModule],
  controllers: [ContentReportsController, MeContentReportsController],
  providers: [ContentReportsService, ContentReportsRepository],
})
export class ContentReportsModule {}
