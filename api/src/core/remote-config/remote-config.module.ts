import { Module } from '@nestjs/common';
import { RemoteConfigService } from './remote-config.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaticMasterModule } from '../static-master/static-master.module';

@Module({
  imports: [PrismaModule, StaticMasterModule],
  providers: [RemoteConfigService],
  exports: [RemoteConfigService],
})
export class RemoteConfigModule {}
