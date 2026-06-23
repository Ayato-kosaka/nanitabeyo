import { IsArray, IsNotEmpty, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

/**
 * グループ投票候補の作成DTO。
 *
 * dish_media_ids は開始時点では保存しない。
 * 店舗提案を初めて開いたタイミングで、別APIから候補ごとにキャッシュする。
 */
export class CreateDishCategoryGroupVoteCandidateDto {
	/** 投票対象の dish_categories.id */
	@IsString()
	@IsNotEmpty()
	dishCategoryId!: string;

	/** 投票作成時点で固定する表示名 */
	@IsString()
	@IsNotEmpty()
	displayName!: string;

	/** 投票作成時点で固定する画像URL */
	@IsString()
	@IsNotEmpty()
	imageUrl!: string;
}

/**
 * POST /v1/dish-category-group-votes のリクエストDTO。
 *
 * 候補数の 3-6 件制約はUI仕様として扱い、API/DBでは強制しない。
 * display_order は body から受け取らず、API が candidates の配列順で採番する。
 */
export class CreateDishCategoryGroupVoteDto {
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CreateDishCategoryGroupVoteCandidateDto)
	candidates!: CreateDishCategoryGroupVoteCandidateDto[];
}
