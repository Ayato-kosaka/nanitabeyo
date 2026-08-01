// libs/api-contracts/src/v1/dish-media/dto/search-dish-media.dto.ts

import {
	IsNumber,
	IsOptional,
	IsPositive,
	Max,
	Min,
	Matches,
	IsUUID,
	IsString,
	IsArray,
	ArrayMaxSize,
} from "class-validator";
import { Type, Transform } from "class-transformer";
import { BCP47_LANGUAGE_TAG_PATTERN } from "../../../../utils/languageCode";

/**
 * Query parameters accepted by **GET /v1/dish-media/search**.
 *
 * - 変換は class-transformer (@Type) で自動的に JS Number へ
 * - バリデーションは class-validator だけに依存
 * - Nest / Prisma と完全分離 ⇒ どのランタイムでも再利用可
 */
export class SearchDishMediaDto {
	/**
	 * 緯度経度（WGS-84）を `"lat,lng"` 形式で指定
	 *   - Latitude  ‐90 〜 +90
	 *   - Longitude ‐180 〜 +180
	 *
	 * @example "35.68944,139.69167"
	 */
	@IsString()
	@Matches(/^-?\d{1,2}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?$/, { message: 'location must be "lat,lng" decimal format' })
	location!: string;

	/**
	 * 検索半径（メートル）
	 * min = 10 / max = 20 000
	 */
	@Type(() => Number)
	@IsNumber()
	@Min(10)
	@Max(20000)
	radius!: number;

	/**
	 * 絞り込み用ディッシュカテゴリ ID
	 */
	@IsString()
	categoryId!: string;

	/**
	 * 返却件数（ページサイズ）
	 * min = 1 / max = 100
	 */
	@IsOptional()
	@Type(() => Number)
	@IsPositive()
	@Min(1)
	@Max(100)
	limit?: number;

	/**
	 * レビュー表示で優先する元言語コードを、優先度の高い順に並べたリスト。
	 *
	 * #817 【設計】優先順位は「端末言語 → 検索地点の言語 → その他」。
	 * レビューは読んで意思決定するためのテキストなので、まず読める言語(端末言語)を
	 * 優先する。ただし現地レビューの在庫が薄いため、フィルタではなく並び替えとして
	 * 適用し、不足分は検索地点の言語・その他の言語で埋める。
	 *
	 * GET のクエリ文字列としてはカンマ区切りで受け取る。
	 *
	 * @example ["ja", "ja"]
	 */
	@IsOptional()
	@Transform(({ value }) =>
		// GET なので "ja,en" 形式の文字列でも配列でも受け取れるようにする
		typeof value === "string" ? value.split(",").filter(Boolean) : value,
	)
	@IsArray()
	@ArrayMaxSize(5)
	@IsString({ each: true })
	@Matches(BCP47_LANGUAGE_TAG_PATTERN, {
		each: true,
		message: "preferredLanguageCodes must follow IETF BCP 47 format (e.g., en, ja, zh-Hant)",
	})
	preferredLanguageCodes?: string[];

	// /**
	//  * 前ページから渡されるカーソル
	//  */
	// @IsString()
	// @IsOptional()
	// cursor?: string;

	// /**
	//  * 並び順
	//  * - "createdAt"  → 古い順
	//  * - "-createdAt" → 新しい順（デフォルト）
	//  * - "distance"   → 近い順
	//  */
	// @IsString()
	// @IsOptional()
	// @Matches(/^-?(createdAt|distance)$/)
	// sort?: string;
}
