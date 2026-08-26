import { ArrayMaxSize, IsArray, IsUUID } from "class-validator";

/**
 * PATCH /v1/dish-category-group-votes/:sessionId/candidates/:candidateId/dish-media
 * のリクエストDTO。
 *
 * フロントが既存の dish_media 検索結果から最大5件を渡す。
 * 空配列は「検索済みだが0件」として保存する。
 * API は候補の dish_media_search_status が not_searched の場合だけ保存し、
 * 既に検索済みなら上書きしない。
 */
export class UpdateDishCategoryGroupVoteCandidateDishMediaDto {
	@IsArray()
	/**
	 * #1599 上限が無いと大量の UUID を送り込めて `filterLiveDishMediaIds` の
	 * `IN` 句が膨らむ。上のコメントが言う «最大5件» はどこでも検証されていなかった。
	 *
	 * 20 は「文書化された 5 件に十分な余裕を持たせた DoS 上限」であって、
	 * 仕様上の件数ではない（仕様を変えたいならフロントと合わせて別途決める）。
	 */
	@ArrayMaxSize(20)
	@IsUUID(undefined, { each: true })
	dishMediaIds!: string[];
}
