import { IsNumber, Max, Min } from "class-validator";
import { Type } from "class-transformer";

/** GET /v1/locations/reverse-geocoding のクエリ */
export class QueryReverseGeocodingDto {
	/** 緯度 */
	@Type(() => Number)
	@IsNumber()
	@Min(-90)
	@Max(90)
	lat!: number;

	/** 経度 */
	@Type(() => Number)
	@IsNumber()
	@Min(-180)
	@Max(180)
	lng!: number;
}
