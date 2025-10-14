import { IsEnum, IsIn, IsOptional, IsString, IsUUID } from "class-validator";

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
}
