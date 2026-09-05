import { Module, Global } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { randomUUID } from 'crypto';

import { CLS_KEY_APP_LANGUAGE, CLS_KEY_REQUEST_ID } from '../cls/cls.constants';
import { APP_LANGUAGE_HEADER, REQUEST_ID_HEADER } from './request-id.constants';

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

          // #1052 端末言語。未送信の旧クライアントは undefined のままで、
          // 呼び出し側は従来どおり「優先指定なし」へフォールバックする。
          const appLanguage = req.headers?.[
            APP_LANGUAGE_HEADER.toLowerCase()
          ] as string | undefined;
          if (appLanguage) cls.set(CLS_KEY_APP_LANGUAGE, appLanguage);
        },
      },
    }),
  ],
  providers: [],
})
export class RequestIdModule {}
