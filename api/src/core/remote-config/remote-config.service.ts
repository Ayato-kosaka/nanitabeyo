// api/src/core/remote-config/remote-config.service.ts
import { Injectable } from '@nestjs/common';
import { env } from '../config/env';

@Injectable()
export class RemoteConfigService {
  async fetchFeatureFlags() {
    // const { data } = await axios.get(env.REMOTE_CONFIG_URL);
    // return data;
  }
}
