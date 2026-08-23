import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export const DishCategoryGroupVoteReactions = ["like", "dislike"] as const;
export type DishCategoryGroupVoteReaction = (typeof DishCategoryGroupVoteReactions)[number];

/**
 * 候補1件に対する投票DTO。
 *
 * candidateId が同一 session に属することは API 側で検証する。
 * deleted_at は投票中の候補削除レースを許容するため、送信時には問わない。
 */
export class SubmitDishCategoryGroupVoteItemDto {
	@IsUUID()
	candidateId!: string;

	@IsIn(DishCategoryGroupVoteReactions)
	reaction!: DishCategoryGroupVoteReaction;
}

/**
 * POST /v1/dish-category-group-votes/:sessionId/vote のリクエストDTO。
 *
 * displayName の最大8文字制限はフロントで担保する。
 * votes.length と未削除候補数の一致は、候補削除とのタイミング障害を避けるため
 * API では検証しない。
 */
export class SubmitDishCategoryGroupVoteDto {
	@IsString()
	@IsNotEmpty()
	displayName!: string;

	@IsOptional()
	@IsString()
	comment?: string;

	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => SubmitDishCategoryGroupVoteItemDto)
	votes!: SubmitDishCategoryGroupVoteItemDto[];
}
