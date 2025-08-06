/** Google Places API の最小限の型 */
export interface Place {
	place_id: string;
	description: string;
}

/** GET /v1/locations/autocomplete のレスポンス型 */
export type AutocompleteLocationsResponse = Place[];
