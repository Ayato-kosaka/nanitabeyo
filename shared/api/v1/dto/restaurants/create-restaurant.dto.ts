import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Length } from "class-validator";

/** POST /v1/restaurants のボディ */
export class CreateRestaurantDto {
	/** Google Place ID */
	@IsString()
	googlePlaceId!: string;

	/**
	 * #1671 確認ページが発行元の下読み（POST /v1/restaurants/draft）から受け取ったトークン。
	 *
	 * **これが付いているときだけ、下の確認済みの値が使われる。** 付いていなければ
	 * 従来どおりサーバが Google から取った値をそのまま保存する（後方互換）。
	 */
	@IsOptional()
	@IsString()
	draftToken?: string;

	/** 確認ページでユーザーが確定させた店名 */
	@IsOptional()
	@IsString()
	@Length(1, 200)
	name?: string;

	/** 確認ページでユーザーが確定させた緯度 */
	@IsOptional()
	@IsNumber()
	@IsLatitude()
	latitude?: number;

	/** 確認ページでユーザーが確定させた経度 */
	@IsOptional()
	@IsNumber()
	@IsLongitude()
	longitude?: number;

	/** 確認ページでユーザーが確定させた住所（表示用の 1 行） */
	@IsOptional()
	@IsString()
	@Length(0, 500)
	address?: string;

	/** 確認ページでユーザーが確定させた国コード（ISO 3166-1 alpha-2） */
	@IsOptional()
	@IsString()
	@Length(2, 2)
	countryCode?: string;
}
