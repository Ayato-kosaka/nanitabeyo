import { IsOptional, IsString } from "class-validator";

/** GET /v1/locations/autocomplete のクエリ */
export class QueryAutocompleteLocationsDto {
	/** 検索語 */
	@IsString()
	q!: string;

	/** 言語コード (例: 'ja', 'en') */
	@IsString()
	languageCode!: string;

	/** セッショントークン */
	@IsOptional()
	@IsString()
	sessionToken?: string;
}
