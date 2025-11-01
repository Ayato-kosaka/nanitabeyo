// api/src/internal/notifications/notifications.module.ts

import { Module } from '@nestjs/common';
import { InternalNotificationsController } from './notifications.controller';
import { NotificationJobService } from './notification-job.service';
import { NotificationsModule } from '../../v1/notifications/notifications.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { CoreModule } from '../../core/core.module';

@Module({
  imports: [PrismaModule, CoreModule, NotificationsModule],
  controllers: [InternalNotificationsController],
  providers: [NotificationJobService],
})
export class InternalNotificationsModule {}
