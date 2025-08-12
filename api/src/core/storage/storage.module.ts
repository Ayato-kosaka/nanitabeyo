import { Module, Global } from '@nestjs/common';
import { Storage, StorageOptions } from '@google-cloud/storage';
import { STORAGE_CLIENT } from './storage.constants';
import { StorageService } from './storage.service';
import { env } from '../config/env';
import { LoggerModule } from '../logger/logger.module';

@Global()
@Module({
  imports: [LoggerModule], // ← LoggerService を利用する場合
  providers: [
    /* --------- Storage クライアント DI (環境別認証) --------- */
    {
      provide: STORAGE_CLIENT,
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
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
