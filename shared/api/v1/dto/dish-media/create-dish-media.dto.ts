import { IsEnum, IsString, IsUUID } from '@nestjs/class-validator';

/**
 * クライアントがアップロード済みの
 * GCS/S3 オブジェクトを参照するタイプ。
 */
export enum MediaType {
    IMAGE = 'IMAGE',
    VIDEO = 'VIDEO',
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
}
