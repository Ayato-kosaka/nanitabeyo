import { Module, MiddlewareConsumer, Global } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { randomUUID } from 'crypto';

import { RequestIdMiddleware } from './request-id.middleware';
import { RequestIdInterceptor } from './request-id.interceptor';
import { CLS_KEY_REQUEST_ID } from '../cls/cls.constants';
import { REQUEST_ID_HEADER } from './request-id.constants';

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: any) => {
          // ヘッダから継承 or 新規採番
          return (req.headers[REQUEST_ID_HEADER.toLowerCase()] as string | undefined) ?? randomUUID();
        },
        setup: (cls, req, res) => {
          // レスポンスヘッダにも設定
          const requestId = cls.getId();
          cls.set(CLS_KEY_REQUEST_ID, requestId);
          res.setHeader(REQUEST_ID_HEADER, requestId);
        },
      },
    }),
  ],
  providers: [RequestIdInterceptor],
})
export class RequestIdModule {
  // RequestIdMiddleware は不要になったため削除
}
