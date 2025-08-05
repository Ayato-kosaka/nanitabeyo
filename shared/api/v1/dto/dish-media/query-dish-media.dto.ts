// libs/api-contracts/src/v1/dish-media/dto/query-dish-media.dto.ts

import { IsNumber, IsOptional, IsPositive, Max, Min, Matches, IsUUID } from "@nestjs/class-validator";
import { Type } from "@nestjs/class-transformer";

/**
 * Query parameters accepted by **GET /v1/dish-media**.
 *
 * - 変換は class-transformer (@Type) で自動的に JS Number へ
 * - バリデーションは class-validator だけに依存
 * - Nest / Prisma と完全分離 ⇒ どのランタイムでも再利用可
 */
export class QueryDishMediaDto {
	/**
	 * 緯度経度（WGS-84）を `"lat,lng"` 形式で指定
	 *   - Latitude  ‐90 〜 +90
	 *   - Longitude ‐180 〜 +180
	 *
	 * @example "35.68944,139.69167"
	 */
	@Matches(/^-?\d{1,2}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?$/, { message: 'location must be "lat,lng" decimal format' })
	readonly location!: string;

	/**
	 * 検索半径（メートル）
	 * min = 10 / max = 5 000 / default = 1 000（Controller 側で補完）
	 */
	@Type(() => Number)
	@IsNumber()
	@Min(10)
	@Max(5000)
	readonly radius!: number;

	/**
	 * 絞り込み用ディッシュカテゴリ ID（UUID）
	 * 省略時は全カテゴリ
	 */
	@IsOptional()
	@IsUUID()
	readonly categoryId?: string;

	/**
	 * 返却件数（ページサイズ）
	 * min = 1 / max = 100 / default = 20
	 */
	@IsOptional()
	@Type(() => Number)
	@IsPositive()
	@Min(1)
	@Max(100)
	readonly limit?: number;

	/**
	 * 前ページから渡されるカーソル
	 */
	@IsOptional()
	readonly cursor?: string;

	/**
	 * 並び順
	 * - "createdAt"  → 古い順
	 * - "-createdAt" → 新しい順（デフォルト）
	 * - "distance"   → 近い順
	 */
	@IsOptional()
	@Matches(/^-?(createdAt|distance)$/)
	readonly sort?: string;
}
