// api/src/v1/notifications/notifications.module.ts

import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';
import { DeviceTokensController } from '../device-tokens/device-tokens.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { CoreModule } from '../../core/core.module';
import { UsersModule } from '../users/users.module';
import { DishMediaModule } from '../dish-media/dish-media.module';
import { DishReviewsModule } from '../dish-reviews/dish-reviews.module'; // #448 【設計】dish_reviews 一括取得用

@Module({
  imports: [
    PrismaModule,
    CoreModule,
    UsersModule,
    DishMediaModule,
    DishReviewsModule, // #448 【設計】dish_reviews 一括取得用
  ],
  controllers: [NotificationsController, DeviceTokensController],
  providers: [NotificationsService, NotificationsRepository],
  exports: [NotificationsService, NotificationsRepository],
})
export class NotificationsModule {}
