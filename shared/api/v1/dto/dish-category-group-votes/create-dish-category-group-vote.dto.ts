import { IsArray, IsNotEmpty, IsNumber, IsString, Max, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

/**
 * 店舗提案用 dish_media 検索に必要な位置情報。
 *
 * 共有リンクを直接開いたゲストは検索画面の params を持たないため、
 * 投票作成時点の位置を session に固定しておく。
 */
export class DishCategoryGroupVoteSearchLocationDto {
	@IsNumber()
	@Min(-90)
	@Max(90)
	latitude!: number;

	@IsNumber()
	@Min(-180)
	@Max(180)
	longitude!: number;
}

/**
 * 店舗提案用 dish_media 検索条件のスナップショット。
 *
 * 候補 dish_media_ids は開始時点では保存しないが、検索条件は開始時点で保存する。
 * これにより、ホストが画面を閉じた後でも、任意の参加者が同じ条件で
 * 初回「店を見る」を実行して dish_media_ids をキャッシュできる。
 */
export class DishCategoryGroupVoteSearchContextDto {
	@ValidateNested()
	@Type(() => DishCategoryGroupVoteSearchLocationDto)
	location!: DishCategoryGroupVoteSearchLocationDto;

	@Type(() => Number)
	@IsNumber()
	@Min(10)
	@Max(20000)
	radius!: number;

	@IsArray()
	@IsString({ each: true })
	priceLevels!: string[];

	@IsString()
	@IsNotEmpty()
	localLanguageCode!: string;
}

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
	@ValidateNested()
	@Type(() => DishCategoryGroupVoteSearchContextDto)
	searchContext!: DishCategoryGroupVoteSearchContextDto;

	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CreateDishCategoryGroupVoteCandidateDto)
	candidates!: CreateDishCategoryGroupVoteCandidateDto[];
}
