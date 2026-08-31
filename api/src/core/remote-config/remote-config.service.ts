// api/src/core/remote-config/remote-config.service.ts
import { Injectable } from '@nestjs/common';
import { env } from '../config/env';

/**
 * #1764 【設計】API 側の Remote Config キー。
 *
 * 値の実体は Cloud Run の環境変数（検証と既定値は core/config/env.ts）。
 * かつては GCS の config.json（Supabase `config` テーブルの静的マスタ出力）を
 * 読んでいたが、値の変更経路を `cloud-run-env-update.yml` の dispatch に一本化した。
 *
 * アプリ（app-expo）が CDN から直接読むキーはここに含めない。それらの正は
 * 従来どおり config.json（shared/remoteConfig/remoteConfig.schema.ts 参照）。
 */
export const REMOTE_CONFIG_KEYS = [
  'is_maintenance',
  'minimum_supported_version',
  'v1_search_result_restaurants_number',
  'v1_bulk_import_preflight_enabled',
  'TOOLS_DISH_CATEGORIES_POPULAR_EXCLUDED_CATEGORY_IDS',
  'dish_category_recommendation_weight_time_slot',
  'dish_category_recommendation_weight_scene',
  'dish_category_recommendation_weight_satiety',
  'dish_category_recommendation_weight_taste',
  'dish_category_recommendation_weight_budget_intent',
  'dish_category_recommendation_weight_dining_pace',
  'dish_category_recommendation_weight_core_ingredient',
  'dish_category_recommendation_weight_market_salience',
  'dish_category_recommendation_weight_dine_out_orderability',
  'dish_category_recommendation_weight_season',
  'dish_category_recommendation_score_jitter_ratio',
  'dish_category_recommendation_penalty_weight_core_ingredient',
  'dish_category_recommendation_penalty_weight_taste',
  'dish_category_recommendation_penalty_weight_cooking_method',
] as const;

export type RemoteConfigKey = (typeof REMOTE_CONFIG_KEYS)[number];

@Injectable()
export class RemoteConfigService {
  /**
   * 🔧 Remote Config の値を取得する。
   *
   * #1764 【設計】async のままにしてある。実体は同期の env 参照だが、
   * 呼び出し側（guard / service / repository）を GCS 時代のシグネチャから
   * 変えないためと、将来また外部ストアへ戻す余地を閉じないため。
   *
   * @param keys - 取得対象の設定キー配列
   * @returns 対応する設定値配列（string[]）
   */
  async getRemoteConfigValues(keys: RemoteConfigKey[]): Promise<string[]> {
    return keys.map((key) => env[key]);
  }

  async getRemoteConfigValue(key: RemoteConfigKey): Promise<string> {
    return (await this.getRemoteConfigValues([key]))[0];
  }
}
