// api/src/v1/restaurant-reports/restaurant-reports.module.ts
//
// #1933 【設計】店舗情報の «この情報が違う» 報告の DI 設定。

import { Module } from '@nestjs/common';
import { RestaurantReportsController } from './restaurant-reports.controller';
import { RestaurantReportsService } from './restaurant-reports.service';
import { RestaurantReportsRepository } from './restaurant-reports.repository';

import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module';

@Module({
  imports: [PrismaModule, LoggerModule, AuthModule],
  controllers: [RestaurantReportsController],
  providers: [RestaurantReportsService, RestaurantReportsRepository],
})
export class RestaurantReportsModule {}
