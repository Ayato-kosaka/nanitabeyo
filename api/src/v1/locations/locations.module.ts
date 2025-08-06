// api/src/v1/locations/locations.module.ts
//
// Module for locations

import { Module, forwardRef } from '@nestjs/common';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

// Core modules
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module';
import { ExternalApiModule } from '../../core/external-api/external-api.module';

@Module({
  imports: [
    LoggerModule, // App logger
    forwardRef(() => AuthModule), // JWT Guard
    ExternalApiModule, // Google APIs
  ],
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}