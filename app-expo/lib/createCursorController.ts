// #454 【設計】カーソルページネーションのロジックを純粋なTS関数として提供するユーティリティ
// React/Zustand非依存で、様々な用途で再利用可能

/**
 * カーソルページネーションの状態を表す型
 */
export type CursorState<TItem> = {
	items: TItem[];
	nextCursor: string | null;
	isLoadingInitial: boolean;
	isLoadingMore: boolean;
	error: unknown;
};

/**
 * カーソルページネーションのコントローラーインタフェース
 */
export type CursorController<TReq, TItem> = {
	getState: () => CursorState<TItem>;
	loadInitial: (req?: TReq) => Promise<void>;
	loadMore: () => Promise<void>;
	refresh: () => Promise<void>;
};

/**
 * データ取得関数の型定義
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
	 * アイテム更新時のコールバック
	 * @param items 新規取得されたアイテム
	 * @param isInitial 初期ロードかどうか
	 */
	onItemsUpdated?: (items: TItem[], isInitial: boolean) => void;
};

/**
 * カーソルページネーションコントローラーを作成する
 *
 * @param fetcher データ取得関数
 * @param opts オプション
 * @returns カーソルページネーションコントローラー
 *
 * @example
 * ```ts
 * const controller = createCursorController<MyRequest, MyItem>(
 *   async ({ cursor, request }) => {
 *     const response = await api.fetch({ cursor, ...request });
 *     return { data: response.items, nextCursor: response.nextCursor };
 *   },
 *   {
 *     onItemsUpdated: (items, isInitial) => {
 *       console.log('Items updated:', items.length, 'isInitial:', isInitial);
 *     }
 *   }
 * );
 *
 * await controller.loadInitial({ filter: 'active' });
 * await controller.loadMore();
 * ```
 */
export const createCursorController = <TReq, TItem>(
	fetcher: Fetcher<TReq, TItem>,
	opts?: CursorControllerOptions<TItem>,
): CursorController<TReq, TItem> => {
	let state: CursorState<TItem> = {
		items: [],
		nextCursor: null,
		isLoadingInitial: false,
		isLoadingMore: false,
		error: null,
	};

	let currentRequest: TReq | undefined = undefined;

	const setState = (updates: Partial<CursorState<TItem>>) => {
		state = { ...state, ...updates };
	};

	const loadInitial = async (request?: TReq): Promise<void> => {
		currentRequest = request;
		setState({ isLoadingInitial: true, error: null });
		try {
			const response = await fetcher({ request });
			const newItems = response.data;
			setState({
				items: newItems,
				nextCursor: response.nextCursor ?? null,
				isLoadingInitial: false,
			});
			// #454 【設計】初期ロード時は onItemsUpdated を呼び出してストア側に通知
			opts?.onItemsUpdated?.(newItems, true);
		} catch (err) {
			setState({
				error: err,
				items: [],
				nextCursor: null,
				isLoadingInitial: false,
			});
		}
	};

	const loadMore = async (): Promise<void> => {
		// #454 【設計】nextCursor が null の場合は何もしない
		if (state.isLoadingMore || state.nextCursor === null) return;

		setState({ isLoadingMore: true, error: null });
		try {
			const response = await fetcher({ cursor: state.nextCursor, request: currentRequest });
			const newItems = response.data;
			setState({
				items: [...state.items, ...newItems],
				nextCursor: response.nextCursor ?? null,
				isLoadingMore: false,
			});
			// #454 【設計】追加ロード時は onItemsUpdated を呼び出してストア側に通知
			opts?.onItemsUpdated?.(newItems, false);
		} catch (err) {
			setState({
				error: err,
				isLoadingMore: false,
			});
		}
	};

	const refresh = async (): Promise<void> => {
		// #454 【設計】直近のrequestを使って再取得
		await loadInitial(currentRequest);
	};

	return {
		getState: () => state,
		loadInitial,
		loadMore,
		refresh,
	};
};
