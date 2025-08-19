// api/src/core/remote-config/remote-config.service.ts
import { Injectable } from '@nestjs/common';
import { StaticMasterService } from '../utils/static-master.service';
import {
  remoteConfigSchema,
  RemoteConfigValues,
} from '../../../../shared/remoteConfig/remoteConfig.schema';

@Injectable()
export class RemoteConfigService {
  constructor(private readonly staticMasterService: StaticMasterService) { }

  /**
   * 🔧 Remote Config の静的マスタから指定キーの値を取得する。
   *
   * - Supabase に定義された `config` テーブルを参照
   * - 型安全にパースし、不正なキーや構造を検知
   *
   * @param key - 取得対象の設定キー
   * @returns 対応する設定値（string）
   * @throws 無効な構造や存在しないキーに対しては例外を投げる
   */
  async getRemoteConfigValue(key: keyof RemoteConfigValues): Promise<string> {
    // 🔄 静的マスタから設定データを取得
    const configJson = await this.staticMasterService.getStaticMaster('config');
    const rawConfig = configJson.reduce(
      (acc, config) => {
        acc[config.key] = config.value;
        return acc;
      },
      {} as Record<string, string>,
    );

    // ✅ Zod で型検証＆パース
    const {
      success,
      error,
      data: parsedConfig,
    } = remoteConfigSchema.safeParse(rawConfig);

    if (!success) {
      throw new Error(`Remote config validation failed: ${error.message}`);
    }

    // ❓ 対象キーが存在しない場合は明示的にエラー
    if (!(key in parsedConfig)) {
      throw new Error(`Remote config key "${key}" is not defined.`);
    }

    const value = parsedConfig[key];

    if (typeof value !== 'string') {
      throw new Error(`Remote config value for key "${key}" must be a string.`);
    }

    return value;
  }
}