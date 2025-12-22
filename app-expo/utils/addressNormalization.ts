// app-expo/utils/addressNormalization.ts
//
// #533 【仕様】type-based 正規化 address の文字列変換ユーティリティ
//

import type { AddressComponentsNormalized } from "@shared/api/v1/res";

/**
 * 正規化 address の形式パターン（type:value 形式）
 * 例: "country:JP, locality:Kyoto"
 */
const NORMALIZED_ADDRESS_PATTERN = /^[a-z_]+:[^,]+(,\s*[a-z_]+:[^,]+)*$/;

/**
 * 正規化された addressComponents を "type:value" 形式の文字列に変換
 *
 * @example
 * Input: { country: "JP", locality: "Kyoto" }
 * Output: "country:JP, locality:Kyoto"
 *
 * @param addressComponents 正規化された address components
 * @returns "type:value" 形式のカンマ区切り文字列
 */
export function formatNormalizedAddress(addressComponents: AddressComponentsNormalized): string {
	// #533 【設計】優先順位の高い順に出力（country → administrative → locality → sublocality → postal_code）
	const typePriority = [
		"country",
		"administrative_area_level_1",
		"administrative_area_level_2",
		"administrative_area_level_3",
		"locality",
		"sublocality",
		"sublocality_level_1",
		"postal_code",
	];

	const parts: string[] = [];

	for (const type of typePriority) {
		if (addressComponents[type]) {
			parts.push(`${type}:${addressComponents[type]}`);
		}
	}

	// priority にない type も追加（順序は不定）
	for (const [type, value] of Object.entries(addressComponents)) {
		if (!typePriority.includes(type)) {
			parts.push(`${type}:${value}`);
		}
	}

	return parts.join(", ");
}

/**
 * レガシー address 文字列が正規化形式か判定
 *
 * @example
 * "country:JP, locality:Kyoto" → true
 * "Kyoto, Japan" → false
 *
 * @param address address 文字列
 * @returns 正規化形式なら true
 */
export function isNormalizedAddressFormat(address: string): boolean {
	// #533 【仕様】type:value 形式を含むか判定
	return NORMALIZED_ADDRESS_PATTERN.test(address.trim());
}
