import { IsEnum, IsOptional, IsString, IsUUID } from "class-validator";

/**
 * クライアントがアップロード済みの
 * GCS/S3 オブジェクトを参照するタイプ。
 */
export enum MediaType {
	IMAGE = "IMAGE",
	VIDEO = "VIDEO",
}

export class CreateDishMediaDto {
	/** 紐付ける料理 (dishes.id) */
	@IsUUID()
	dishId!: string;

	/** オブジェクトストレージのキー（例: gs://bucket/path.jpg） */
	@IsString()
	mediaPath!: string;

	/** メディア種別 */
	@IsEnum(MediaType)
	mediaType!: MediaType;

	/** サムネイルパス（VIDEO の場合は必須、IMAGE の場合は省略可） */
	@IsOptional()
	@IsString()
	thumbnailPath?: string;
}
