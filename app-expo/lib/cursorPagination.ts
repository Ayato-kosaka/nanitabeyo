import { asApiList } from "@/lib/apiList";
/**
 * カーソルページネーションのロジックを、React / Zustand から切り離した純粋な TS 関数として提供する。
 *
 * @module cursorPagination
 */

/**
 * カーソルページネーションの状態
 */
export type CursorState<TItem> = {
	items: TItem[];
	nextCursor: string | null;
	isLoadingInitial: boolean;
	isLoadingMore: boolean;
	error: unknown;
};

/**
 * カーソルページネーションのコントローラー
 */
export type CursorController<TReq, TItem> = {
	getState: () => CursorState<TItem>;
	loadInitial: (req?: TReq) => Promise<void>;
	loadMore: () => Promise<void>;
	refresh: () => Promise<void>;
	subscribe: (listener: () => void) => () => void;
};

/**
 * データフェッチャー関数の型定義
 */
export type Fetcher<TReq, TItem> = (params: {
	cursor?: string | null;
	request?: TReq;
}) => Promise<{ data: TItem[]; nextCursor?: string | null }>;

/**
 * createCursorController のオプション
 */
export type CursorControllerOptions<TItem> = {
	/**
	 * アイテムが更新されたときに呼び出されるコールバック
	 * @param items - 新規取得分のアイテム
	 * @param isInitial - 初期取得かどうか
	 */
	onItemsUpdated?: (items: TItem[], isInitial: boolean) => void;
};

/**
 * カーソルページネーションのコントローラーを作成する。
 * React や Zustand に依存しない純粋な関数として実装。
 *
 * @param fetcher - データ取得関数
 * @param opts - オプション
 * @returns カーソルページネーションのコントローラー
 */
export const createCursorController = <TReq, TItem>(
	fetcher: Fetcher<TReq, TItem>,
	opts?: CursorControllerOptions<TItem>,
): CursorController<TReq, TItem> => {
	// 内部状態
	let state: CursorState<TItem> = {
		items: [],
		nextCursor: null,
		isLoadingInitial: false,
		isLoadingMore: false,
		error: null,
	};

	// 直近のリクエストパラメータを保持（refresh で利用）
	let lastRequest: TReq | undefined = undefined;

	// 状態更新の通知用リスナー（React 統合などで利用）
	const listeners = new Set<() => void>();

	/**
	 * 状態を更新し、リスナーに通知する
	 */
	const setState = (updater: Partial<CursorState<TItem>>) => {
		state = { ...state, ...updater };
		listeners.forEach((listener) => listener());
	};

	/**
	 * リスナーを登録する（React で useEffect などから利用）
	 */
	const subscribe = (listener: () => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};

	/**
	 * 初期データを読み込む
	 */
	const loadInitial = async (req?: TReq) => {
		lastRequest = req;
		setState({ isLoadingInitial: true, error: null });
		try {
			const response = await fetcher({ request: req });
			// #1375 外から来た配列を信じない（lib/apiList.ts）。`data: {}` でも空で描く
    const newItems = asApiList(response.data);
			setState({
				items: newItems,
				nextCursor: response.nextCursor ?? null,
				isLoadingInitial: false,
			});
			opts?.onItemsUpdated?.(newItems, true);
		} catch (err) {
			setState({
				items: [],
				nextCursor: null,
				error: err,
				isLoadingInitial: false,
			});
		}
	};

	/**
	 * 追加データを読み込む
	 */
	const loadMore = async () => {
		if (state.isLoadingMore || state.nextCursor === null) return;
		setState({ isLoadingMore: true, error: null });
		try {
			const response = await fetcher({ cursor: state.nextCursor, request: lastRequest });
			// #1375 外から来た配列を信じない（lib/apiList.ts）。`data: {}` でも空で描く
    const newItems = asApiList(response.data);
			setState({
				items: [...state.items, ...newItems],
				nextCursor: response.nextCursor ?? null,
				isLoadingMore: false,
			});
			opts?.onItemsUpdated?.(newItems, false);
		} catch (err) {
			setState({ error: err, isLoadingMore: false });
		}
	};

	/**
	 * リフレッシュ（直近のリクエストで再取得）
	 */
	const refresh = async () => {
		await loadInitial(lastRequest);
	};

	/**
	 * 現在の状態を取得する
	 */
	const getState = () => state;

	return {
		getState,
		loadInitial,
		loadMore,
		refresh,
		// 内部用（React 統合のため公開）
		subscribe: subscribe as any,
	};
};
