import { useCallback, useEffect, useMemo } from "react";
import { shallow } from "zustand/shallow";
import { useAPICall } from "@/hooks/useAPICall";
import type { QueryMyDishesDto } from "@shared/api/v1/dto";
import type { MyDishItem, QueryMyDishesResponse } from "@shared/api/v1/res";
import {
	selectDateQueryKey,
	selectFilterQueryKey,
	toMyDishesDateQueryParams,
	useMyDishesFilterStore,
} from "../stores/useMyDishesFilterStore";
import { selectMyDishesRevision, useMyDishesRevisionStore } from "../stores/useMyDishesRevisionStore";
import {
	MY_DISHES_PAGE_SIZE,
	selectMyDishesByQuery,
	useMyDishesStore,
	type MyDishesFetcher,
	type MyDishesStore,
} from "../stores/useMyDishesStore";

/**
 * #1375 実機確認: Calendar の日付タップから開く全画面 Feed 用の派生クエリフック。
 *
 * **`useMyDishesRestaurantQuery` と同じ形を意図的に踏襲している**（store も LRU の扱いも同じ）。
 * 違いは «何でスコープを切るか» だけで、店舗の代わりに «その日 1 日» で切る。
 *
 * base（一覧・Map と共有する `useMyDishesQuery` の queryKey）へ «その日の from/to» を足し、
 * `sort` / `sceneKey` / `timeSlotKey` を落とした別の queryKey で `useMyDishesStore` の
 * **同じ `byQuery` スライス**を引く（新しい store は作らない。§8-1）。
 *
 * この Feed の中は常に「新しい順」固定（リーダー判断 Q5）。ページングは持ち込まない（§8-3）:
 * `loadMore` は公開せず、`hasNextPage` だけを返す。呼び出し側（PR3）は `true` のとき
 * 「一覧で見る」を出す。
 *
 * ⚠️ R2（本質）: マウント中・`queryKey` 変化のたびに **base の `queryKey` も** `touchQuery` する。
 * これで base は常に LRU の MRU 側に留まり、日付を何日ぶん開いても base のスライスは
 * evict されない（`useMyDishesStore.ts` の `MY_DISHES_QUERY_LRU_SIZE` / `touchAndEvict` を参照）。
 * サイズを 3→6 にしただけでは、日付スライス側だけが積み上がる限り足りない。
 */
export type UseMyDishesDateQueryResult = {
	/** `itemKeysByQuery` の順に並べ直した行 */
	items: MyDishItem[];
	/** base とは別キー（その日の `from`/`to` を含む）。`date` が `null` の間は `null` */
	queryKey: string | null;
	isLoading: boolean;
	error: string | null;
	hasFetchedInitial: boolean;
	/** `nextCursor !== null`。1 日ぶんが 1 ページに収まらないのは稀なので、ここでもページングは持ち込まない */
	hasNextPage: boolean;
	/** 明示的な再取得 */
	refresh: () => void;
};

const EMPTY_ITEMS: MyDishItem[] = [];
const DISABLED_QUERY_KEY = "__my-dishes-date-query-disabled__";

/** `date` が `null` の間（そのページがまだ開かれていない間）は何もしない */
export const useMyDishesDateQuery = (date: string | null): UseMyDishesDateQueryResult => {
	const enabled = date !== null;
	const { callBackend } = useAPICall();

	const filter = useMyDishesFilterStore((s) => s.filter);
	const baseQueryKey = useMyDishesFilterStore(selectFilterQueryKey);
	const queryKey = useMyDishesFilterStore(date !== null ? selectDateQueryKey(date) : () => null);
	const effectiveQueryKey = queryKey ?? DISABLED_QUERY_KEY;

	const touchQuery = useMyDishesStore((s) => s.touchQuery);
	const fetchInitial = useMyDishesStore((s) => s.fetchInitial);
	const revision = useMyDishesRevisionStore(selectMyDishesRevision);
	const { itemKeys, isLoading, error, hasFetchedInitial, hasNextPage } = useMyDishesStore(
		selectMyDishesByQuery(effectiveQueryKey),
		shallow,
	);

	// #1396 【設計】store が持つのは「ユーザーが選んだもの」だけ。cursor / limit はここで足す（§3-1）
	const fetcher = useMemo<MyDishesFetcher | null>(() => {
		if (date === null) return null;
		const params = toMyDishesDateQueryParams(filter, date);
		return async ({ cursor }) => {
			const response = await callBackend<QueryMyDishesDto, QueryMyDishesResponse>("v1/users/me/dishes", {
				method: "GET",
				requestPayload: {
					...params,
					limit: MY_DISHES_PAGE_SIZE,
					...(cursor ? { cursor } : {}),
				},
			});
			return {
				data: response.data ?? [],
				nextCursor: response.nextCursor,
				oldestOccurredAt: response.meta?.oldestOccurredAt ?? null,
			};
		};
	}, [callBackend, date, filter]);

	// #1397 R2: 日付ページを開くたび（マウント・queryKey 変化のたび）に base も touch する。
	// これが本質。base を touch しないと、日付スライスだけが LRU を埋めて base が落ちる（§8-2）
	useEffect(() => {
		if (!enabled || queryKey === null) return;
		touchQuery(baseQueryKey);
		touchQuery(queryKey);
	}, [enabled, baseQueryKey, queryKey, touchQuery]);

	// ⚠️ `!error` を必ず条件へ入れること。取得が失敗したときストアは
	// `hasFetchedInitial` を false のまま `isLoading` を false へ戻すので（stores/useMyDishesStore.ts
	// の fetchInitial）、error を見ないと **失敗するたびに再取得して無限ループする**
	// #1398 (PR4/7) `revision` を依存に入れる。実際にキャッシュを捨てるのは
	// `useMyDishesRevisionStore.bump()`（`clearQuery()`）で、ここは «版が動いた» ことを
	// この effect へ伝えるためだけに持つ。
	// ⚠️ `error` を条件から外さないこと。外すと失敗のたびに叩き直して無限ループする（#1439 B-1）。
	// 版が動いたときはスライスごと消えていて `error` も `hasFetchedInitial` も落ちているので、
	// このガードを保ったまま «版が動いたときだけ» 取り直す形になる
	useEffect(() => {
		if (!enabled || queryKey === null || !fetcher) return;
		if (hasFetchedInitial || isLoading || error) return;
		void fetchInitial(queryKey, fetcher);
	}, [enabled, error, fetchInitial, fetcher, hasFetchedInitial, isLoading, queryKey, revision]);

	// ⚠️ `s.itemByKey` を丸ごと購読しない（独立レビュー指摘 High）。テーブル全体を購読すると、
	// 他ビュー・他 queryKey の取得 1 回で（keep-alive 中の）全フックが再レンダーする。
	// 行の配列へ materialize したうえで shallow 比較する
	const items = useMyDishesStore(
		useCallback(
			(s: MyDishesStore) => {
				if (queryKey === null) return EMPTY_ITEMS;
				const { itemKeys: keys } = selectMyDishesByQuery(effectiveQueryKey)(s);
				return keys.map((key) => s.itemByKey[key]).filter((item): item is MyDishItem => Boolean(item));
			},
			[queryKey, effectiveQueryKey],
		),
		shallow,
	);

	const refresh = useCallback(() => {
		if (queryKey === null || !fetcher) return;
		void fetchInitial(queryKey, fetcher);
	}, [fetchInitial, fetcher, queryKey]);

	return {
		items,
		queryKey,
		isLoading: queryKey === null ? false : isLoading,
		error: queryKey === null ? null : error,
		hasFetchedInitial: queryKey === null ? false : hasFetchedInitial,
		hasNextPage: queryKey === null ? false : hasNextPage,
		refresh,
	};
};
