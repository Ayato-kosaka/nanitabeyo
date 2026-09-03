import { IsOptional, IsString, Length } from "class-validator";

/** POST /v1/restaurants のボディ */
export class CreateRestaurantDto {
	/** Google Place ID */
	@IsString()
	googlePlaceId!: string;

	/**
	 * #1671 ユーザーが確認・編集した店名。新規作成時のみ使う（既存店にはそもそも渡らない）。
	 * 未指定なら従来どおり Google の表示名を使う（後方互換）。
	 */
	@IsOptional()
	@IsString()
	@Length(1, 200)
	name?: string;
}
