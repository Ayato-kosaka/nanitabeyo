// #454 【設計】createCursorController をベースに実装し直したコンポーネント内ローカル用途のHook
import { useCallback, useRef, useReducer } from "react";
import { createCursorController, type Fetcher } from "@/lib/createCursorController";

export const useCursorPagination = <TReq, TItem>(fetcher: Fetcher<TReq, TItem>) => {
	// #454 【設計】controllerRef を保持し、state 更新時に再描画トリガーを発火
	const controllerRef = useRef(createCursorController(fetcher));
	const [, forceUpdate] = useReducer((x) => x + 1, 0);

	// #454 【設計】controller が変わった場合は再生成（fetcher が変わる想定）
	if (controllerRef.current === undefined) {
		controllerRef.current = createCursorController(fetcher);
	}

	const loadInitial = useCallback(async (request?: TReq) => {
		await controllerRef.current.loadInitial(request);
		forceUpdate();
	}, []);

	const loadMore = useCallback(async () => {
		await controllerRef.current.loadMore();
		forceUpdate();
	}, []);

	const refresh = useCallback(async () => {
		await controllerRef.current.refresh();
		forceUpdate();
	}, []);

	const state = controllerRef.current.getState();

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
