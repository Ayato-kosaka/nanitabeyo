import { Module } from '@nestjs/common';
import { GooglePlacesService } from './google-places.service';
import { LoggerModule } from '../logger/logger.module';

@Module({
  imports: [LoggerModule],
  providers: [GooglePlacesService],
  exports: [GooglePlacesService],
})
export class GooglePlacesModule {}
