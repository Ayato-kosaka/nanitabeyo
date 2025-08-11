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
