// api/src/core/logger/logger.module.ts
// ------------------------------------
import { Module, Global, Logger } from '@nestjs/common';
import { AppLoggerService } from './logger.service';
import { ClsModule } from 'nestjs-cls';

@Global()
@Module({
  imports: [ClsModule.forRoot({ global: true })],
  providers: [
    /* Nest のデフォルト Logger を AppLoggerService で置き換え */
    {
      provide: Logger,
      useClass: AppLoggerService,
    },
    AppLoggerService,
  ],
  exports: [AppLoggerService],
})
export class LoggerModule {}
