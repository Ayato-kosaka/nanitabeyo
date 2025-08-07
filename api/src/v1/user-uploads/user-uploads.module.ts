import { Module } from '@nestjs/common';
import { UserUploadsController } from './user-uploads.controller';
import { UserUploadsService } from './user-uploads.service';
import { StorageModule } from '../../core/storage/storage.module';
import { LoggerModule } from '../../core/logger/logger.module';

@Module({
  imports: [StorageModule, LoggerModule],
  controllers: [UserUploadsController],
  providers: [UserUploadsService],
  exports: [UserUploadsService],
})
export class UserUploadsModule {}
