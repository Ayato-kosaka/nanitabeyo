import { IsOptional, IsString, Matches, MaxLength, ValidateIf } from "class-validator";

/**
 * POST /v1/users/me のリクエストボディ
 * プロフィール情報（display_name, bio, avatar_path）を更新する
 */
export class UpdateUserProfileDto {
	@IsOptional()
	@IsString()
	@MaxLength(100)
	display_name?: string | null;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	bio?: string | null;

	/**
	 * GCS にアップロード済みの原本画像パス（一時領域からの移動対象）
	 * 例：`uploads/tmp/user-uploads/{userId}/{mimeType}/{uuid}.jpg`
	 */
	@IsOptional()
	@IsString()
	@MaxLength(500)
	avatar_path?: string | null;

	@IsOptional()
	@IsString()
	@Matches(/^[a-z]{2,3}(-[A-Z]{2})?$/, {
		message: "languageTag must follow IETF BCP 47 format (e.g., en-US, ja-JP, fr-CA)",
	})
	preferred_locale?: string;
}
