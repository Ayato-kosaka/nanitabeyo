import { Module } from '@nestjs/common';
import { RemoteConfigService } from './remote-config.service';
import { StaticMasterService } from '../utils/static-master.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [RemoteConfigService, StaticMasterService],
  exports: [RemoteConfigService],
})
export class RemoteConfigModule {}
