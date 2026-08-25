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
 * `-featureScore` は既存 `dish_category_features` の連続値スコア順（#1395 §4-3）。
 *
 * #1375 実機確認: 以前は軸ごとに `-sceneScore` / `-timeSlotScore` という別々の sort だったが、
 * sort は 1 つしか選べないので「夜ご飯 × 友達と × サクッと」のように軸を重ねられなかった。
 * 軸は `featureKeys`（複数可）へ移し、sort 値は `-featureScore` 1 つに畳んである。
 */
export type MyDishesSort = "-occurredAt" | "occurredAt" | "-rating" | "distance" | "-featureScore";

export const MY_DISHES_SORTS: readonly MyDishesSort[] = [
	"-occurredAt",
	"occurredAt",
	"-rating",
	"distance",
	"-featureScore",
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
	/**
	 * 並び替えに使う特徴量の軸（`"<feature_type>:<feature_key>"`）。
	 * 例: `["timeSlot:dinner", "scene:friends"]`。1 軸につき高々 1 件で、複数軸を重ねられる
	 */
	featureKeys: string[];
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
	featureKeys: [],
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
 * `QueryMyDishesDto` は `sort=distance` に `lat/lng/radius` を、`-featureScore` に `featureKeys` を
 * **必須**にしている。欠けたまま送ると 400 になるので、
 * クエリを組む前にここで吸収する（UI 側も選べないようにするが、store を直接叩かれても壊れないようにする）。
 */
export const resolveSort = (filter: MyDishesFilter): MyDishesSort => {
	switch (filter.sort) {
		case "distance":
			return filter.area ? "distance" : "-occurredAt";
		case "-featureScore":
			return filter.featureKeys.length > 0 ? "-featureScore" : "-occurredAt";
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
	// 直列化を安定させるため常にソートしてから積む（選んだ順で queryKey が変わらないように）
	if (sort === "-featureScore" && filter.featureKeys.length > 0) params.featureKeys = [...filter.featureKeys].sort();

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

/**
 * #1397 料理メディア Sheet 用の派生クエリ。base の実効クエリ（`toMyDishesQueryParams`）へ
 * `restaurantId` を足し、`sort` / `featureKeys` を落とす（設計 (2/2) §8-1 / Q5）。
 *
 * `distance` は 1 店舗内で全行同値、`-featureScore` も同カテゴリばかりで
 * 差が出ないため、Sheet 内は常に `-occurredAt` に固定する（リーダー判断 Q5）。
 *
 * ⚠️ `restaurantId` は共有フィルタ（`MyDishesFilter`）には入れない。入れた瞬間、
 * Sheet を開いただけで一覧・Map まで 1 店舗に絞られる（設計 (2/2) §7-1）。
 * 呼び出し側（Sheet）が引数として渡す派生値としてのみ扱う。
 */
export type MyDishesRestaurantQueryParams = Omit<MyDishesQueryParams, "sort" | "featureKeys"> & {
	restaurantId: string;
};

export const toMyDishesRestaurantQueryParams = (
	filter: MyDishesFilter,
	restaurantId: string,
): MyDishesRestaurantQueryParams => {
	const params = { ...toMyDishesQueryParams(filter) };
	delete params.sort;
	delete params.featureKeys;
	return { ...params, restaurantId };
};

/** base とは別キーになる（`restaurantId` を含む）Sheet 用の queryKey */
export const selectRestaurantQueryKey =
	(restaurantId: string) =>
	(s: MyDishesFilterStore): string =>
		serializeMyDishesQueryParams(toMyDishesRestaurantQueryParams(s.filter, restaurantId));

/**
 * #1396 PR5 レビュー M-2: Calendar ビュー用の派生クエリ。
 *
 * Calendar は「上へスクロールして過去へ遡る」UI なので、**ページが日付の降順で届くこと**を
 * 前提にしている（`buildCalendarMonths` は読み込み済みの最古の月を下端に取る）。共有 `sort` が
 * `-rating` / `distance` / `-featureScore` のときは 1 ページ目が何年にも散らばり、
 * 空の月が数十個並んだうえに上へ遡っても何も増えない（= カレンダーとして成立しない）。
 * `sort: "occurredAt"`（古い順）に至っては「上へ遡る」の向きそのものが逆になる。
 *
 * そこで Calendar は `sort` / `featureKeys` を落とし、常に既定の `-occurredAt` で読む。
 * 落とし方も落とす対象も `toMyDishesRestaurantQueryParams`（#1397 PR2）と同じ作法である。
 *
 * ⚠️ 共有 `sort` が既定の `-occurredAt` のときは、`toMyDishesQueryParams` が `sort` をそもそも
 * 積まないため、**派生キーは base の queryKey と完全に一致する**。つまり常用ケースでは追加の
 * 取得も LRU の追加消費も一切起きない（`__tests__/myDishesFilterStore.test.ts` が固定）。
 *
 * ⚠️ `MyDishesFilter` のキー集合は増やさない。Calendar 固有の値は filter の外で作る（#1397 PR2 と同じ）。
 */
export type MyDishesCalendarQueryParams = Omit<MyDishesQueryParams, "sort" | "featureKeys">;

export const toMyDishesCalendarQueryParams = (filter: MyDishesFilter): MyDishesCalendarQueryParams => {
	const params = { ...toMyDishesQueryParams(filter) };
	delete params.sort;
	delete params.featureKeys;
	return params;
};

/** Calendar 用の queryKey。共有 `sort` が既定なら base（`selectFilterQueryKey`）と同じ文字列になる */
export const selectCalendarQueryKey = (s: MyDishesFilterStore): string =>
	serializeMyDishesQueryParams(toMyDishesCalendarQueryParams(s.filter));

/**
 * #1375 実機確認: Calendar の日付タップから開く全画面 Feed 用の派生クエリ。
 *
 * Calendar は «日付の棚» なので、その日 1 日ぶんだけを見る。落とすものは 2 種類ある。
 *
 * - `sort` / `featureKeys` … Calendar 用派生クエリ（`toMyDishesCalendarQueryParams`）と同じ理由。
 *   1 日ぶんの中で «評価順» や «条件に合う順» に並べ替える意味が薄く、キーが増えるだけである
 * - `lat` / `lng` / `radius`（エリア） … 日付の棚にエリアの絞り込みは含めない（ユーザー確定）。
 *   Map で絞ったエリアが Calendar 由来の Feed にまで効くと「なぜ減ったのか」が読めない
 *
 * 代わりに `from` / `to` をその日の境界へ固定する。境界は **端末のローカル日付**で切る
 * （Calendar のマス目がローカル日付で並んでいるので、ここだけ UTC で切ると 1 日ずれる）。
 */
export type MyDishesDateQueryParams = Omit<MyDishesQueryParams, "sort" | "featureKeys" | "lat" | "lng" | "radius">;

/** `YYYY-MM-DD` をローカル時刻の [00:00:00.000, 23:59:59.999] へ広げる */
export const toLocalDayRange = (date: string): { from: string; to: string } | null => {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!match) return null;
	const [, year, month, day] = match;
	const from = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
	const to = new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999);
	if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
	return { from: from.toISOString(), to: to.toISOString() };
};

export const toMyDishesDateQueryParams = (filter: MyDishesFilter, date: string): MyDishesDateQueryParams => {
	const params = { ...toMyDishesQueryParams(filter) };
	delete params.sort;
	delete params.featureKeys;
	delete params.lat;
	delete params.lng;
	delete params.radius;

	const range = toLocalDayRange(date);
	if (range) {
		params.from = range.from;
		params.to = range.to;
	}
	return params;
};

/** 日付スコープの queryKey。日付ごとに別スライスになる */
export const selectDateQueryKey =
	(date: string) =>
	(s: MyDishesFilterStore): string =>
		serializeMyDishesQueryParams(toMyDishesDateQueryParams(s.filter, date));

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

/*
#1375（オーナー指示）**絞り込みアイコンに「いま何個効いているか」を出すための数。**

数えるのは «棚を削っているもの» だけ。並び替え（`sort`）と、その同伴である
`featureKeys` は棚を削らないので数えない（`MyDishesFeedChips.tsx` の
「chips は棚を削る方向にだけ働く」と同じ線引き）。

`status` は «食べたい / 食べた» の 2 択で、[] は «両方» ＝ 未指定なので数えない。
`categoryIds` は選んだ個数ぶん数える（3 つ選べば 3）。
評価は `minRating` と `ratings` のどちらかしか使わないので、合わせて高々 1 とは限らず
`ratings` の個数で数える（複数選択できる作りのため）。
エリアは効いていれば 1。
*/
export const countActiveMyDishesFilters = (filter: MyDishesFilter): number => {
	let count = 0;
	if (filter.status.length > 0) count += filter.status.length;
	count += filter.categoryIds.length;
	if (filter.minRating !== null) count += 1;
	count += filter.ratings.length;
	if (filter.from !== null) count += 1;
	if (filter.to !== null) count += 1;
	if (filter.area !== null) count += 1;
	return count;
};

/** ストアから直接読むためのセレクタ */
export const selectActiveFilterCount = (state: MyDishesFilterStore): number =>
	countActiveMyDishesFilters(state.filter);
