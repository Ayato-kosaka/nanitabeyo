import { Type } from "class-transformer";
import { IsBoolean, IsDate, IsInt, IsNotEmpty, IsUUID, Min, ValidateIf } from "class-validator";

export class CreateDishMediaViewDto {
	/** impression_id */
	@IsUUID()
	impression_id!: string;

	/** started_at */
	@Type(() => Date)
	@IsDate()
	started_at!: Date;

	/** watch_ms (required, minimum 0) */
	@IsInt()
	@Min(0)
	watch_ms!: number;

	/** is_completed (default false) */
	@IsBoolean()
	is_completed!: boolean;

	/** is_skipped (default false) */
	@IsBoolean()
	is_skipped!: boolean;

	/** rewatch_count (default 0) */
	@IsInt()
	@Min(0)
	rewatch_count!: number;

	/** Validation: cannot be both completed and skipped */
	@ValidateIf(o => o.is_completed === true && o.is_skipped === true)
	@IsNotEmpty({ message: "is_completed と is_skipped を同時に true にはできません。" })
	// 値は与えないので、条件成立時に IsNotEmpty が必ず失敗する
	private _xorGuard?: unknown;
}
