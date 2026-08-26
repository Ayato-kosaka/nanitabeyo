import { Transform, Type } from "class-transformer";
import {
	ArrayMaxSize,
	IsArray,
	IsIn,
	IsISO8601,
	IsInt,
	IsNumber,
	IsOptional,
	IsString,
	IsUUID,
	Max,
	Matches,
	MaxLength,
	Min,
	ValidateIf,
} from "class-validator";
import { IsParsableDateString } from "../is-parsable-date-string";

/**
 * #1395 my-dishes（食べたい/食べた）の状態。
 *
 * 状態は永続化せず**導出**する（#1375 設計の正本 §2）:
 * - `eaten`: その dish に自分の `dish_reviews` がある
 * - `want` : その dish に自分の `dish_reviews` が無く、`reactions`(save, dish_media) だけがある
 *
 * 「食べたい → 食べた」の遷移で save reaction は削除しない（食べたい登録日を保持するため）。
 */
export const MY_DISH_STATUSES = ["want", "eaten"] as const;
export type MyDishStatus = (typeof MY_DISH_STATUSES)[number];

/**
 * #1395 my-dishes の並び順。
 *
 * - `-occurredAt` / `occurredAt`: 発生日時（eaten=レビュー日 / want=保存日）
 * - `-rating`     : 評価の高い順。**want 行は評価を持たないので必ず末尾に来る**
 * - `distance`    : 近い順。`lat` / `lng` / `radius` が必須
 * - `-featureScore`:
 *      既存 `dish_category_features` の連続値スコアの高い順。`featureKeys` が必須。
 *      #1375 の追補どおり、時間帯・誰と行く・価格帯・食事にかける時間・系統は
 *      **絞り込みではなく並び替え**として提供する（連続値なので絞り込みには使えない）。
 *
 *      #1375 実機確認: 以前は軸ごとに `-sceneScore` / `-timeSlotScore` という別々の sort を
 *      置いていたが、sort は 1 つしか選べないので「夜ご飯 × 友達と × サクッと」のように
 *      軸を重ねられなかった。軸を `featureKeys`（複数）へ移し、sort 値は 1 つに畳んである。
 *      複数指定した場合は **スコアの合計**の高い順になる。
 */
export const MY_DISH_SORTS = ["-occurredAt", "occurredAt", "-rating", "distance", "-featureScore"] as const;
export type MyDishSort = (typeof MY_DISH_SORTS)[number];

/**
 * `featureKeys` に指定できる軸（`dish_category_features.feature_type`）。
 *
 * 値は既存の推薦（`dish-categories.repository.ts`）が使っている feature_type と同じもので、
 * ここで新しい特徴量を作ってはいない。検索画面の選択肢がそのまま対応する:
 *
 * | 軸 | 検索画面の項目 | キーの例 |
 * | --- | --- | --- |
 * | `timeSlot` | 時間帯 | `morning` / `lunch` / `dinner` / `late_night` |
 * | `scene` | 誰と行く | `solo` / `date` / `friends` / `family` / `drinking` |
 * | `budget_intent` | 価格帯 | `inexpensive` / `moderate` / `expensive` / `very_expensive` |
 * | `dining_pace` | 食事にかける時間 | `quick` / `leisurely` |
 * | `taste` | どんな系統 | `sweet` / `spicy` / `healthy` / `junk` |
 * | `core_ingredient` | どんな系統 | `meat` / `fish` / `rice` / `noodle` |
 */
export const MY_DISH_FEATURE_TYPES = [
	"timeSlot",
	"scene",
	"budget_intent",
	"dining_pace",
	"taste",
	"core_ingredient",
] as const;
export type MyDishFeatureType = (typeof MY_DISH_FEATURE_TYPES)[number];

/** `featureKeys` の 1 要素。`"<feature_type>:<feature_key>"` の形 */
export const MY_DISH_FEATURE_KEY_PATTERN = /^[A-Za-z_]{1,32}:[A-Za-z0-9_-]{1,64}$/;

/** `"timeSlot:dinner"` → `{ featureType, featureKey }`。形が違えば null */
export const parseMyDishFeatureKey = (value: string): { featureType: MyDishFeatureType; featureKey: string } | null => {
	if (!MY_DISH_FEATURE_KEY_PATTERN.test(value)) return null;
	const separator = value.indexOf(":");
	const featureType = value.slice(0, separator);
	const featureKey = value.slice(separator + 1);
	if (!(MY_DISH_FEATURE_TYPES as readonly string[]).includes(featureType)) return null;
	return { featureType: featureType as MyDishFeatureType, featureKey };
};

/** GET query の repeated / comma-separated の両形式を string[] に正規化する */
const normalizeCsvStringArray = () =>
	Transform(({ value }) => {
		if (value === undefined || value === null) return undefined;
		const values = Array.isArray(value) ? value : [value];
		const normalized = values
			.flatMap((v) => (typeof v === "string" ? v.split(",") : [v]))
			.filter((v): v is string => typeof v === "string")
			.map((v) => v.trim())
			.filter((v) => v !== "" && v.toLowerCase() !== "undefined" && v.toLowerCase() !== "null");
		return normalized.length > 0 ? normalized : undefined;
	});

/** GET query の repeated / comma-separated の両形式を number[] に正規化する */
const normalizeCsvNumberArray = () =>
	Transform(({ value }) => {
		if (value === undefined || value === null) return undefined;
		const values = Array.isArray(value) ? value : [value];
		const normalized = values
			.flatMap((v) => (typeof v === "string" ? v.split(",") : [v]))
			.map((v) => (typeof v === "string" ? v.trim() : v))
			.filter((v) => v !== "" && v !== undefined && v !== null)
			.map((v) => Number(v));
		return normalized.length > 0 ? normalized : undefined;
	});

/**
 * #1395 GET /v1/users/me/dishes と GET /v1/users/me/dishes/map-pins が**共有する**クエリ契約。
 *
 * Map / リスト / Calendar の 3 ビューは同一のフィルタ状態を共有する（#1375 §3）ため、
 * クエリ契約は 1 つで、投影（ページングされた一覧 / 店舗ピン）だけが 2 種類である。
 *
 * ## 契約上の注意
 *
 * - **評価フィルタ（`minRating` / `ratings`）は `want` 行を必ず全消しする。**
 *   want 行は評価を持たない（`rating` が無い）ためである。
 *   クライアントは **`status` に `want` を含む間、評価フィルタを不活性にする**こと（#1395 m-4）。
 *   サーバは評価フィルタが指定されたとき want 枝を評価せず、`eaten` のみを返す。
 * - **`-rating` ソート時、want 行は末尾に置く**（#1395 B-1）。
 * - **ブロック（`reactions` の `action_type='block'`）は効かせない。**
 *   ブロックは「勧めてくるな」であって「自分の記録を消せ」ではない（#1395 m-6）。
 */
export class QueryMyDishesDto {
	/** 状態（multi）。未指定 = 両方。`?status=want,eaten` でも `?status=want&status=eaten` でも受ける */
	@IsOptional()
	@normalizeCsvStringArray()
	@IsArray()
	@IsIn(MY_DISH_STATUSES, { each: true })
	status?: MyDishStatus[];

	/**
	 * エリア（中心緯度）。`lat` / `lng` / `radius` は 3 点セットで、部分指定は 400 にする。
	 * `sort=distance` のときも必須。
	 */
	@ValidateIf((o) => o.lng !== undefined || o.radius !== undefined || o.sort === "distance")
	@Type(() => Number)
	@IsNumber()
	@Min(-90)
	@Max(90)
	lat?: number;

	/** エリア（中心経度） */
	@ValidateIf((o) => o.lat !== undefined || o.radius !== undefined || o.sort === "distance")
	@Type(() => Number)
	@IsNumber()
	@Min(-180)
	@Max(180)
	lng?: number;

	/** エリア（半径 m）。viewport は「中心座標 + 対角線の半分」へクライアントで変換する */
	@ValidateIf((o) => o.lat !== undefined || o.lng !== undefined || o.sort === "distance")
	@Type(() => Number)
	@IsNumber()
	@Min(10)
	@Max(50000)
	radius?: number;

	/** 料理カテゴリ（multi）= `dishes.category_id`（Wikidata QID などの TEXT） */
	@IsOptional()
	@normalizeCsvStringArray()
	@IsArray()
	@ArrayMaxSize(50)
	@IsString({ each: true })
	categoryIds?: string[];

	/** ★n 以上。`ratings` と併用したときは AND */
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(5)
	minRating?: number;

	/** ★n のみ（multi）。`minRating` と併用したときは AND */
	@IsOptional()
	@normalizeCsvNumberArray()
	@IsArray()
	@ArrayMaxSize(5)
	@IsInt({ each: true })
	@Min(1, { each: true })
	@Max(5, { each: true })
	ratings?: number[];

	/** `occurredAt` の下限（Calendar の月窓 / 期間絞り込み）。境界を含む */
	@IsOptional()
	// #1599 strict は «実在しない日付»（2026-02-30）を弾き、
	// IsParsableDateString は «new Date() が解釈できない形»（2026-W01 / 20260826）を弾く。
	// 下の rangeFilter が new Date(dto.from) をそのままクエリへ載せるので、両方要る。
	@IsISO8601({ strict: true })
	@IsParsableDateString()
	from?: string;

	/** `occurredAt` の上限。境界を含む */
	@IsOptional()
	@IsISO8601({ strict: true })
	@IsParsableDateString()
	to?: string;

	/** 並び順。既定は `-occurredAt` */
	@IsOptional()
	@IsIn(MY_DISH_SORTS)
	sort?: MyDishSort;

	/**
	 * 並び替えに使う特徴量の軸（`"<feature_type>:<feature_key>"` の配列）。
	 * 例: `["timeSlot:dinner", "scene:friends", "dining_pace:quick"]`。
	 *
	 * **絞り込みではなく並び替えにのみ使う**。複数指定するとスコアの合計順になる。
	 * `sort=-featureScore` のときは 1 件以上必須。未知の `feature_type` は 400 にする
	 * （黙って無視すると「選んだのに並びが変わらない」になるため）。
	 */
	@ValidateIf((o) => o.sort === "-featureScore" || o.featureKeys !== undefined)
	@normalizeCsvStringArray()
	@IsArray()
	@ArrayMaxSize(MY_DISH_FEATURE_TYPES.length)
	@IsString({ each: true })
	@MaxLength(97, { each: true })
	@Matches(MY_DISH_FEATURE_KEY_PATTERN, { each: true })
	// `feature_type` が既知かどうかまではここでは見ない（class-validator に列挙を渡せる形ではない）。
	// 判定は `parseMyDishFeatureKey` に一本化してあり、クエリ組み立て側が未知の軸を 400 にする
	featureKeys?: string[];

	/**
	 * #1397 店舗で絞る。Map のピン（`MyDishPin`）をタップして開く料理メディア Sheet 専用。
	 *
	 * `MyDishPin` は店舗単位で `dish_media.id` を持たない（`users.response.ts` の `MyDishPin`）ため、
	 * Sheet は「その店舗の自分の記録」をここで引き直す。
	 *
	 * ⚠️ **これは共有フィルタ（#1396 の `useMyDishesFilterStore`）に入れてはいけない。**
	 * 3 ビューが共有するフィルタへ店舗を混ぜると、Sheet を開いた瞬間に一覧・Map まで
	 * 1 店舗に絞られる。クライアントは Sheet 用の派生クエリとしてのみ付与すること。
	 *
	 * `map-pins` では無視される（400 にはしない。共有 DTO に片側だけの必須／禁止を持ち込まない）。
	 */
	@IsOptional()
	@IsUUID()
	restaurantId?: string;

	/**
	 * keyset カーソル。`sort` ごとに構成要素が変わる（`MyDishCursor` 参照）。
	 * offset ページングは追記中に行がずれるため使わない。
	 */
	@IsOptional()
	@IsString()
	@MaxLength(256)
	cursor?: string;

	/** ページサイズ。既定 42（既存の `findDishReviewsByUser` / `findDishMediaBySavedUser` に合わせた） */
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	limit?: number;
}
