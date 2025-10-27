import { IsNotEmpty, IsString, IsUUID } from "class-validator";

/**
 * Impression エンドポイントのリクエストボディ
 */
export class DishMediaImpressionBodyDto {
	/** dish_media_impressions.id */
	@IsUUID()
	id!: string;

	/** セッションID */
	@IsNotEmpty()
	@IsString()
	session_id!: string;

	/** ソース（どこから来たか） */
	@IsNotEmpty()
	@IsString()
	source!: string;
}
