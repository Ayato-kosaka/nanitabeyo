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
	Max,
	MaxLength,
	Min,
	ValidateIf,
} from "class-validator";

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
 * - `-sceneScore` / `-timeSlotScore`:
 *      既存 `dish_category_features`（`feature_type='scene'` / `'timeSlot'`）の
 *      連続値スコアの高い順。#1375 の追補どおり、シチュエーション・時間帯は
 *      **絞り込みではなく並び替え**として提供する（連続値なので絞り込みには使えない）。
 *      それぞれ `sceneKey` / `timeSlotKey` が必須。
 */
export const MY_DISH_SORTS = ["-occurredAt", "occurredAt", "-rating", "distance", "-sceneScore", "-timeSlotScore"] as const;
export type MyDishSort = (typeof MY_DISH_SORTS)[number];

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
	@IsISO8601()
	from?: string;

	/** `occurredAt` の上限。境界を含む */
	@IsOptional()
	@IsISO8601()
	to?: string;

	/** 並び順。既定は `-occurredAt` */
	@IsOptional()
	@IsIn(MY_DISH_SORTS)
	sort?: MyDishSort;

	/**
	 * `sort=-sceneScore` のときのシーン（`dish_category_features.feature_key`）。
	 * 例: 'date' / 'family' / 'solo'。**絞り込みではなく並び替えにのみ使う**
	 */
	@ValidateIf((o) => o.sort === "-sceneScore" || o.sceneKey !== undefined)
	@IsString()
	@MaxLength(64)
	sceneKey?: string;

	/**
	 * `sort=-timeSlotScore` のときの時間帯（`dish_category_features.feature_key`）。
	 * 例: 'lunch' / 'dinner' / 'late_night'。**絞り込みではなく並び替えにのみ使う**
	 */
	@ValidateIf((o) => o.sort === "-timeSlotScore" || o.timeSlotKey !== undefined)
	@IsString()
	@MaxLength(64)
	timeSlotKey?: string;

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
