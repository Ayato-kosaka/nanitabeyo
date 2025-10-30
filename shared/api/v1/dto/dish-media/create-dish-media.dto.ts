import { IsIn, IsInt, IsString, IsUUID, Min, ValidateIf } from "class-validator";

export class CreateDishMediaDto {
	/** 紐付ける料理 (dishes.id) */
	@IsUUID()
	dishId!: string;

	/** オブジェクトストレージのキー（例: gs://bucket/path.jpg） */
	@IsString()
	mediaPath!: string;

	/** メディア種別 */
	@IsIn(["image", "video"])
	mediaType!: "image" | "video";

	/** サムネイルパス（必須。IMAGE の場合は mediaPath と同じ値を渡す） */
	@IsString()
	thumbnailPath!: string;

	/** 動画の長さ（ミリ秒単位）。mediaType が video の場合に必須 */
	@ValidateIf((o) => o.mediaType === "video")
	@IsInt()
	@Min(0)
	videoDurationMs?: number;
}
