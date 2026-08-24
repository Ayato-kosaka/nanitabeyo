import { useCallback, useEffect, useMemo } from "react";
import { shallow } from "zustand/shallow";
import { useAPICall } from "@/hooks/useAPICall";
import type { QueryMyDishesDto } from "@shared/api/v1/dto";
import type { MyDishItem, QueryMyDishesResponse } from "@shared/api/v1/res";
import {
	selectCalendarQueryKey,
	selectFilterQueryKey,
	toMyDishesCalendarQueryParams,
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
 * #1396 PR5 レビュー M-2: Calendar ビュー用の派生クエリフック。
 *
 * base（一覧・Map と共有する `useMyDishesQuery` の queryKey）から `sort` / `sceneKey` /
 * `timeSlotKey` を落とし、**常に `-occurredAt`（新しい順）で読む**別の queryKey で
 * `useMyDishesStore` の**同じ `byQuery` スライス**を引く（新しい store は作らない）。
 * 作法は #1397 PR2 の `useMyDishesRestaurantQuery` と同一である。
 *
 * なぜ固定するのかは `toMyDishesCalendarQueryParams` の docstring を参照。要するに
 * Calendar は「ページが日付の降順で届くこと」を前提に月グリッドを下から積むので、
 * 評価順・距離順で読むとカレンダーとして成立しない。
 *
 * ⚠️ **共有 `sort` が既定の `-occurredAt` のとき、この queryKey は base と完全に一致する。**
 * 常用ケースでは追加の取得も LRU の追加消費も起きない（`myDishesFilterStore.test.ts` が固定）。
 *
 * ⚠️ #1397 PR2 R2 と同じく、マウント中・`queryKey` 変化のたびに **base の `queryKey` も**
 * `touchQuery` する。これをしないと、`sort` を変えている間 Calendar 用キーだけが LRU の
 * MRU 側を占め、一覧・Map が見ている base のスライスが evict される。
 */
export type UseMyDishesCalendarQueryResult = {
	/** `itemKeysByQuery` の順（= `-occurredAt` の降順）に並べ直した行 */
	items: MyDishItem[];
	/** base とは別になりうるキー。共有 `sort` が既定なら base と同一文字列 */
	queryKey: string;
	isLoading: boolean;
	isLoadingMore: boolean;
	error: string | null;
	hasFetchedInitial: boolean;
	hasNextPage: boolean;
	/** 「どこまで遡れるか」を知るための最古 `occurredAt`。無いこともある（#1395 §4-4） */
	oldestOccurredAt: string | null;
	/** 次ページ（= さらに過去）取得。終端・取得中は store 側でも弾かれる */
	loadMore: () => void;
	/** 明示的な再取得 */
	refresh: () => void;
};

export const useMyDishesCalendarQuery = (options?: { enabled?: boolean }): UseMyDishesCalendarQueryResult => {
	/**
	 * #1375（5 巡目・性能）false の間は取得を始めない。
	 *
	 * 3 ビューは keep-alive で、タブを離れても生きている。`bumpMyDishesRevision()` が
	 * キャッシュを捨てると、**見えていないビューまで**その場で取り直しに行く。
	 * 一覧の取得は実測で平均 4.48 秒・最大 11.23 秒（#1395 §0(A)）なので、
	 * 保存ボタン 1 タップで数秒級のクエリが最大 3 本走っていた。
	 * 捨てる範囲は変えず（`useMyDishesRevisionStore` の «全部捨てるのが唯一ズレない» は正しい）、
	 * **取り直すのを «画面に出ているビューが見えているとき» に限る**。
	 * `hasFetchedInitial` は false のままなので、戻ってきた瞬間に自然と取り直される。
	 */
	const enabled = options?.enabled ?? true;
	const { callBackend } = useAPICall();

	const filter = useMyDishesFilterStore((s) => s.filter);
	const baseQueryKey = useMyDishesFilterStore(selectFilterQueryKey);
	const queryKey = useMyDishesFilterStore(selectCalendarQueryKey);

	const touchQuery = useMyDishesStore((s) => s.touchQuery);
	const revision = useMyDishesRevisionStore(selectMyDishesRevision);
	const fetchInitial = useMyDishesStore((s) => s.fetchInitial);
	const fetchMore = useMyDishesStore((s) => s.fetchMore);
	const { itemKeys, isLoading, isLoadingMore, error, hasFetchedInitial, hasNextPage, oldestOccurredAt } =
		useMyDishesStore(selectMyDishesByQuery(queryKey), shallow);

	// #1396 【設計】store が持つのは「ユーザーが選んだもの」だけ。`cursor` / `limit` はここで足す（§3-1）
	const fetcher = useMemo<MyDishesFetcher>(() => {
		const params = toMyDishesCalendarQueryParams(filter);
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
	}, [callBackend, filter]);

	// #1397 PR2 R2: 自分のキーと **base のキーの両方**を touch する。
	// base を touch しないと、Calendar 用キーだけが LRU を埋めて base のスライスが落ちる。
	// 共有 sort が既定なら両者は同じ文字列なので、touch は実質 1 本にしかならない
	useEffect(() => {
		if (!enabled) return;
		touchQuery(baseQueryKey);
		if (queryKey !== baseQueryKey) touchQuery(queryKey);
	}, [baseQueryKey, enabled, queryKey, touchQuery]);

	// ⚠️ `!error` を必ず条件へ入れること。取得が失敗したときストアは
	// `hasFetchedInitial` を false のまま `isLoading` を false へ戻すので（stores/useMyDishesStore.ts
	// の fetchInitial）、error を見ないと **失敗するたびに再取得して無限ループする**（#1439 B-1）
	// #1398 (PR4/7) `revision` を依存に入れる。実際にキャッシュを捨てるのは
	// `useMyDishesRevisionStore.bump()`（`clearQuery()`）で、ここは «版が動いた» ことを
	// この effect へ伝えるためだけに持つ。
	// ⚠️ `error` を条件から外さないこと。外すと失敗のたびに叩き直して無限ループする（#1439 B-1）。
	// 版が動いたときはスライスごと消えていて `error` も `hasFetchedInitial` も落ちているので、
	// このガードを保ったまま «版が動いたときだけ» 取り直す形になる
	useEffect(() => {
		if (!enabled) return;
		if (hasFetchedInitial || isLoading || error) return;
		void fetchInitial(queryKey, fetcher);
	}, [enabled, error, fetchInitial, fetcher, hasFetchedInitial, isLoading, queryKey, revision]);

	// ⚠️ `s.itemByKey` を丸ごと購読しない（独立レビュー指摘 High）。テーブル全体を購読すると、
	// 他ビュー・他 queryKey の取得 1 回で（keep-alive 中の）全フックが再レンダーする。
	// 行の配列へ materialize したうえで shallow 比較する
	const items = useMyDishesStore(
		useCallback(
			(s: MyDishesStore) => {
				const { itemKeys: keys } = selectMyDishesByQuery(queryKey)(s);
				return keys.map((key) => s.itemByKey[key]).filter((item): item is MyDishItem => Boolean(item));
			},
			[queryKey],
		),
		shallow,
	);

	const loadMore = useCallback(() => {
		void fetchMore(queryKey, fetcher);
	}, [fetchMore, fetcher, queryKey]);

	const refresh = useCallback(() => {
		void fetchInitial(queryKey, fetcher);
	}, [fetchInitial, fetcher, queryKey]);

	return {
		items,
		queryKey,
		isLoading,
		isLoadingMore,
		error,
		hasFetchedInitial,
		hasNextPage,
		oldestOccurredAt,
		loadMore,
		refresh,
	};
};
