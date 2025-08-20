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
	/** addressComponents より locality 以上の階層を抽出し、カンマ区切りで設定 */
	address: string;
	/** addressComponents から解決された現地言語コード (BCP47) */
	localLanguageCode: string;
}
