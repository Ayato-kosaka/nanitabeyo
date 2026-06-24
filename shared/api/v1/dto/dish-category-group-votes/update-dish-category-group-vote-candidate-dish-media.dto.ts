import { IsArray, IsUUID } from "class-validator";

/**
 * PATCH /v1/dish-category-group-votes/:sessionId/candidates/:candidateId/dish-media
 * のリクエストDTO。
 *
 * フロントが既存の dish_media 検索結果から最大5件を渡す。
 * 空配列は「検索済みだが0件」として保存する。
 * API は候補の dish_media_ids が NULL の場合だけ保存し、既に検索済みなら上書きしない。
 */
export class UpdateDishCategoryGroupVoteCandidateDishMediaDto {
	@IsArray()
	@IsUUID(undefined, { each: true })
	dishMediaIds!: string[];
}
