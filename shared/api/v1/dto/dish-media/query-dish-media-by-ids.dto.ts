import { Transform } from "class-transformer";
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from "class-validator";

/**
 * Query parameters accepted by **GET /v1/dish-media?ids=...**.
 * Accepts comma-separated or repeated `ids` parameters and preserves order.
 */
export class QueryDishMediaByIdsDto {
	@Transform(({ value }) => {
		if (Array.isArray(value)) {
			return value.flatMap((v) => v.split(","));
		}
		if (typeof value === "string") {
			return value.split(",");
		}
		return [];
	})
	@IsArray()
	@ArrayNotEmpty()
	/**
	 * #1599 上限が無いと `?ids=` に 10,000 件の UUID を並べるだけで
	 * `WHERE id IN (...)` が 10,000 件になり、さらに後続のレビュー取得・
	 * リアクション集計も同じサイズで走る（1 リクエストで DB を潰せる）。
	 *
	 * 100 は `SearchDishMediaDto.limit` の `@Max(100)` に合わせた値。
	 * 実際のクライアントは 1 ページぶん（`MY_DISHES_PAGE_SIZE = 42`）しか送らないので、
	 * 正規の利用は十分に収まる。
	 */
	@ArrayMaxSize(100)
	@IsUUID(undefined, { each: true })
	readonly ids!: string[];
}
