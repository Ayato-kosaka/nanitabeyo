import { createWithEqualityFn } from "zustand/traditional";
import i18n from "@/lib/i18n";
import { toErrorLogMessage } from "@/lib/errorMessage";
import type { MyDishItem, MyDishPin } from "@shared/api/v1/res";

/**
 * #1396 my-dishes の取得結果を置く store（設計書 (2/2) §3-3）。
 *
 * 置き場は既存の作法（`useTopicsStore` の `topicIdsByKey` / `isLoadingByKey` / `nextCursorByKey`）に
 * 合わせた **`byKey` スライス**である。キーは `selectFilterQueryKey(useMyDishesFilterStore)` の戻り値で、
 * Map / リスト / Calendar の 3 ビューが**同じキーを共有する**。
 *
 * | 操作 | 挙動 |
 * | --- | --- |
 * | ビュー切替（Map ⇄ リスト ⇄ Calendar） | **再取得しない**（`queryKey` が変わらない） |
 * | フィルタ変更 / `commitArea` | `queryKey` が変わる → `cursor` を捨てて先頭から取り直す |
 * | Map の pan / zoom のみ | **何も起きない**（viewport は store に入れない。§3-2） |
 *
 * ⚠️ この store にも viewport（`Region` / `latitudeDelta` など）は入れない。
 * 入るのは「取得結果」だけである。
 */

/** 保持する `queryKey` の本数。これを超えた分は LRU で捨てる（設計書 (2/2) §3-3） */
export const MY_DISHES_QUERY_LRU_SIZE = 3;

/** 1 ページの件数。#1395 の既定（42）に合わせる */
export const MY_DISHES_PAGE_SIZE = 42;

export type MyDishesFetchResult = {
	data: MyDishItem[];
	nextCursor?: string | null;
	/** 初回ページかつフィルタ無しのときだけ入る。それ以外は null（#1395 §4-4 / B-2） */
	oldestOccurredAt?: string | null;
};

/** `cursor` を受け取ってページを返す関数。実体は `useMyDishesQuery` が `callBackend` で組む */
export type MyDishesFetcher = (params: { cursor?: string | null }) => Promise<MyDishesFetchResult>;

/** #1396 Map ピン取得結果。`GET /v1/users/me/dishes/map-pins` はページングしない（店舗単位に集約済み） */
export type MyDishesPinsFetchResult = {
	data: MyDishPin[];
	truncated: boolean;
};

/** ピンを返す関数。実体は `useMyDishesMapPinsQuery` が `callBackend` で組む */
export type MyDishesPinsFetcher = () => Promise<MyDishesPinsFetchResult>;

export type MyDishesStore = {
	/**
	 * `MyDishItem.key`（`"review:<uuid>"` / `"dish:<uuid>"`。#1395 §4-4）をキーにした正規化テーブル。
	 * ここが行データの唯一のソース・オブ・トゥルース。
	 */
	itemByKey: Record<string, MyDishItem>;

	/** `queryKey` ごとの並び順（`MyDishItem.key` の配列） */
	itemKeysByQuery: Record<string, string[]>;

	/** `queryKey` ごとの次カーソル。`null` が終端（#1395 §6: これが唯一の正の終了条件） */
	nextCursorByQuery: Record<string, string | null>;

	/** `queryKey` ごとの初回取得中フラグ */
	isLoadingByQuery: Record<string, boolean>;

	/** `queryKey` ごとの追加ページ取得中フラグ */
	isLoadingMoreByQuery: Record<string, boolean>;

	/** `queryKey` ごとの最古 `occurredAt`（Calendar がどこまで遡れるかの判定に使う。PR5） */
	oldestOccurredAtByQuery: Record<string, string | null>;

	/** `queryKey` ごとの初回取得完了フラグ。0 件と未取得を区別する */
	hasFetchedInitialByQuery: Record<string, boolean>;

	/** `queryKey` ごとのエラーメッセージ */
	errorByQuery: Record<string, string | null>;

	/**
	 * `queryKey` ごとの Map ピン（`GET /v1/users/me/dishes/map-pins`。#1396 設計書 (2/2) §3-3）。
	 *
	 * 一覧（`itemKeysByQuery` 等）とは別スライスだが、**`queryKey` は一覧と同じもの**を使う。
	 * リストで絞った結果が Map にも即反映され、かつ LRU（`recentQueryKeys`）と
	 * ビュー切替時の「再取得しない」挙動を一覧と共有できる。
	 */
	pinsByQuery: Record<string, MyDishPin[]>;

	/** `queryKey` ごとのピン取得中フラグ */
	isLoadingPinsByQuery: Record<string, boolean>;

	/** `queryKey` ごとのピン初回取得完了フラグ */
	hasFetchedInitialPinsByQuery: Record<string, boolean>;

	/** `queryKey` ごとのピン取得エラーメッセージ */
	errorPinsByQuery: Record<string, string | null>;

	/** `queryKey` ごとに `MY_DISH_MAP_PINS_LIMIT` で切られたか */
	truncatedByQuery: Record<string, boolean>;

	/** 参照が新しい順に並んだ `queryKey`。先頭が最新（LRU の管理用） */
	recentQueryKeys: string[];

	/**
	 * `queryKey` を LRU の先頭へ touch する。キャッシュヒット（`fetchInitial` を呼ばない経路）でも
	 * 呼ぶ必要があるため、`fetchInitial` の副作用から独立させている（#1396 m-1）。
	 * `useMyDishesQuery` / `useMyDishesMapPinsQuery` がマウント・`queryKey` 変化のたびに毎回呼ぶ。
	 */
	touchQuery: (queryKey: string) => void;

	/** 初回取得（`cursor` を捨てて先頭から） */
	fetchInitial: (queryKey: string, fetcher: MyDishesFetcher) => Promise<void>;

	/** 追加ページ取得。`nextCursor === null` なら何もしない */
	fetchMore: (queryKey: string, fetcher: MyDishesFetcher) => Promise<void>;

	/** Map ピンの取得（ページングしない。同一キーの取得が飛行中なら二重に投げない） */
	fetchPins: (queryKey: string, fetcher: MyDishesPinsFetcher) => Promise<void>;

	/** `queryKey` を指定するとそのスライスだけ、省略すると全部を破棄する */
	clearQuery: (queryKey?: string) => void;
};

const EMPTY_KEYS: string[] = [];
const EMPTY_PINS: MyDishPin[] = [];

/** `queryKey` に紐づく一覧の状態をまとめて取り出すセレクタ（`useTopicsStore` の作法に合わせる） */
export const selectMyDishesByQuery =
	(queryKey: string) =>
	(
		state: MyDishesStore,
	): {
		itemKeys: string[];
		isLoading: boolean;
		isLoadingMore: boolean;
		error: string | null;
		hasFetchedInitial: boolean;
		hasNextPage: boolean;
		oldestOccurredAt: string | null;
	} => ({
		itemKeys: state.itemKeysByQuery[queryKey] ?? EMPTY_KEYS,
		isLoading: state.isLoadingByQuery[queryKey] ?? false,
		isLoadingMore: state.isLoadingMoreByQuery[queryKey] ?? false,
		error: state.errorByQuery[queryKey] ?? null,
		hasFetchedInitial: state.hasFetchedInitialByQuery[queryKey] ?? false,
		hasNextPage: (state.nextCursorByQuery[queryKey] ?? null) !== null,
		oldestOccurredAt: state.oldestOccurredAtByQuery[queryKey] ?? null,
	});

/** `queryKey` に紐づく Map ピンの状態をまとめて取り出すセレクタ */
export const selectMyDishesPinsByQuery =
	(queryKey: string) =>
	(
		state: MyDishesStore,
	): {
		pins: MyDishPin[];
		isLoading: boolean;
		error: string | null;
		hasFetchedInitial: boolean;
		truncated: boolean;
	} => ({
		pins: state.pinsByQuery[queryKey] ?? EMPTY_PINS,
		isLoading: state.isLoadingPinsByQuery[queryKey] ?? false,
		error: state.errorPinsByQuery[queryKey] ?? null,
		hasFetchedInitial: state.hasFetchedInitialPinsByQuery[queryKey] ?? false,
		truncated: state.truncatedByQuery[queryKey] ?? false,
	});

/**
 * `queryKey` を LRU の先頭へ持ち上げ、`MY_DISHES_QUERY_LRU_SIZE` 本を超えた分のスライスを捨てる。
 *
 * フィルタを往復（★4以上 → 解除 → ★4以上）したときに再取得しないよう、直近数本は残す。
 * 一方で全部残すと、フィルタを触るたびに 42 件 × N のページがメモリに積み上がる。
 * `itemByKey` は「残った `queryKey` のどれかから参照されている行」だけに絞り込む。
 */
const touchAndEvict = (state: MyDishesStore, queryKey: string): Partial<MyDishesStore> => {
	const recentQueryKeys = [queryKey, ...state.recentQueryKeys.filter((k) => k !== queryKey)];
	const evicted = recentQueryKeys.slice(MY_DISHES_QUERY_LRU_SIZE);
	if (evicted.length === 0) {
		return { recentQueryKeys };
	}

	const kept = recentQueryKeys.slice(0, MY_DISHES_QUERY_LRU_SIZE);
	const nextItemKeysByQuery = { ...state.itemKeysByQuery };
	const nextNextCursorByQuery = { ...state.nextCursorByQuery };
	const nextIsLoadingByQuery = { ...state.isLoadingByQuery };
	const nextIsLoadingMoreByQuery = { ...state.isLoadingMoreByQuery };
	const nextOldestOccurredAtByQuery = { ...state.oldestOccurredAtByQuery };
	const nextHasFetchedInitialByQuery = { ...state.hasFetchedInitialByQuery };
	const nextErrorByQuery = { ...state.errorByQuery };
	const nextPinsByQuery = { ...state.pinsByQuery };
	const nextIsLoadingPinsByQuery = { ...state.isLoadingPinsByQuery };
	const nextHasFetchedInitialPinsByQuery = { ...state.hasFetchedInitialPinsByQuery };
	const nextErrorPinsByQuery = { ...state.errorPinsByQuery };
	const nextTruncatedByQuery = { ...state.truncatedByQuery };

	for (const key of evicted) {
		delete nextItemKeysByQuery[key];
		delete nextNextCursorByQuery[key];
		delete nextIsLoadingByQuery[key];
		delete nextIsLoadingMoreByQuery[key];
		delete nextOldestOccurredAtByQuery[key];
		delete nextHasFetchedInitialByQuery[key];
		delete nextErrorByQuery[key];
		delete nextPinsByQuery[key];
		delete nextIsLoadingPinsByQuery[key];
		delete nextHasFetchedInitialPinsByQuery[key];
		delete nextErrorPinsByQuery[key];
		delete nextTruncatedByQuery[key];
	}

	// 残ったスライスから参照されている行だけを itemByKey に残す
	const referenced = new Set<string>();
	for (const key of kept) {
		for (const itemKey of nextItemKeysByQuery[key] ?? EMPTY_KEYS) referenced.add(itemKey);
	}
	const nextItemByKey: Record<string, MyDishItem> = {};
	for (const itemKey of referenced) {
		const item = state.itemByKey[itemKey];
		if (item) nextItemByKey[itemKey] = item;
	}

	return {
		recentQueryKeys: kept,
		itemByKey: nextItemByKey,
		itemKeysByQuery: nextItemKeysByQuery,
		nextCursorByQuery: nextNextCursorByQuery,
		isLoadingByQuery: nextIsLoadingByQuery,
		isLoadingMoreByQuery: nextIsLoadingMoreByQuery,
		oldestOccurredAtByQuery: nextOldestOccurredAtByQuery,
		hasFetchedInitialByQuery: nextHasFetchedInitialByQuery,
		errorByQuery: nextErrorByQuery,
		pinsByQuery: nextPinsByQuery,
		isLoadingPinsByQuery: nextIsLoadingPinsByQuery,
		hasFetchedInitialPinsByQuery: nextHasFetchedInitialPinsByQuery,
		errorPinsByQuery: nextErrorPinsByQuery,
		truncatedByQuery: nextTruncatedByQuery,
	};
};

const toErrorMessage = (err: unknown): string =>
	i18n.t("Profile.tabError.failedToLoad", { error: err ? toErrorLogMessage(err) : null });

export const useMyDishesStore = createWithEqualityFn<MyDishesStore>()((set, get) => ({
	itemByKey: {},
	itemKeysByQuery: {},
	nextCursorByQuery: {},
	isLoadingByQuery: {},
	isLoadingMoreByQuery: {},
	oldestOccurredAtByQuery: {},
	hasFetchedInitialByQuery: {},
	errorByQuery: {},
	pinsByQuery: {},
	isLoadingPinsByQuery: {},
	hasFetchedInitialPinsByQuery: {},
	errorPinsByQuery: {},
	truncatedByQuery: {},
	recentQueryKeys: [],

	touchQuery: (queryKey) => set((state) => touchAndEvict(state, queryKey)),

	fetchInitial: async (queryKey, fetcher) => {
		// 同一キーの初回取得が走っている間は二重に投げない（964MB のテーブルを二度叩かない）
		if (get().isLoadingByQuery[queryKey]) return;

		// LRU の追い出しを先に済ませ、その結果のマップへローディングを載せる
		// （先に載せると、追い出したはずのキーが残ったマップで上書きされて復活する）
		get().touchQuery(queryKey);
		set((state) => ({
			isLoadingByQuery: { ...state.isLoadingByQuery, [queryKey]: true },
			errorByQuery: { ...state.errorByQuery, [queryKey]: null },
		}));

		try {
			// #1396 【設計】フィルタ変更時は cursor を捨てて先頭から取り直す（#1395 §6）
			const response = await fetcher({ cursor: null });
			set((state) => {
				const itemPatch: Record<string, MyDishItem> = {};
				for (const item of response.data) itemPatch[item.key] = item;
				return {
					itemByKey: { ...state.itemByKey, ...itemPatch },
					itemKeysByQuery: { ...state.itemKeysByQuery, [queryKey]: response.data.map((item) => item.key) },
					nextCursorByQuery: { ...state.nextCursorByQuery, [queryKey]: response.nextCursor ?? null },
					oldestOccurredAtByQuery: {
						...state.oldestOccurredAtByQuery,
						[queryKey]: response.oldestOccurredAt ?? null,
					},
					hasFetchedInitialByQuery: { ...state.hasFetchedInitialByQuery, [queryKey]: true },
				};
			});
		} catch (err) {
			set((state) => ({ errorByQuery: { ...state.errorByQuery, [queryKey]: toErrorMessage(err) } }));
		} finally {
			set((state) => ({ isLoadingByQuery: { ...state.isLoadingByQuery, [queryKey]: false } }));
		}
	},

	fetchMore: async (queryKey, fetcher) => {
		const state = get();
		const cursor = state.nextCursorByQuery[queryKey];
		// 終端（null / 未取得）は何もしない。同時実行も 1 本に絞る（設計書 (2/2) §4-4）
		if (!cursor) return;
		if (state.isLoadingMoreByQuery[queryKey] || state.isLoadingByQuery[queryKey]) return;

		set((s) => ({
			isLoadingMoreByQuery: { ...s.isLoadingMoreByQuery, [queryKey]: true },
			errorByQuery: { ...s.errorByQuery, [queryKey]: null },
		}));

		try {
			const response = await fetcher({ cursor });
			// n-1（見送り・申し送り）: ここで `queryKey` がまだ `recentQueryKeys` に生きているかは見ていない。
			// 飛行中に他の 4 本目の queryKey で LRU から追い出されると、この結果は誰も参照しない
			// itemByKey の行として残り続ける（次の追い出しまで）。到達には「追加取得中に他の
			// queryKey へ 3 回以上切り替える」必要があり、実害は小さいと判断して見送った（#1439 レビュー）。
			set((s) => {
				const itemPatch: Record<string, MyDishItem> = {};
				for (const item of response.data) itemPatch[item.key] = item;

				const prevKeys = s.itemKeysByQuery[queryKey] ?? EMPTY_KEYS;
				const prevKeySet = new Set(prevKeys);
				const appended = response.data.map((item) => item.key).filter((key) => !prevKeySet.has(key));

				return {
					itemByKey: { ...s.itemByKey, ...itemPatch },
					itemKeysByQuery: { ...s.itemKeysByQuery, [queryKey]: [...prevKeys, ...appended] },
					nextCursorByQuery: { ...s.nextCursorByQuery, [queryKey]: response.nextCursor ?? null },
				};
			});
		} catch (err) {
			set((s) => ({ errorByQuery: { ...s.errorByQuery, [queryKey]: toErrorMessage(err) } }));
		} finally {
			set((s) => ({ isLoadingMoreByQuery: { ...s.isLoadingMoreByQuery, [queryKey]: false } }));
		}
	},

	fetchPins: async (queryKey, fetcher) => {
		// 同一キーのピン取得が飛行中なら二重に投げない
		if (get().isLoadingPinsByQuery[queryKey]) return;

		get().touchQuery(queryKey);
		set((state) => ({
			isLoadingPinsByQuery: { ...state.isLoadingPinsByQuery, [queryKey]: true },
			errorPinsByQuery: { ...state.errorPinsByQuery, [queryKey]: null },
		}));

		try {
			const response = await fetcher();
			set((state) => ({
				pinsByQuery: { ...state.pinsByQuery, [queryKey]: response.data },
				truncatedByQuery: { ...state.truncatedByQuery, [queryKey]: response.truncated },
				hasFetchedInitialPinsByQuery: { ...state.hasFetchedInitialPinsByQuery, [queryKey]: true },
			}));
		} catch (err) {
			set((state) => ({ errorPinsByQuery: { ...state.errorPinsByQuery, [queryKey]: toErrorMessage(err) } }));
		} finally {
			set((state) => ({ isLoadingPinsByQuery: { ...state.isLoadingPinsByQuery, [queryKey]: false } }));
		}
	},

	clearQuery: (queryKey) =>
		set((state) => {
			if (!queryKey) {
				return {
					itemByKey: {},
					itemKeysByQuery: {},
					nextCursorByQuery: {},
					isLoadingByQuery: {},
					isLoadingMoreByQuery: {},
					oldestOccurredAtByQuery: {},
					hasFetchedInitialByQuery: {},
					errorByQuery: {},
					pinsByQuery: {},
					isLoadingPinsByQuery: {},
					hasFetchedInitialPinsByQuery: {},
					errorPinsByQuery: {},
					truncatedByQuery: {},
					recentQueryKeys: [],
				};
			}

			const nextItemKeysByQuery = { ...state.itemKeysByQuery };
			const nextNextCursorByQuery = { ...state.nextCursorByQuery };
			const nextIsLoadingByQuery = { ...state.isLoadingByQuery };
			const nextIsLoadingMoreByQuery = { ...state.isLoadingMoreByQuery };
			const nextOldestOccurredAtByQuery = { ...state.oldestOccurredAtByQuery };
			const nextHasFetchedInitialByQuery = { ...state.hasFetchedInitialByQuery };
			const nextErrorByQuery = { ...state.errorByQuery };
			const nextPinsByQuery = { ...state.pinsByQuery };
			const nextIsLoadingPinsByQuery = { ...state.isLoadingPinsByQuery };
			const nextHasFetchedInitialPinsByQuery = { ...state.hasFetchedInitialPinsByQuery };
			const nextErrorPinsByQuery = { ...state.errorPinsByQuery };
			const nextTruncatedByQuery = { ...state.truncatedByQuery };

			delete nextItemKeysByQuery[queryKey];
			delete nextNextCursorByQuery[queryKey];
			delete nextIsLoadingByQuery[queryKey];
			delete nextIsLoadingMoreByQuery[queryKey];
			delete nextOldestOccurredAtByQuery[queryKey];
			delete nextHasFetchedInitialByQuery[queryKey];
			delete nextErrorByQuery[queryKey];
			delete nextPinsByQuery[queryKey];
			delete nextIsLoadingPinsByQuery[queryKey];
			delete nextHasFetchedInitialPinsByQuery[queryKey];
			delete nextErrorPinsByQuery[queryKey];
			delete nextTruncatedByQuery[queryKey];

			const referenced = new Set<string>();
			for (const keys of Object.values(nextItemKeysByQuery)) {
				for (const itemKey of keys) referenced.add(itemKey);
			}
			const nextItemByKey: Record<string, MyDishItem> = {};
			for (const itemKey of referenced) {
				const item = state.itemByKey[itemKey];
				if (item) nextItemByKey[itemKey] = item;
			}

			return {
				itemByKey: nextItemByKey,
				itemKeysByQuery: nextItemKeysByQuery,
				nextCursorByQuery: nextNextCursorByQuery,
				isLoadingByQuery: nextIsLoadingByQuery,
				isLoadingMoreByQuery: nextIsLoadingMoreByQuery,
				oldestOccurredAtByQuery: nextOldestOccurredAtByQuery,
				hasFetchedInitialByQuery: nextHasFetchedInitialByQuery,
				errorByQuery: nextErrorByQuery,
				pinsByQuery: nextPinsByQuery,
				isLoadingPinsByQuery: nextIsLoadingPinsByQuery,
				hasFetchedInitialPinsByQuery: nextHasFetchedInitialPinsByQuery,
				errorPinsByQuery: nextErrorPinsByQuery,
				truncatedByQuery: nextTruncatedByQuery,
				recentQueryKeys: state.recentQueryKeys.filter((k) => k !== queryKey),
			};
		}),
}));
