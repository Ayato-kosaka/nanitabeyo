import { Module } from '@nestjs/common';
import { RemoteConfigService } from './remote-config.service';
import { UtilsModule } from '../utils/utils.module';

@Module({
  imports: [UtilsModule],
  providers: [RemoteConfigService],
  exports: [RemoteConfigService],
})
export class RemoteConfigModule {}
