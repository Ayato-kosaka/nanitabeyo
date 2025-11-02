// api/src/internal/notifications/notifications.module.ts

import { Module } from '@nestjs/common';
import { InternalNotificationsController } from './notifications.controller';
import { NotificationJobService } from './notification-job.service';
import { NotificationsModule } from '../../v1/notifications/notifications.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { CoreModule } from '../../core/core.module';
import { UsersModule } from 'src/v1/users/users.module';

@Module({
  imports: [PrismaModule, CoreModule, NotificationsModule, UsersModule],
  controllers: [InternalNotificationsController],
  providers: [NotificationJobService],
})
export class InternalNotificationsModule {}
