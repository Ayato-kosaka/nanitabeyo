// api/src/core/external-api/external-api.module.ts

import { Module } from '@nestjs/common';
import { ExternalApiService } from './external-api.service';

@Module({
  providers: [ExternalApiService],
  exports: [ExternalApiService],
})
export class ExternalApiModule {}