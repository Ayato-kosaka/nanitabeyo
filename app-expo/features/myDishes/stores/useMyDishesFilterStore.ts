import { createWithEqualityFn } from "zustand/traditional";
import type { MyDishStatus, QueryMyDishesDto } from "@shared/api/v1/dto";

/**
 * #1396 my-dishes（食べたい/食べた）3 ビュー共有のフィルタ store。
 *
 * ## この store が持つもの / 持たないもの（設計書 (2/2) §3-1）
 *
 * 持つのは「**ユーザーが明示的に選んだもの**」だけである。
 * `cursor` / `limit` のようなページング要素はクエリ層（`useMyDishesQuery`）が組み立てる。
 * 混ぜると、フィルタが変わっていないのに `cursor` の変化で store が更新され、
 * 3 ビューが無駄に再レンダーする。
 *
 * ## ⚠️ Map の viewport（`Region`）は絶対に入れない（設計書 (2/2) §3-2 / §8-4 リスク2）
 *
 * pan / zoom は毎フレーム発火する。それをこの store に流すと `queryKey` が変わり続け、
 * 裏にいるリストと Calendar が**再取得され続ける**。相手は約 964MB の `dish_reviews`
 * （#1395 §0(A) の実測: 平均 4.48 秒 / 最大 11.23 秒）である。
 *
 * | 何 | どこに置く | 誰が更新する |
 * | --- | --- | --- |
 * | 生の viewport（`Region`） | `MyDishesMapView` 内の `useRef` | `onRegionChangeComplete` |
 * | 確定したエリア（`area`） | この store | 「このエリアで再検索」押下時の `commitArea` のみ |
 *
 * 既存 `select-restaurant.tsx` が `currentRegion` を `useRef` で持っている先例をそのまま踏襲する。
 * この不変条件は `__tests__/myDishesFilterStore.test.ts` が固定している。
 *
 * ## 永続化しない（設計書 (2/2) §3-4）
 *
 * `AsyncStorage` へ persist しない。再起動時に「なぜか★5だけ表示される」状態から
 * 始まるのは事故である。タブを離れて戻る間はメモリに残るので体感上の要求は満たす。
 */

/**
 * #1395 §4-3 の `MyDishStatus`（`"want" | "eaten"`）をそのまま使う。
 * フロント側で同じ union を書き直すと、API 契約が増えたときに黙って食い違うため再定義しない。
 */
export type { MyDishStatus };

export type MyDishesView = "map" | "list" | "calendar";

/**
 * 並び順。#1396 確定B により、時間帯・シチュエーションは**絞り込みではなく並び替え**として出す。
 * `-sceneScore` / `-timeSlotScore` は既存 `dish_category_features` の連続値スコア順（#1395 §4-3）。
 */
export type MyDishesSort = "-occurredAt" | "occurredAt" | "-rating" | "distance" | "-sceneScore" | "-timeSlotScore";

export const MY_DISHES_SORTS: readonly MyDishesSort[] = [
	"-occurredAt",
	"occurredAt",
	"-rating",
	"distance",
	"-sceneScore",
	"-timeSlotScore",
] as const;

/** 明示的に確定したエリア。Map の viewport そのものではない（§3-2） */
export type MyDishesArea = { lat: number; lng: number; radius: number; label?: string } | null;

export type MyDishesFilter = {
	/** [] = 両方（未指定と同義） */
	status: MyDishStatus[];
	categoryIds: string[];
	/** ★n 以上 */
	minRating: number | null;
	/** ★n のみ（multi） */
	ratings: number[];
	/** ISO8601 */
	from: string | null;
	to: string | null;
	area: MyDishesArea;
	sort: MyDishesSort;
	/** `sort === "-sceneScore"` のときのシーン（`dish_category_features.feature_key`） */
	sceneKey: string | null;
	/** `sort === "-timeSlotScore"` のときの時間帯（同上） */
	timeSlotKey: string | null;
};

export type MyDishesFilterStore = {
	filter: MyDishesFilter;
	/** 部分更新。呼び出し側で spread しない（取りこぼしを防ぐ） */
	patch: (partial: Partial<MyDishesFilter>) => void;
	/** 「このエリアで再検索」からのみ呼ぶ。Map の `onRegionChangeComplete` から呼んではいけない */
	commitArea: (area: MyDishesArea) => void;
	clearArea: () => void;
	reset: () => void;
};

export const DEFAULT_MY_DISHES_FILTER: MyDishesFilter = {
	status: [],
	categoryIds: [],
	minRating: null,
	ratings: [],
	from: null,
	to: null,
	area: null,
	sort: "-occurredAt",
	sceneKey: null,
	timeSlotKey: null,
};

/**
 * 評価フィルタ（`minRating` / `ratings`）が有効か。
 *
 * **`status` に `want` を含む間は不活性にする**（#1395 m-4）。want 行は `rating` を持たないため、
 * 評価フィルタを効かせると「食べたい」が全消しになる。`status: []`（= 両方）も want を含むので不活性。
 * 有効なのは `status` が `["eaten"]` のときだけである。
 */
export const isRatingFilterEnabled = (filter: MyDishesFilter): boolean =>
	filter.status.length > 0 && !filter.status.includes("want");

export const selectIsRatingFilterEnabled = (s: MyDishesFilterStore): boolean => isRatingFilterEnabled(s.filter);

/**
 * `sort` に必要な同伴パラメータが揃っているか検証し、揃っていなければ既定の `-occurredAt` へ落とす。
 *
 * `QueryMyDishesDto` は `sort=distance` に `lat/lng/radius` を、`-sceneScore` に `sceneKey` を、
 * `-timeSlotScore` に `timeSlotKey` を**必須**にしている。欠けたまま送ると 400 になるので、
 * クエリを組む前にここで吸収する（UI 側も選べないようにするが、store を直接叩かれても壊れないようにする）。
 */
export const resolveSort = (filter: MyDishesFilter): MyDishesSort => {
	switch (filter.sort) {
		case "distance":
			return filter.area ? "distance" : "-occurredAt";
		case "-sceneScore":
			return filter.sceneKey ? "-sceneScore" : "-occurredAt";
		case "-timeSlotScore":
			return filter.timeSlotKey ? "-timeSlotScore" : "-occurredAt";
		default:
			return filter.sort;
	}
};

/** `cursor` / `limit` を除いた、API へ送る実効クエリ。`useMyDishesQuery` がここに `cursor` / `limit` を足す */
export type MyDishesQueryParams = Omit<QueryMyDishesDto, "cursor" | "limit">;

/**
 * フィルタ（= ユーザーの選択）を API の実効クエリへ落とす。
 *
 * - 既定値（空配列 / null）は**キーごと落とす**。`?status=` のような空パラメータを作らない。
 * - 評価フィルタは不活性のとき落とす（`isRatingFilterEnabled`）。
 * - `sort` は同伴パラメータが揃っているものだけを送る（`resolveSort`）。
 */
export const toMyDishesQueryParams = (filter: MyDishesFilter): MyDishesQueryParams => {
	const sort = resolveSort(filter);
	const params: MyDishesQueryParams = {};

	if (filter.status.length > 0) {
		// 直列化を安定させるため常にソートしてから積む（["eaten","want"] と ["want","eaten"] を同一視する）
		params.status = [...filter.status].sort();
	}
	if (filter.categoryIds.length > 0) {
		params.categoryIds = [...filter.categoryIds].sort();
	}
	if (isRatingFilterEnabled(filter)) {
		if (filter.minRating !== null) params.minRating = filter.minRating;
		if (filter.ratings.length > 0) params.ratings = [...filter.ratings].sort((a, b) => a - b);
	}
	if (filter.from !== null) params.from = filter.from;
	if (filter.to !== null) params.to = filter.to;
	if (filter.area) {
		params.lat = filter.area.lat;
		params.lng = filter.area.lng;
		params.radius = filter.area.radius;
	}
	// 既定値は送らない（サーバ既定と同じ）
	if (sort !== "-occurredAt") params.sort = sort;
	if (sort === "-sceneScore" && filter.sceneKey) params.sceneKey = filter.sceneKey;
	if (sort === "-timeSlotScore" && filter.timeSlotKey) params.timeSlotKey = filter.timeSlotKey;

	return params;
};

/**
 * 3 ビュー共通のキャッシュキー。**実効クエリ**（`toMyDishesQueryParams` の戻り値）を
 * キー名の辞書順で直列化した文字列を返す。
 *
 * - 実効クエリを直列化するので、**不活性な値を触ってもキーは変わらない**
 *   （例: `status: ["want"]` のまま `minRating` をいじっても再取得されない）。
 * - `cursor` を含めない。ページを進めてもキーは同じ（設計書 (2/2) §3-1）。
 * - ビュー（map / list / calendar）を含めない。**ビュー切替では再取得しない**（§3-3）。
 */
export const serializeMyDishesQueryParams = (params: MyDishesQueryParams): string => {
	const entries = Object.entries(params)
		.filter(([, value]) => value !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([key, value]) => `${key}=${Array.isArray(value) ? value.join("|") : String(value)}`);
	return entries.length > 0 ? entries.join("&") : "default";
};

export const selectFilterQueryKey = (s: MyDishesFilterStore): string =>
	serializeMyDishesQueryParams(toMyDishesQueryParams(s.filter));

export const useMyDishesFilterStore = createWithEqualityFn<MyDishesFilterStore>()((set) => ({
	filter: DEFAULT_MY_DISHES_FILTER,

	patch: (partial) =>
		set((state) => ({
			filter: { ...state.filter, ...partial },
		})),

	// #1396 【設計】ここが store と Map の唯一の接点。`onRegionChangeComplete` から呼ばないこと（§3-2）
	commitArea: (area) =>
		set((state) => ({
			filter: { ...state.filter, area },
		})),

	clearArea: () =>
		set((state) => ({
			// `sort: "distance"` はエリア必須なので、エリアを外したら既定の並びへ戻す（400 を作らない）
			filter: {
				...state.filter,
				area: null,
				sort: state.filter.sort === "distance" ? DEFAULT_MY_DISHES_FILTER.sort : state.filter.sort,
			},
		})),

	reset: () => set({ filter: DEFAULT_MY_DISHES_FILTER }),
}));
