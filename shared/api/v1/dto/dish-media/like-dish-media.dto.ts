import { IsUUID } from '@nestjs/class-validator';

/**
 * 「いいね」エンドポイントのパスパラメータ。
 * Body は存在しないためパラメータ DTO のみ定義。
 */
export class LikeDishMediaParamsDto {
    /** dish_media.id */
    @IsUUID()
    id!: string;

    /** users.id  (通常は `me` エイリアスにマッピングされる) */
    @IsUUID()
    userId!: string;
}
