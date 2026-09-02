// api/src/v1/notifications/notifications.module.ts

import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';
import { DeviceTokensController } from '../device-tokens/device-tokens.controller';
import { NotificationPreferencesController } from '../notification-preferences/notification-preferences.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { CoreModule } from '../../core/core.module';
import { UsersModule } from '../users/users.module';
import { DishMediaModule } from '../dish-media/dish-media.module';

@Module({
  imports: [PrismaModule, CoreModule, UsersModule, DishMediaModule],
  controllers: [
    NotificationsController,
    DeviceTokensController,
    // #1510 ルートは `/v1/users/me/notification-preferences` だが、
    // 依存する Provider は通知ドメインなのでこの Module に登録する
    NotificationPreferencesController,
  ],
  providers: [NotificationsService, NotificationsRepository],
  exports: [NotificationsService, NotificationsRepository],
})
export class NotificationsModule {}
