// api/src/core/remote-config/remote-config.service.ts
import { Injectable } from '@nestjs/common';
import { StaticMasterService } from '../utils/static-master.service';
import {
  remoteConfigSchema,
  RemoteConfigValues,
} from '../../../../shared/remoteConfig/remoteConfig.schema';

interface ConfigCache {
  data: RemoteConfigValues;
  expiresAt: number;
}

@Injectable()
export class RemoteConfigService {
  /** キャッシュTTL（ミリ秒）- 既存のstatic masterパターンに合わせる */
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5分
  private configCache: ConfigCache | null = null;

  constructor(private readonly staticMasterService: StaticMasterService) {}

  /**
   * 🔧 Remote Config の静的マスタから全設定を取得（キャッシュ付き）
   *
   * - Supabase に定義された `config` テーブルを参照
   * - 型安全にパースし、不正なキーや構造を検知
   * - 最小限のキャッシュ（TTL）で設定取得の負荷を軽減
   *
   * @returns 設定値の全体オブジェクト
   * @throws 無効な構造や取得失敗に対しては例外を投げる
   */
  private async getRemoteConfig(): Promise<RemoteConfigValues> {
    const now = Date.now();

    // キャッシュが有効な場合はそれを返す
    if (this.configCache && now < this.configCache.expiresAt) {
      return this.configCache.data;
    }

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

    // キャッシュを更新
    this.configCache = {
      data: parsedConfig,
      expiresAt: now + this.CACHE_TTL_MS,
    };

    return parsedConfig;
  }

  /**
   * 🔧 Remote Config の静的マスタから指定キーの値を取得する。
   *
   * - Supabase に定義された `config` テーブルを参照
   * - 型安全にパースし、不正なキーや構造を検知
   * - キャッシュ機能付きで効率的にアクセス
   *
   * @param key - 取得対象の設定キー
   * @returns 対応する設定値（string）
   * @throws 無効な構造や存在しないキーに対しては例外を投げる
   */
  async getRemoteConfigValue(key: keyof RemoteConfigValues): Promise<string> {
    const config = await this.getRemoteConfig();

    // ❓ 対象キーが存在しない場合は明示的にエラー
    if (!(key in config)) {
      throw new Error(`Remote config key "${key}" is not defined.`);
    }

    const value = config[key];

    if (typeof value !== 'string') {
      throw new Error(`Remote config value for key "${key}" must be a string.`);
    }

    return value;
  }
}
