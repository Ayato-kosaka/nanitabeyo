import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, IsPositive } from "class-validator";
import { Transform, Type } from "class-transformer";

/** GET /v1/restaurants/search のクエリ */
export class QueryRestaurantsDto {
	@Type(() => Number)
	@IsNumber()
	@Min(-90)
	@Max(90)
	lat!: number;

	@Type(() => Number)
	@IsNumber()
	@Min(-180)
	@Max(180)
	lng!: number;

	@Type(() => Number)
	@IsNumber()
	radius!: number;

	/**
	 * 返却件数（ページサイズ）
	 * min = 1 / max = 100
	 */
	@IsOptional()
	@Type(() => Number)
	@IsPositive()
	@Min(1)
	@Max(100)
	readonly limit?: number;

	@IsOptional()
	@IsString()
	cursor?: string;

	/**
	 * #1395 店名の部分一致検索。
	 *
	 * 自前 `restaurants` テーブルに対する検索であり、**Google Places Text Search /
	 * Autocomplete は一切呼ばない**（#1375 設計の正本 §5）。
	 * `restaurants.name` の pg_trgm GIN 索引（`idx_restaurants_name_trgm`）で中間一致を引く。
	 *
	 * 指定時は並び順が既定の「入札額（total_cents）降順」から**距離の近い順**へ切り替わる。
	 * 店名で絞った結果が入札額で並ぶのは店舗選択 UI として不自然なため。
	 *
	 * ⚠️ **必ず `lat` / `lng` / `radius` の範囲内での検索である**（エリア外の店舗は出ない）。
	 * 店舗選択 UI が「いま見ている地図の中から選ぶ」ものなのでこの仕様にしている。
	 *
	 * ⚠️ **2 文字以下の店名では索引が効かない**（#1416 レビュー m-a）。pg_trgm は
	 * パターンからトライグラム（3 文字）を取り出せないと索引を使えないため、
	 * 「一蘭」「熊喜」のような 2 文字の指定は `restaurants` の seq scan になる。
	 * エリア内検索なので破綻はしないが、3 文字以上のほうが速い。
	 *
	 * `restaurants.name` は Google Place Details の `displayName.text` を 1 言語ぶんだけ
	 * 保持しており、別名・英語名・カナ表記のテーブルは無い。ヒットしない場合は
	 * 既存の「Map の POI タップ → Place Details で新規作成」導線へフォールバックする。
	 */
	@IsOptional()
	@Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
	@IsString()
	@MaxLength(64)
	q?: string;
}
