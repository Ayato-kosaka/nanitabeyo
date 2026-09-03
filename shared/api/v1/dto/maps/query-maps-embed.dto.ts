import { Type } from "class-transformer";
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

/** #843 Maps Embed API がサポートするモード。それ以外は使わない（検索 / 単一店舗） */
export const MAPS_EMBED_MODES = ["search", "place"] as const;
export type MapsEmbedMode = (typeof MAPS_EMBED_MODES)[number];

/** GET /v1/maps/embed のクエリ */
export class QueryMapsEmbedDto {
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
