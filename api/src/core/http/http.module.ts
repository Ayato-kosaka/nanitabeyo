import { Module, Global } from '@nestjs/common';
import { HttpService } from './http.service';
import { LoggerModule } from '../logger/logger.module';

@Global()
@Module({
  imports: [LoggerModule],
  providers: [HttpService],
  exports: [HttpService],
})
export class HttpModule {}
