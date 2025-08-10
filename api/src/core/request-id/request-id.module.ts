import { Module, Global } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { randomUUID } from 'crypto';

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
          return (
            (req.headers[REQUEST_ID_HEADER.toLowerCase()] as
              | string
              | undefined) ?? randomUUID()
          );
        },
        setup: (cls, req, res) => {
          const requestId = cls.getId();
          cls.set(CLS_KEY_REQUEST_ID, requestId);
        },
      },
    }),
  ],
  providers: [],
})
export class RequestIdModule {}
