import { Type } from "class-transformer";
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

/** #843 Maps Embed API がサポートするモード。それ以外は使わない（検索 / 単一店舗） */
export const MAPS_EMBED_MODES = ["search", "place"] as const;
export type MapsEmbedMode = (typeof MAPS_EMBED_MODES)[number];

/**
 * POST /v1/maps/embed-token のボディ。
 *
 * #1810 PL レビュー: WebView / iframe は URL を「文書として」読むので Authorization
 * ヘッダを付けられない。そのため mode/q/center/zoom/hl は認証必須のこのエンドポイントで
 * 短命の署名付きトークンへ変換し、認証不要な GET /v1/maps/embed へはそのトークンだけを渡す。
 */
export class CreateMapsEmbedTokenDto {
	@IsIn(MAPS_EMBED_MODES)
	mode!: MapsEmbedMode;

	/**
	 * `mode=search` なら検索語、`mode=place` なら `place_id:<google_place_id>`。
	 * そのまま Maps Embed API の `q` パラメータへ渡す。
	 */
	@IsString()
	@IsNotEmpty()
	@MaxLength(200)
	q!: string;

	/** `"<lat>,<lng>"` 形式。省略時は Maps Embed API 側の既定（q から自動推定）に任せる */
	@IsOptional()
	@Matches(/^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/)
	center?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	@Max(21)
	zoom?: number;

	/** 表示言語（例: "ja"）。省略時は Maps Embed API の既定 */
	@IsOptional()
	@IsString()
	@MaxLength(10)
	hl?: string;
}
