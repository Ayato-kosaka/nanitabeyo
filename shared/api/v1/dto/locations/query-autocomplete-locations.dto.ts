import { IsString } from "@nestjs/class-validator";

/** GET /v1/locations/autocomplete のクエリ */
export class QueryAutocompleteLocationsDto {
        /** 検索語 */
        @IsString()
        q!: string;
}
