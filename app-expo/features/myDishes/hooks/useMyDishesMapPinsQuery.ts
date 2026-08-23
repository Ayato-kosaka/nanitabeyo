import { useCallback, useEffect, useMemo } from "react";
import { shallow } from "zustand/shallow";
import { useAPICall } from "@/hooks/useAPICall";
import type { QueryMyDishesDto } from "@shared/api/v1/dto";
import type { MyDishPin, QueryMeDishMapPinsResponse } from "@shared/api/v1/res";
import { selectFilterQueryKey, toMyDishesQueryParams, useMyDishesFilterStore } from "../stores/useMyDishesFilterStore";
import { selectMyDishesRevision, useMyDishesRevisionStore } from "../stores/useMyDishesRevisionStore";
import { selectMyDishesPinsByQuery, useMyDishesStore, type MyDishesPinsFetcher } from "../stores/useMyDishesStore";

/**
 * #1396 `GET /v1/users/me/dishes/map-pins` に接続する Map ビュー専用のクエリフック
 * （設計書 (2/2) §3-3）。
 *
 * `useMyDishesQuery`（一覧）とは別エンドポイントなので `pinsByQuery` という別スライスを見るが、
 * **`queryKey` は一覧と完全に同じもの**（`selectFilterQueryKey`）を使う。したがってリストで
 * 絞り込んだ結果は Map にも即反映され、フィルタ変更 / `commitArea` のときだけ取り直す。
 *
 * Map の pan / zoom（`onRegionChangeComplete`）はこのフックに一切関与しない。
 * viewport は `MyDishesMapView` 内の `useRef` にとどまり、`queryKey` を変えない（§3-2）。
 */
export type UseMyDishesMapPinsQueryResult = {
	pins: MyDishPin[];
	/** 一覧ビューと共通のキャッシュキー */
	queryKey: string;
	isLoading: boolean;
	error: string | null;
	hasFetchedInitial: boolean;
	/** `MY_DISH_MAP_PINS_LIMIT` で切られたか */
	truncated: boolean;
	/** 明示的な再取得 */
	refresh: () => void;
};

export const useMyDishesMapPinsQuery = (options?: { enabled?: boolean }): UseMyDishesMapPinsQueryResult => {
	const enabled = options?.enabled ?? true;
	const { callBackend } = useAPICall();

	const filter = useMyDishesFilterStore((s) => s.filter);
	const queryKey = useMyDishesFilterStore(selectFilterQueryKey);

	const touchQuery = useMyDishesStore((s) => s.touchQuery);
	const revision = useMyDishesRevisionStore(selectMyDishesRevision);
	const fetchPins = useMyDishesStore((s) => s.fetchPins);
	const { pins, isLoading, error, hasFetchedInitial, truncated } = useMyDishesStore(
		selectMyDishesPinsByQuery(queryKey),
		shallow,
	);

	// #1396 【設計】store が持つのは「ユーザーが選んだもの」だけ。cursor / limit は使わない（§3-1, map-pins は非ページング）
	const fetcher = useMemo<MyDishesPinsFetcher>(() => {
		const params = toMyDishesQueryParams(filter);
		return async () => {
			const response = await callBackend<QueryMyDishesDto, QueryMeDishMapPinsResponse>("v1/users/me/dishes/map-pins", {
				method: "GET",
				requestPayload: params,
			});
			return {
				data: response.data ?? [],
				truncated: response.truncated ?? false,
			};
		};
	}, [callBackend, filter]);

	// #1396 m-1 と同型: キャッシュヒット（下の effect が fetchPins を呼ばない経路）でも LRU を touch する
	useEffect(() => {
		if (!enabled) return;
		touchQuery(queryKey);
	}, [enabled, queryKey, touchQuery]);

	// ⚠️ `!error` を必ず条件へ入れること。取得が失敗したときストアは `hasFetchedInitialPinsByQuery` を
	// false のまま `isLoadingPinsByQuery` を false へ戻すので（stores/useMyDishesStore.ts の fetchPins）、
	// error を見ないと **失敗するたびに再取得して無限ループする**（#1439 レビュー B-1 と同じバグ型。
	// `useMyDishesQuery.ts` / `feed.tsx` / `RestaurantReviewsTab.tsx` と同じ申し送り）
	// #1398 (PR4/7) `revision` を依存に入れる。実際にキャッシュを捨てるのは
	// `useMyDishesRevisionStore.bump()`（`clearQuery()`）で、ここは «版が動いた» ことを
	// この effect へ伝えるためだけに持つ。
	// ⚠️ `error` を条件から外さないこと。外すと失敗のたびに叩き直して無限ループする（#1439 B-1）。
	// 版が動いたときはスライスごと消えていて `error` も `hasFetchedInitial` も落ちているので、
	// このガードを保ったまま «版が動いたときだけ» 取り直す形になる
	useEffect(() => {
		if (!enabled) return;
		if (hasFetchedInitial || isLoading || error) return;
		void fetchPins(queryKey, fetcher);
	}, [enabled, error, fetchPins, fetcher, hasFetchedInitial, isLoading, queryKey, revision]);

	const refresh = useCallback(() => {
		void fetchPins(queryKey, fetcher);
	}, [fetchPins, fetcher, queryKey]);

	return {
		pins,
		queryKey,
		isLoading,
		error,
		hasFetchedInitial,
		truncated,
		refresh,
	};
};
