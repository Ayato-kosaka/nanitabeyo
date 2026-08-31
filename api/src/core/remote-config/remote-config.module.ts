import { Module } from '@nestjs/common';
import { RemoteConfigService } from './remote-config.service';

// #1764 値の実体が Cloud Run の環境変数になったため、GCS（StaticMaster）にも
// Prisma にも依存しない。
@Module({
  providers: [RemoteConfigService],
  exports: [RemoteConfigService],
})
export class RemoteConfigModule {}
