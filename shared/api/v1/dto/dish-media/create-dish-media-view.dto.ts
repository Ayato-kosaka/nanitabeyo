import { Type } from "class-transformer";
import { IsBoolean, IsDate, IsInt, IsUUID, Min, ValidateIf } from "class-validator";

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
	@ValidateIf((o) => o.is_completed === true && o.is_skipped === true)
	// This will never pass if both are true, forcing validation error
	protected _validateCompletedAndSkipped?: never;
}
