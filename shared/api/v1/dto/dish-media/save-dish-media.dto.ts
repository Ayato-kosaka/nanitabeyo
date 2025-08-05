import { IsUUID } from '@nestjs/class-validator';

/**
 * 「保存」エンドポイントのパスパラメータ。
 * Like と分けておくと将来 Body や Query を
 * 拡張しやすい。
 */
export class SaveDishMediaParamsDto {
    /** dish_media.id */
    @IsUUID()
    id!: string;

    /** users.id */
    @IsUUID()
    userId!: string;
}
