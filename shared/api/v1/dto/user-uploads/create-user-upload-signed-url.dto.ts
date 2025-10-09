import { IsString } from "class-validator";

/** POST /v1/user-uploads/signed-url のボディ */
export class CreateUserUploadSignedUrlDto {
	/** MIME タイプ (例: image/png, video/mp4) */
	@IsString()
	mimeType!: string;

	/** ファイル名のベース部分 (拡張子なし) */
	@IsString()
	baseFileName!: string;
}
