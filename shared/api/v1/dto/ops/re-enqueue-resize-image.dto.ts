import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsOptional, IsUUID, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

/**
 * #514 一度に再 enqueue できる対象レコード数の上限。
 *
 * 全件再実行（本番で 47 万件超）を絶対に起こさないためのガード。
 * 対象は必ず recordId で明示指定させ、「全件」を表す入力は受け付けない。
 */
export const RE_ENQUEUE_RESIZE_IMAGE_MAX_TARGETS = 100;

/** 再 enqueue 対象の 1 レコード */
export class ReEnqueueResizeImageTargetDto {
	/** 対象テーブル */
	@IsIn(["restaurants", "dish_media", "users"])
	table!: "restaurants" | "dish_media" | "users";

	/** 対象カラム（table との組み合わせはサーバ側で検証する） */
	@IsIn(["image_path", "media_path", "thumbnail_path", "avatar_path"])
	column!: "image_path" | "media_path" | "thumbnail_path" | "avatar_path";

	/** 対象レコードの id */
	@IsUUID()
	recordId!: string;

	/**
	 * 再生成するサイズ。省略時は table/column ごとの既定サイズ一式。
	 * 特定サイズだけ失敗している場合に絞り込むために使う。
	 */
	@IsOptional()
	@IsArray()
	@ArrayNotEmpty()
	@IsIn([64, 256, 512, 1024], { each: true })
	sizes?: (64 | 256 | 512 | 1024)[];
}

/** POST /ops/resize-image/re-enqueue のボディ */
export class ReEnqueueResizeImageDto {
	/** 再 enqueue 対象。必ず明示指定（最大 100 件） */
	@IsArray()
	@ArrayNotEmpty()
	@ArrayMaxSize(RE_ENQUEUE_RESIZE_IMAGE_MAX_TARGETS)
	@ValidateNested({ each: true })
	@Type(() => ReEnqueueResizeImageTargetDto)
	targets!: ReEnqueueResizeImageTargetDto[];
}
