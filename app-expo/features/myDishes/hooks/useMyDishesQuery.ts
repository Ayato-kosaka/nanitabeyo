import { useCallback, useEffect, useMemo } from "react";
import { shallow } from "zustand/shallow";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import type { QueryMyDishesDto } from "@shared/api/v1/dto";
import type { MyDishItem, QueryMyDishesResponse } from "@shared/api/v1/res";
import { selectFilterQueryKey, toMyDishesQueryParams, useMyDishesFilterStore } from "../stores/useMyDishesFilterStore";
import { selectMyDishesRevision, useMyDishesRevisionStore } from "../stores/useMyDishesRevisionStore";
import {
	MY_DISHES_PAGE_SIZE,
	selectMyDishesByQuery,
	useMyDishesStore,
	type MyDishesFetcher,
	type MyDishesStore,
} from "../stores/useMyDishesStore";

/**
 * #1396 `GET /v1/users/me/dishes` に接続する共有クエリフック（設計書 (2/2) §3-3）。
 *
 * Map / リスト / Calendar が**同じ `queryKey`**（= フィルタの直列化）で同じスライスを見るので、
 * どのビューからこのフックを呼んでも取得は 1 回で済み、**ビュー切替では取り直さない**。
 *
 * 取り直すのは `queryKey` が変わったとき、すなわち
 * - フィルタ変更（status / category / rating / 期間 / sort）
 * - `commitArea`（「このエリアで再検索」）
 *
 * のときだけである。Map の pan / zoom は `queryKey` を変えない（viewport は store に入れない。§3-2）。
 */
export type UseMyDishesQueryResult = {
	/** `itemKeysByQuery` の順に並べ直した行 */
	items: MyDishItem[];
	/** 3 ビュー共通のキャッシュキー。Map の `map-pins`（PR4）も同じキーを使う */
	queryKey: string;
	isLoading: boolean;
	isLoadingMore: boolean;
	error: string | null;
	hasFetchedInitial: boolean;
	hasNextPage: boolean;
	/** Calendar（PR5）が「どこまで遡れるか」を知るための最古 `occurredAt`。無いこともある（#1395 §4-4） */
	oldestOccurredAt: string | null;
	/** 次ページ取得。終端・取得中は何もしない */
	loadMore: () => void;
	/** 明示的な再取得（引っ張って更新など） */
	refresh: () => void;
};

export const useMyDishesQuery = (options?: { enabled?: boolean }): UseMyDishesQueryResult => {
	const enabled = options?.enabled ?? true;
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();

	const filter = useMyDishesFilterStore((s) => s.filter);
	const queryKey = useMyDishesFilterStore(selectFilterQueryKey);

	const touchQuery = useMyDishesStore((s) => s.touchQuery);
	const fetchInitial = useMyDishesStore((s) => s.fetchInitial);
	const fetchMore = useMyDishesStore((s) => s.fetchMore);
	const revision = useMyDishesRevisionStore(selectMyDishesRevision);
	const { isLoading, isLoadingMore, error, hasFetchedInitial, hasNextPage, oldestOccurredAt } = useMyDishesStore(
		selectMyDishesByQuery(queryKey),
		shallow,
	);

	// ⚠️ `s.itemByKey` を**丸ごと購読しない**（独立レビュー指摘 High）。テーブル全体を購読すると、
	// 他ビュー・他 queryKey の取得 1 回で（keep-alive 中の）全フックが再レンダーする。
	// 行の配列へ materialize したうえで shallow 比較すれば、自分の行が変わらない限り再レンダーしない
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

	// #1396 【設計】store が持つのは「ユーザーが選んだもの」だけ。`cursor` / `limit` はここで足す（§3-1）
	const fetcher = useMemo<MyDishesFetcher>(() => {
		const params = toMyDishesQueryParams(filter);
		return async ({ cursor }) => {
			/*
			#1375（9 巡目・オーナー指摘「読み込みが重い」）**まず «どれくらい重いか» を測れるようにする。**

			この一覧の取得には所要時間の記録が 1 つも無く、「重い」と言われても
			**何ミリ秒なのかを誰も知らない**状態だった。1 ページ 42 件を減らすかどうかも、
			数字が無いままでは «たぶん速くなる» でしか判断できない。

			`Date.now()` の差だけを載せる（追加の往復も依存も増やさない）。見たいのは
			  - `duration_ms` … 体感そのもの
			  - `count` … 何件返ってきたか（ページ サイズを変える判断の分母）
			  - `is_first_page` … 初回表示か、続きの読み込みか
			である。失敗したときも «失敗までに何秒待たされたか» が要るので、必ず記録する。
			*/
			const startedAt = Date.now();
			try {
				const response = await callBackend<QueryMyDishesDto, QueryMyDishesResponse>("v1/users/me/dishes", {
					method: "GET",
					requestPayload: {
						...params,
						limit: MY_DISHES_PAGE_SIZE,
						...(cursor ? { cursor } : {}),
					},
				});
				logFrontendEvent({
					event_name: "my_dishes_fetch_completed",
					error_level: "log",
					payload: {
						duration_ms: Date.now() - startedAt,
						count: response.data?.length ?? 0,
						is_first_page: !cursor,
						limit: MY_DISHES_PAGE_SIZE,
					},
				});
				return {
					data: response.data ?? [],
					nextCursor: response.nextCursor,
					oldestOccurredAt: response.meta?.oldestOccurredAt ?? null,
				};
			} catch (error) {
				logFrontendEvent({
					event_name: "my_dishes_fetch_failed",
					error_level: "warn",
					payload: {
						duration_ms: Date.now() - startedAt,
						is_first_page: !cursor,
						error: error instanceof Error ? error.message : String(error),
					},
				});
				throw error;
			}
		};
	}, [callBackend, filter, logFrontendEvent]);

	// #1396 m-1: キャッシュヒット（下の effect が fetchInitial を呼ばない経路）でも LRU を touch する。
	// touchAndEvict を fetchInitial の副作用にだけ任せると、フィルタを往復してもキャッシュヒットでは
	// 一度も touch されず、直前に見ていた queryKey が「見ていないもの」として先に追い出されてしまう
	useEffect(() => {
		if (!enabled) return;
		touchQuery(queryKey);
	}, [enabled, queryKey, touchQuery]);

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
		if (!enabled) return;
		if (hasFetchedInitial || isLoading || error) return;
		void fetchInitial(queryKey, fetcher);
	}, [enabled, error, fetchInitial, fetcher, hasFetchedInitial, isLoading, queryKey, revision]);

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
