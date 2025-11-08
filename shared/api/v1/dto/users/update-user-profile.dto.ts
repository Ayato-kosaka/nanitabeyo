import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * POST /v1/users/:id のリクエストボディ
 * プロフィール情報（display_name, bio, avatar_path）を更新する
 */
export class UpdateUserProfileDto {
	@IsOptional()
	@IsString()
	@MaxLength(100)
	display_name?: string;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	bio?: string;

	/**
	 * GCS にアップロード済みの原本画像パス（一時領域からの移動対象）
	 * 例：`uploads/tmp/user-uploads/{userId}/{mimeType}/{uuid}.jpg`
	 */
	@IsOptional()
	@IsString()
	@MaxLength(500)
	avatar_path?: string;

	@IsOptional()
	@IsString()
	@MaxLength(100)
	preferred_locale?: string;
}
