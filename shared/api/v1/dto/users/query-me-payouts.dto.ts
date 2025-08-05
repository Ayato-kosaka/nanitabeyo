import { IsOptional, IsString } from "@nestjs/class-validator";

/** GET /v1/users/me/payouts のクエリ */
export class QueryMePayoutsDto {
        @IsOptional()
        @IsString()
        cursor?: string;
}
