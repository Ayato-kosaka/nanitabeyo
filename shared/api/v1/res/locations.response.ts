/** Google Places API の最小限の型 */
export interface AutocompleteLocation {
	place_id: string;
	text: string;
	mainText: string;
	secondaryText: string;
	types: string[];
}

/** GET /v1/locations/autocomplete のレスポンス型 */
export type AutocompleteLocationsResponse = AutocompleteLocation[];

/**
 * type-based な正規化 address 形式
 * 各 type をキーとして shortText を格納
 * 例: { "country": "JP", "locality": "Kyoto" }
 */
export type AddressComponentsNormalized = Record<string, string>;

/** GET /v1/locations/details のレスポンス型 */
export interface LocationDetailsResponse {
	/** Place Details (New) responses の値をそのまま設定 */
	location: {
		latitude: number;
		longitude: number;
	};
	/** Place Details (New) responses の値をそのまま設定 */
	viewport: {
		low: {
			latitude: number;
			longitude: number;
		};
		high: {
			latitude: number;
			longitude: number;
		};
	};
	/**
	 * addressComponents より locality 以上の階層を抽出し、カンマ区切りで設定
	 * 表示用の住所文字列（後方互換性のため維持）
	 */
	address: string;
	/**
	 * type-based な正規化 address 形式（#533 レコメンド用）
	 * 例: { "country": "JP", "administrative_area_level_1": "Kyoto", "locality": "Kyoto" }
	 */
	addressComponents: AddressComponentsNormalized;
	/** addressComponents から解決された現地言語コード (BCP47) */
	localLanguageCode: string;
}

/** GET /v1/locations/reverse-geocoding のレスポンス型 */
export interface LocationReverseGeocodingResponse {
	/** 逆ジオコーディング結果の座標 */
	location: {
		latitude: number;
		longitude: number;
	};
	/** レスポンスの viewport 情報 */
	viewport: {
		low: {
			latitude: number;
			longitude: number;
		};
		high: {
			latitude: number;
			longitude: number;
		};
	};
	/**
	 * 逆ジオコーディングで取得された住所
	 * 表示用の住所文字列（後方互換性のため維持）
	 */
	address: string;
	/**
	 * type-based な正規化 address 形式（#533 レコメンド用）
	 * 例: { "country": "JP", "administrative_area_level_1": "Kyoto", "locality": "Kyoto" }
	 */
	addressComponents: AddressComponentsNormalized;
	/** 解決された現地言語コード (BCP47) */
	localLanguageCode: string;
}
