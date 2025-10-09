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

	/** サムネイルパス（必須。IMAGE の場合は mediaPath と同じ値を渡す） */
	@IsString()
	thumbnailPath!: string;
}
