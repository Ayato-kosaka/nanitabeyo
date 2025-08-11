// api/src/core/cloud-tasks/cloud-tasks.module.ts

import { Module } from '@nestjs/common';
import { CloudTasksService } from './cloud-tasks.service';
import { LoggerModule } from '../logger/logger.module';

@Module({
  imports: [LoggerModule],
  providers: [CloudTasksService],
  exports: [CloudTasksService],
})
export class CloudTasksModule {}