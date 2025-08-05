import { Module, Global } from '@nestjs/common';
import { NotifierService } from './notifier.service';
import { NOTIFIER_EXPO_CLIENT } from './notifier.constants';
import Expo from 'expo-server-sdk';

@Global()
@Module({
  providers: [
    {
      provide: NOTIFIER_EXPO_CLIENT,
      useFactory: () => {
        return new Expo(
          {},
          // TODO: 必要な場合は追加する。env.EXPO_ACCESS_TOKEN ? { accessToken: env.EXPO_ACCESS_TOKEN } : {},
        );
      },
    },
    NotifierService,
  ],
  exports: [NotifierService],
})
export class NotifierModule {}
