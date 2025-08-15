import { IsOptional, IsString } from "@nestjs/class-validator";

/** GET /v1/locations/details のクエリ */
export class QueryLocationDetailsDto {
	/** Place ID */
	@IsString()
	placeId!: string;

	/** 言語コード (例: 'en', 'ja') */
	@IsString()
	languageCode!: string;

	/** セッショントークン */
	@IsOptional()
	@IsString()
	sessionToken?: string;
}
