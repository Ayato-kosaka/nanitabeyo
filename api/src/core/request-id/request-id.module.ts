import { Module, MiddlewareConsumer, Global } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';

import { RequestIdMiddleware } from './request-id.middleware';
import { RequestIdInterceptor } from './request-id.interceptor';

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true }, // 自動で per-request CLS を生成
    }),
  ],
  providers: [RequestIdInterceptor],
})
export class RequestIdModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*'); // すべてのルートに適用
  }
}
