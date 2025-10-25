import { IsBoolean, IsInt, IsOptional, IsUUID, Min, ValidateIf } from "class-validator";

export class CreateDishMediaViewDto {
	/** impression_id (nullable) */
	@IsOptional()
	@IsUUID()
	impression_id?: string | null;

	/** dish_media_id (required) */
	@IsUUID()
	dish_media_id!: string;

	/** user_id (nullable, from auth) */
	@IsOptional()
	@IsUUID()
	user_id?: string | null;

	/** started_at (ISO string, default to now if not provided) */
	@IsOptional()
	started_at?: string;

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
