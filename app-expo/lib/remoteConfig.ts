import { Env } from "../constants/Env";
import type { RemoteConfigValues } from "@shared/remoteConfig/remoteConfig.schema";
import { Database } from "@shared/supabase/database.types";
import { TableRow } from "@shared/utils/devDB.types";

// キャッシュ用のローカル変数（初期値は null）
let cachedValues: RemoteConfigValues | null = null;

/**
 * CDN から静的マスタを取得
 *
 * @param tableName - テーブル名
 * @returns テーブルのデータ
 */
const fetchStaticMasterFromCDN = async <T extends keyof Database["dev"]["Tables"]>(
	tableName: T,
): Promise<TableRow<T>[]> => {
	// CDN の URL を組み立て
	const cdnUrl = `${Env.CDN_PUBLIC_HOST}${Env.GCS_STATIC_MASTER_DIR_PATH}${tableName}.json`;

	const res = await fetch(cdnUrl);
	if (!res.ok) {
		throw new Error(`Failed to load static master from CDN. ${tableName}.json is not found.`);
	}

	const jsonData = await res.json();

	if (!jsonData) {
		throw new Error(`Failed to load static master from CDN. ${tableName}.json is empty.`);
	} else if (jsonData.data === undefined) {
		throw new Error(`Failed to load static master from CDN. ${tableName}.json is undefined.`);
	} else if (!Array.isArray(jsonData.data)) {
		throw new Error(`Failed to load static master from CDN. ${tableName} is invalid.`);
	}

	return jsonData.data as unknown as TableRow<T>[];
};

/**
 * 静的マスタから設定データを取得
 *
 * @returns 設定データ
 */
export const initRemoteConfig = async (): Promise<RemoteConfigValues | null> => {
	// 🔄 静的マスタから設定データを取得
	const configJson = await fetchStaticMasterFromCDN("config");
	const config = configJson.reduce(
		(acc, config) => {
			acc[config.key] = config.value;
			return acc;
		},
		{} as Record<string, string>,
	);

	cachedValues = config as RemoteConfigValues;
	return cachedValues;
};

/**
 * キャッシュされた Remote Config の値を取得する。
 * 初期化されていない場合は null を返すため、起動時に `initRemoteConfig` を呼び出すこと。
 *
 * @returns 初期化済みの Remote Config 値 or null
 */
export const getRemoteConfig = (): RemoteConfigValues | null => cachedValues;
