import i18n from "@/lib/i18n";
// #1561 API の本文の形を信じない（lib/apiList.ts のヘッダ参照）
import { asApiList } from "@/lib/apiList";
import { toErrorLogMessage } from "@/lib/errorMessage";
import type { SupabaseDishCategories } from "@shared/converters/convert_dish_categories";
import { createWithEqualityFn } from "zustand/traditional";

// #472 【設計】保存トピック（DishCategory）を正規化してストア管理
export type DishCategory = Pick<SupabaseDishCategories, "id" | "image_url" | "labels" | "label_en">;

/**
 * 保存トピック（dish_categories）に関する正規化済みの状態を管理するストア。
 *
 * - dishCategoryById: dishCategory.id をキーにした正規化テーブル（唯一のソース・オブ・トゥルース）
 * - dishCategoryIdsByKey: 画面用途キーごとの並び順（プロフィールの保存済みトピックなど）
 * - isLoadingByKey / errorByKey: 画面用途キーごとの読み込み・エラー状態
 *
 * フェッチ処理自体はコンポーネントやサービス側で行い、
 * 本ストアは「正規化されたデータ」と「画面用途キーごとの状態」のみを扱う。
 */
export type DishCategoriesStore = {
	// ------ 内部状態（直接参照せず、セレクタ経由で読むことを推奨） ------

	/**
	 * dishCategory.id をキーにした正規化済み DishCategory のマップ。
	 * ここがトピック情報の唯一のソース・オブ・トゥルース。
	 */
	dishCategoryById: Record<string, DishCategory>;

	/**
	 * 画面用途キー（例: "profileSavedDishCategories"）ごとの dishCategory.id の配列。
	 * 並び順の管理のみを担当し、実体は dishCategoryById を参照する。
	 */
	dishCategoryIdsByKey: Record<string, string[]>;

	/**
	 * 画面用途キーごとのロード状態。
	 */
	isLoadingByKey: Record<string, boolean>;

	/**
	 * 画面用途キーごとのエラーメッセージ。
	 */
	errorByKey: Record<string, string | null>;

	/**
	 * 画面用途キーごとに初回取得が完了したかどうかを管理するフラグ。
	 */
	hasFetchedInitialByKey: Record<string, boolean>;

	/**
	 * カーソルページネーション用の nextCursor を画面用途キーごとに管理
	 */
	nextCursorByKey: Record<string, string | null>;

	/**
	 * 追加ページ取得中かどうかを画面用途キーごとに管理
	 */
	isLoadingMoreByKey: Record<string, boolean>;

	/**
	 * #1007 【設計】検索結果カード（DishCategoryRecommendation）単位の保存状態。dishCategoryById は「保存済みトピック一覧」用の
	 * 正規化データ（DishCategory型）であるのに対し、こちらは検索結果カード（DishCategoryRecommendation型）が参照する
	 * 保存フラグのみを dishCategory.categoryId をキーに持つ別枠のスライス。
	 */
	savedByDishCategoryId: Record<string, boolean>;

	// ------ public 挿入・更新メソッド（同期） ------

	/**
	 * DishCategory 配列を正規化して dishCategoryById を更新する。
	 * 並び順（dishCategoryIdsByKey）には触れない。
	 */
	upsertDishCategories: (items: DishCategory[]) => void;

	/**
	 * 指定キーの dishCategoryId 配列を更新する（並び順専用）。
	 */
	updateDishCategoryIdsByKey: (key: string, updater: (prevIds: string[]) => string[]) => void;

	/**
	 * 指定した DishCategory（dishCategory.id）をピンポイントに更新する。
	 */
	updateDishCategory: (dishCategoryId: string, dishCategoryUpdater: (dishCategory: DishCategory) => DishCategory) => void;

	/**
	 * #1007 【設計】検索結果カード（DishCategoryRecommendation）の保存状態を更新する。DishCategoryCard はこの値を購読し、
	 * カード再利用（Carousel の key 撤去）後もカテゴリ単位で保存状態を維持する。
	 */
	setDishCategorySaved: (dishCategoryId: string, isSaved: boolean) => void;

	// ------ public 挿入・更新メソッド（非同期ラッパー） ------

	/**
	 * 非同期に取得した dishCategoryId 配列で指定キーの dishCategoryIdsByKey を更新する。
	 */
	updateDishCategoryIdsByKeyAsync: (
		key: string,
		idsPromise: Promise<string[]>,
		updater: (prevIds: string[], fetchedIds: string[]) => string[],
	) => Promise<void>;

	// ------ public 削除メソッド ------

	/**
	 * 画面用途キーごとのエントリと状態をクリアする。
	 *
	 * - key を指定した場合:
	 *   - 該当 key の dishCategoryIdsByKey / isLoadingByKey / errorByKey を削除
	 *   - 他の key から参照されなくなった dishCategoryById の要素もクリーンアップ
	 *
	 * - key を省略した場合:
	 *   - 全てのキーと状態をクリア（完全リセット）
	 *   - savedByDishCategoryId も含めて破棄する（ユーザー切替時に前ユーザーの保存状態を残さない）
	 */
	clearByKey: (key?: string) => void;


	// ------ カーソルページネーション API ------

	/**
	 * 初期取得 + store への反映
	 */
	fetchInitialByKey: <TReq>(
		key: string,
		request: TReq,
		fetcher: (params: { cursor?: string | null; request?: TReq }) => Promise<{
			data: DishCategory[];
			nextCursor?: string | null;
		}>,
	) => Promise<void>;

	/**
	 * 追加ページ取得 + store への追記
	 */
	fetchMoreByKey: <TReq>(
		key: string,
		request: TReq | undefined,
		fetcher: (params: { cursor?: string | null; request?: TReq }) => Promise<{
			data: DishCategory[];
			nextCursor?: string | null;
		}>,
	) => Promise<void>;
};

/**
 * 画面用途キーごとの id 配列を取得するセレクタ。
 * - ids: dishCategory.id の配列（デフォルト 空配列）
 * - isLoading: 当該キーのロード中フラグ（デフォルト false）
 * - error: 当該キーのエラー（デフォルト null）
 * - hasNextPage: 次ページがあるかどうか（デフォルト false）
 * - isLoadingMore: 追加ページ取得中かどうか（デフォルト false）
 */
export const selectDishCategoryIdsByKey =
	(key: string) =>
	(
		state: DishCategoriesStore,
	): {
		ids: string[];
		isLoading: boolean;
		error: string | null;
		hasFetchedInitial: boolean;
		hasNextPage: boolean;
		isLoadingMore: boolean;
	} => {
		return {
			ids: state.dishCategoryIdsByKey[key] ?? [],
			isLoading: state.isLoadingByKey[key] ?? false,
			error: state.errorByKey[key] ?? null,
			hasFetchedInitial: state.hasFetchedInitialByKey[key] ?? false,
			hasNextPage: (state.nextCursorByKey[key] ?? null) !== null,
			isLoadingMore: state.isLoadingMoreByKey[key] ?? false,
		};
	};

/**
 * dishCategory.id から正規化済み DishCategory を取得するセレクタ。
 */
export const selectDishCategoryById =
	(dishCategoryId: string) =>
	(state: DishCategoriesStore): DishCategory | null =>
		state.dishCategoryById[dishCategoryId] ?? null;

/**
 * #1007 【設計】検索結果カード（DishCategoryRecommendation）の保存状態を取得するセレクタ。
 * store未登録時は呼び出し元が渡す fallback（サーバから受け取った item.isSaved 等）を採用する。
 */
export const selectIsDishCategorySaved =
	(dishCategoryId: string, fallback: boolean) =>
	(state: DishCategoriesStore): boolean =>
		state.savedByDishCategoryId[dishCategoryId] ?? fallback;

export const useDishCategoriesStore = createWithEqualityFn<DishCategoriesStore>()((set, get) => ({
	// ------ 初期状態 ------

	dishCategoryById: {},
	dishCategoryIdsByKey: {},
	isLoadingByKey: {},
	errorByKey: {},
	hasFetchedInitialByKey: {},
	nextCursorByKey: {},
	isLoadingMoreByKey: {},
	savedByDishCategoryId: {},

	// ------ 同期挿入・更新メソッド ------

	upsertDishCategories: (items) =>
		set((state) => {
			if (!items.length) return state;
			const dishCategoryPatch: Record<string, DishCategory> = {};

			for (const item of items) {
				const dishCategoryId = item.id;
				dishCategoryPatch[dishCategoryId] = item;
			}

			return {
				dishCategoryById: {
					...state.dishCategoryById,
					...dishCategoryPatch,
				},
			};
		}),

	updateDishCategoryIdsByKey: (key, updater) =>
		set((state) => {
			const prevIds = state.dishCategoryIdsByKey[key] ?? [];
			const nextIds = updater(prevIds);
			return {
				dishCategoryIdsByKey: {
					...state.dishCategoryIdsByKey,
					[key]: nextIds,
				},
			};
		}),

	updateDishCategory: (dishCategoryId, dishCategoryUpdater) =>
		set((state) => {
			return state.dishCategoryById[dishCategoryId] === undefined
				? state
				: {
						dishCategoryById: {
							...state.dishCategoryById,
							[dishCategoryId]: dishCategoryUpdater(state.dishCategoryById[dishCategoryId]),
						},
					};
		}),

	setDishCategorySaved: (dishCategoryId, isSaved) =>
		set((state) =>
			state.savedByDishCategoryId[dishCategoryId] === isSaved
				? state
				: { savedByDishCategoryId: { ...state.savedByDishCategoryId, [dishCategoryId]: isSaved } },
		),

	// ------ 非同期挿入・更新メソッド ------

	updateDishCategoryIdsByKeyAsync: async (key, promise, updater) =>
		handleAsyncAction(set, key, promise, (fetchedIds) =>
			get().updateDishCategoryIdsByKey(key, (prevIds) => updater(prevIds, fetchedIds)),
		),

	// ------ 削除メソッド ------

	clearByKey: (key) =>
		set((state) => {
			// key 未指定 → 全リセット
			if (!key) {
				return {
					dishCategoryById: {},
					dishCategoryIdsByKey: {},
					isLoadingByKey: {},
					errorByKey: {},
					hasFetchedInitialByKey: {},
					nextCursorByKey: {},
					isLoadingMoreByKey: {},
					// #1007 【設計】savedByDishCategoryId は画面用途キーに紐付かないため key 指定時は保持するが、
					// 完全リセット（AuthProvider のユーザー切替）では必ず破棄する。
					// selectIsDishCategorySaved は store 値をサーバの item.isSaved より優先するため、
					// 残したままだと新ユーザーに前ユーザーの保存状態が表示され、次のタップで逆向きの保存操作を送ってしまう。
					savedByDishCategoryId: {},
				};
			}

			// 該当キーを削除した dishCategoryIdsByKey / isLoadingByKey / errorByKey を作成
			const nextDishCategoryIdsByKey = { ...state.dishCategoryIdsByKey };
			const nextIsLoadingByKey = { ...state.isLoadingByKey };
			const nextErrorByKey = { ...state.errorByKey };
			const nextHasFetchedInitialByKey = { ...state.hasFetchedInitialByKey };
			const nextNextCursorByKey = { ...state.nextCursorByKey };
			const nextIsLoadingMoreByKey = { ...state.isLoadingMoreByKey };

			delete nextDishCategoryIdsByKey[key];
			delete nextIsLoadingByKey[key];
			delete nextErrorByKey[key];
			delete nextHasFetchedInitialByKey[key];
			delete nextNextCursorByKey[key];
			delete nextIsLoadingMoreByKey[key];

			// 残っているキーから参照されている dishCategoryId のみを dishCategoryById に残す
			const remainingDishCategoryIds = new Set<string>();
			for (const ids of Object.values(nextDishCategoryIdsByKey)) {
				for (const id of ids) {
					remainingDishCategoryIds.add(id);
				}
			}

			// dishCategoryById をクリーンアップ
			const nextDishCategoryById: Record<string, DishCategory> = {};
			for (const id of remainingDishCategoryIds) {
				const dishCategory = state.dishCategoryById[id];
				if (dishCategory) {
					nextDishCategoryById[id] = dishCategory;
				}
			}

			return {
				dishCategoryById: nextDishCategoryById,
				dishCategoryIdsByKey: nextDishCategoryIdsByKey,
				isLoadingByKey: nextIsLoadingByKey,
				errorByKey: nextErrorByKey,
				hasFetchedInitialByKey: nextHasFetchedInitialByKey,
				nextCursorByKey: nextNextCursorByKey,
				isLoadingMoreByKey: nextIsLoadingMoreByKey,
			};
		}),

	// ------ カーソルページネーション API の実装 ------

	fetchInitialByKey: (key, request, fetcher) =>
		handleAsyncAction(set, key, fetcher({ request }), (response) => {
			const { clearByKey, upsertDishCategories, updateDishCategoryIdsByKey } = get();
			// dishCategoryIdsByKey[key] を初期化してから新規データを反映
			clearByKey(key);

			// 1. エンティティを正規化して反映
			upsertDishCategories(asApiList(response.data));

			// 2. 並び順を id でセット
			const dishCategoryIds = asApiList(response.data).map((item) => item.id);
			updateDishCategoryIdsByKey(key, () => dishCategoryIds);

			// 3. nextCursor / hasFetchedInitial の更新
			set((state) => ({
				nextCursorByKey: { ...state.nextCursorByKey, [key]: response.nextCursor ?? null },
				hasFetchedInitialByKey: { ...state.hasFetchedInitialByKey, [key]: true },
			}));
		}),

	fetchMoreByKey: async (key, request, fetcher) => {
		const { nextCursorByKey, upsertDishCategories, updateDishCategoryIdsByKey } = get();
		const nextCursor = nextCursorByKey[key];

		// nextCursor が null の場合は何もしない
		if (nextCursor === null || nextCursor === undefined) return;

		return handleAsyncAction(
			set,
			key,
			fetcher({ cursor: nextCursor, request }),
			(response) => {
				// #1599 引っ張って更新に追い抜かれていたら、この応答は捨てる。
				// 判定は «自分が使ったカーソルが今も現在値か»
				//（`useDishMediaEntriesStore.fetchMoreByKey` と同じ作法）
				if (get().nextCursorByKey[key] !== nextCursor) return;
				// 1. エンティティを正規化
				upsertDishCategories(asApiList(response.data));

				// 2. 並び順の末尾に追加
				const dishCategoryIds = asApiList(response.data).map((item) => item.id);
				updateDishCategoryIdsByKey(key, (prevIds) => {
					// #CodeQL 【パフォーマンス】重複ID排除を Set で高速化（O(1)ルックアップ）
					const prevIdSet = new Set(prevIds);
					const newIds = dishCategoryIds.filter((id) => !prevIdSet.has(id));
					return [...prevIds, ...newIds];
				});

				// 3. nextCursorByKey[key] を更新
				set((prevState) => ({
					nextCursorByKey: { ...prevState.nextCursorByKey, [key]: response.nextCursor ?? null },
				}));
			},
			{ loadingType: "isLoadingMoreByKey" },
		);
	},
}));

// ------ 非同期挿入ヘルパー ------
const handleAsyncAction = <T>(
	set: (partial: Partial<DishCategoriesStore> | ((state: DishCategoriesStore) => Partial<DishCategoriesStore>)) => void,
	key: string,
	promise: Promise<T>,
	onSuccess: (response: T) => void | Promise<void>,
	option?: { loadingType?: keyof Pick<DishCategoriesStore, "isLoadingByKey" | "isLoadingMoreByKey"> },
) => {
	const { loadingType = "isLoadingByKey" } = option || {};
	// ローディング開始 & エラーリセット
	set((state) => ({
		[loadingType]: { ...state[loadingType], [key]: true },
		errorByKey: { ...state.errorByKey, [key]: null },
	}));

	return promise
		.then(async (items) => {
			await onSuccess(items);
		})
		.catch((err) => {
			// #1092 PR4b callBackend の失敗がそのまま来る。PR4a 以降ここには Error ではない
			// ApiError(plain object) も流れるため、置換前の (B) 式だと画面のエラー文言が
			// 「読み込みに失敗しました: [object Object]」になる。message を優先する共通関数へ寄せる。
			// ⚠️ err が falsy のときの null（i18n へ渡さない）は置換前のまま維持する
			const errorMessage = err ? toErrorLogMessage(err) : null;
			set((state) => ({
				errorByKey: {
					...state.errorByKey,
					[key]: i18n.t("Profile.tabError.failedToLoad", { error: errorMessage }),
				},
			}));
		})
		.finally(() => {
			set((state) => ({
				[loadingType]: { ...state[loadingType], [key]: false },
			}));
		});
};
