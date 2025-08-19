// api/src/core/logger/logger.module.ts
// ------------------------------------
import {
  Module,
  Global,
  Logger,
  MiddlewareConsumer,
  NestModule,
} from '@nestjs/common';
import { AppLoggerService } from './logger.service';
import { LogFlushMiddleware } from './log-flush.middleware';
import { ClsModule } from 'nestjs-cls';
import { PrismaModule } from '../../prisma/prisma.module';

@Global()
@Module({
  imports: [ClsModule.forRoot({ global: true }), PrismaModule],
  providers: [
    /* Nest のデフォルト Logger を AppLoggerService で置き換え */
    {
      provide: Logger,
      useClass: AppLoggerService,
    },
    AppLoggerService,
    LogFlushMiddleware,
  ],
  exports: [AppLoggerService],
})
export class LoggerModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply log flush middleware to all routes
    consumer.apply(LogFlushMiddleware).forRoutes('*');
  }
}
