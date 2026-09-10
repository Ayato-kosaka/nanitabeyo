import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, IsPositive } from "class-validator";
import { Transform, Type } from "class-transformer";
import { MAX_SEARCH_RADIUS_M } from "../../../../utils/geo_search";

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

	/**
	 * 検索半径（m）。クライアントは «いま見えている viewport の外接円» を渡す。
	 *
	 * #1629 【設計】**上限で «引きすぎ» を止めない。** 上限は壊れた値を弾くためだけに置く
	 * （`MAX_SEARCH_RADIUS_M` = 地球の半周）。日本全体が映っていれば半径は 1,400km 級になるが、
	 * repository は «スポンサー枠 + KNN の近傍枠» で候補を先に limit 件へ絞るので、
	 * 半径が大きくても走る行数は増えない（restaurants.repository.ts の設計コメント）。
	 */
	@Type(() => Number)
	@IsNumber()
	@Min(1)
	@Max(MAX_SEARCH_RADIUS_M)
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
	 * 指定時は並び順が既定の**「投稿が多い順」**から**距離の近い順**へ切り替わる。
	 * 店名で絞った結果が投稿数で並ぶのは店舗選択 UI として不自然なため。
	 * （⚠️ #1629 で既定の並びが «入札額（total_cents）降順» から «投稿が多い順» へ変わっている。
	 * ここに «入札額順» と書いてあった記述は陳腐化していた。）
	 *
	 * ⚠️ **必ず `lat` / `lng` / `radius` の範囲内での検索である**（エリア外の店舗は出ない）。
	 * ただし **`q` を送るときのクライアントは «全国» を半径に入れる**（#1629。
	 * 店名を打つ人は «いま見えている範囲» ではなく «その名前の店» を探しているため。
	 * `app-expo` の `NAME_SEARCH_RADIUS_M` = 1,500km）。
	 * 「いま見ている地図の中から選ぶ」が当てはまるのは `q` を送らない近傍検索のほうである。
	 *
	 * ⚠️ **照合の形は «語の長さ» で変わる**（#1416 レビュー m-a / #1951）。pg_trgm は
	 * パターンからトライグラム（3 文字）を取り出せないと索引を使えないため、
	 * 「一蘭」「熊喜」のような 2 文字の**中間一致**は索引に乗らず、プランナが位置索引だけで
	 * 駆動して半径内の行をヒープから全部読んで捨てる（dev 実測で 17〜20 秒）。
	 *
	 * - **連続する語が 3 文字以上** … 中間一致（`%q%`）
	 * - **それ未満**（2 文字以下） … 前方一致（`q%`）と語頭一致（`% q%`）の OR
	 *
	 * ⚠️ #1416 の時点では「**エリア内検索なので破綻はしない**」と書いてあったが、
	 * #1629 で店名検索の半径を **全国**へ広げたときにその前提が外れ、本番で
	 * **20.34 秒**かかっていた（2026-09-09 実測）。判定の正は
	 * `api/src/v1/restaurants/restaurant-name-match-mode.ts` の 1 箇所だけ。
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
