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

	/*
	#1375（全画面のクラッシュ棚卸し）**3 つとも `controllerRef.current` を «呼ぶ瞬間» に読む。**

	以前は `loadInitial` だけが deps 空で、**初回レンダーの controller を掴んだまま**だった。
	`fetcher` が変わると上の effect が controller を作り直すので、
	`loadInitial()` を呼んでも画面が見ている controller は一生更新されない
	（＝一覧が空のまま・ローディングも出ない）。

	逆に `loadMore` / `refresh` は deps に `controller` を持っていたため、
	**レンダーのたびに identity が変わる**。これを `useFocusEffect` の依存に入れている
	画面（通知タブ）では、effect → 取得 → 再レンダー → 新しい関数 → effect …
	と **API を無限に叩き続けていた**。

	参照を ref 経由にすれば、常に «いまの controller» を呼びつつ identity は固定できる。
	どちらの不具合も同時に消える。
	*/
	const loadInitial = useCallback(async (request?: TReq) => {
		await controllerRef.current.loadInitial(request);
	}, []);

	const loadMore = useCallback(async () => {
		await controllerRef.current.loadMore();
	}, []);

	const refresh = useCallback(async () => {
		await controllerRef.current.refresh();
	}, []);

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
