import { IsNotEmpty, IsString, IsUUID } from "class-validator";

/**
 * Impression エンドポイントのパスパラメータ
 */
export class DishMediaImpressionParamsDto {
	/** dish_media.id */
	@IsUUID()
	id!: string;
}

/**
 * Impression エンドポイントのリクエストボディ
 */
export class DishMediaImpressionBodyDto {
	/** セッションID */
	@IsNotEmpty()
	@IsString()
	session_id!: string;

	/** ソース（どこから来たか） */
	@IsNotEmpty()
	@IsString()
	source!: string;
}
