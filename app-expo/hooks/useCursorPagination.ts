import { useCallback, useEffect, useReducer, useRef } from "react";
import { createCursorController } from "@/lib/cursorPagination";
import type { Fetcher } from "@/lib/cursorPagination";

export const useCursorPagination = <TReq, TItem>(fetcher: Fetcher<TReq, TItem>) => {
	// #454 【設計】createCursorController を利用してコンポーネント内のローカル用途に限定
	const controllerRef = useRef(createCursorController(fetcher));
	const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

	// controller が変更されたら再作成（fetcher が変わった場合）
	useEffect(() => {
		controllerRef.current = createCursorController(fetcher);
		forceUpdate();
	}, [fetcher]);

	// state 更新時の再描画トリガー
	useEffect(() => {
		const controller = controllerRef.current;
		const unsubscribe = controller.subscribe?.(() => {
			forceUpdate();
		});
		return unsubscribe;
	}, [fetcher]);

	const controller = controllerRef.current;
	const state = controller.getState();

	const loadInitial = useCallback(async (request?: TReq) => {
		await controller.loadInitial(request);
	}, []);

	const loadMore = useCallback(async () => {
		await controller.loadMore();
	}, [controller]);

	const refresh = useCallback(async () => {
		await controller.refresh();
	}, [controller]);

	return {
		items: state.items,
		loadInitial,
		loadMore,
		refresh,
		error: state.error,
		isLoadingInitial: state.isLoadingInitial,
		isLoadingMore: state.isLoadingMore,
		hasNextPage: state.nextCursor !== null,
	};
};

export type CursorPaginationResult<TReq, TItem> = ReturnType<typeof useCursorPagination<TReq, TItem>>;
