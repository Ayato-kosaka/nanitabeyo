import { Module, Global } from '@nestjs/common';
import { Storage, StorageOptions } from '@google-cloud/storage';
import { env } from '../config/env';
import { STATIC_MASTER_CLIENT } from './static-master.constants';
import { StaticMasterService } from './static-master.service';

@Global()
@Module({
  imports: [],
  providers: [
    /* --------- Storage クライアント DI (環境別認証) --------- */
    {
      provide: STATIC_MASTER_CLIENT,
      useFactory: () => {
        /** 本番: ランタイムの標準認証 / Dev: サービスアカウント明示 */
        const opts: StorageOptions =
          env.API_NODE_ENV === 'production'
            ? {}
            : {
              projectId: env.GCP_PROJECT,
              credentials: JSON.parse(
                Buffer.from(
                  env.GCS_DEV_SERVICE_ACCOUNT_BASE64!,
                  'base64',
                ).toString('utf-8'),
              ),
            };
        return new Storage(opts);
      },
    },
    StaticMasterService,
  ],
  exports: [StaticMasterService],
})
export class StaticMasterModule { }
