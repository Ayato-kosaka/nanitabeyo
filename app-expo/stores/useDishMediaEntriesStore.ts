import i18n from "@/lib/i18n";
// #1561 API の本文の形を信じない（lib/apiList.ts のヘッダ参照）
import { asApiList } from "@/lib/apiList";
import { toErrorLogMessage } from "@/lib/errorMessage";
import type { DishMediaEntry } from "@shared/api/v1/res";
import { createWithEqualityFn } from "zustand/traditional";

// #457 【設計】レビュー単体の型定義
export type DishReview = DishMediaEntry["dish_reviews"][number];

// #457 【設計】正規化した料理メディアエントリ型（dish_reviews を dishReviewIds に置き換え）
export type NormalizedDishMediaEntry = Omit<DishMediaEntry, "dish_reviews"> & {
	dishReviewIds: string[];
};

// 【設計】dish_media と dish_reviews の ID 種類を型で区別
export type IdType = "dish_media" | "dish_reviews";

/**
 * 料理メディア（dish_media）に関する正規化済みの状態を管理するストア。
 *
 * - entriesByMediaId: dish_media.id をキーにした正規化テーブル（唯一のソース・オブ・トゥルース）
 * - reviewsByReviewId: 全ユーザーのレビューを正規化したテーブル
 * - mediaIdsByKey: 画面用途キーごとの並び順（feed / 検索結果 / プロフィールなど）
 * - myReviewIdsByKey: 自分のレビュー一覧用の reviewId 配列
 * - isLoadingByKey / errorByKey: 画面用途キーごとの読み込み・エラー状態
 *
 * フェッチ処理自体はコンポーネントやサービス側で行い、
 * 本ストアは「正規化されたデータ」と「画面用途キーごとの状態」のみを扱う。
 */
export type DishMediaEntriesStore = {
	// ------ 内部状態（直接参照せず、セレクタ経由で読むことを推奨） ------

	/**
	 * dish_media.id をキーにした正規化済み DishMediaEntry のマップ。
	 * ここが料理メディア情報の唯一のソース・オブ・トゥルース。
	 */
	entriesByMediaId: Record<string, NormalizedDishMediaEntry>;

	/**
	 * 画面用途キー（例: "map", "liked"）ごとの dish_media.id の配列。
	 * 並び順の管理のみを担当し、実体は entriesByMediaId を参照する。
	 */
	mediaIdsByKey: Record<string, string[]>;

	/**
	 * dish_review.id をキーにした全ユーザーの dish_reviews エントリのマップ。
	 * レビュー情報の唯一のソース・オブ・トゥルース。
	 */
	reviewsByReviewId: Record<string, DishReview>;

	/**
	 * 画面用途キーごとの dish_review.id の配列（並び順管理用）。
	 */
	reviewIdsByKey: Record<string, string[]>;

	/*
	#1629【35】【設計】**このセッションで削除された id の墓標。**

	`DishMediaFeed` / `DishMediaMap` は «開いた時点の並び» を自分の state へ固定する
	（`ids.length === 0 && liveIds.length > 0` のときだけ取り込む）。取り込んだあとは
	`mediaIdsByKey` が縮んでも縮まないので、**削除した投稿のセルが並びに残り続ける**。
	残ったセルは `entriesByMediaId` から実体が消えているため
	`useDishMediaBackgroundImageResources` の descriptor から外れ、背景画像の状態は
	`idle` のまま二度と動かない。`DishMediaContent` は idle を «まだ読み込み中» と見なして
	`SkeletonShimmer` を出し続けるので、**削除するとローディングが終わらない**
	（オーナー報告「投稿を削除するとローディングの無限ループになる」）。

	«ストアに実体が無い id は落とす» では直せない。`clearByKey` も実体を消すので、
	キーを捨てただけの場面まで «削除された» と誤判定してフィードが空になる。
	そこで **削除したことだけ**を明示的に記録し、固定した並びの持ち主はこれを見て落とす。

	dish_media.id と、それに巻き添えで消える dish_reviews.id の**両方**を入れる
	（`DishMediaFeed` は `idType="dish_reviews"` でも使われるため）。
	セッション中のユーザー自身の削除回数ぶんしか増えないので、掃除はしない。
	*/
	deletedIds: Record<string, true>;

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

	// ------ public 挿入・更新メソッド（同期） ------

	// #460 【設計】DishMediaEntry 配列を正規化してストアに反映（並び順には触れない）
	/**
	 * DishMediaEntry 配列を正規化して entriesByMediaId と reviewsByReviewId を更新する。
	 * 並び順（mediaIdsByKey / myReviewIdsByKey）には触れない。
	 */
	upsertDishMediaEntries: (items: DishMediaEntry[]) => void;

	/**
	 * 指定キーの mediaId 配列を更新する（並び順専用）。
	 */
	updateMediaIdsByKey: (key: string, updater: (prevIds: string[]) => string[]) => void;

	/**
	 * 指定キーの reviewId 配列を更新する（並び順専用）。
	 */
	updateReviewIdsByKey: (key: string, updater: (prevIds: string[]) => string[]) => void;

	/**
	 * 指定した DishMediaEntry（dish_media.id）をピンポイントに更新する。
	 */
	updateEntry: (
		dishMediaId: string,
		entryUpdater: (entry: NormalizedDishMediaEntry) => NormalizedDishMediaEntry,
	) => void;

	/**
	 * 指定した DishReview（dish_review.id）をピンポイントに更新する。
	 */
	updateReview: (dishReviewId: string, reviewUpdater: (review: DishReview) => DishReview) => void;

	// ------ public 挿入・更新メソッド（非同期ラッパー） ------
	/**
	 * 非同期に取得した mediaId 配列で指定キーの mediaIdsByKey を更新する。
	 */
	updateMediaIdsByKeyAsync: (
		key: string,
		idsPromise: Promise<string[]>,
		updater: (prevIds: string[], fetchedIds: string[]) => string[],
	) => Promise<void>;

	/**
	 * 非同期に取得した reviewId 配列で指定キーの reviewIdsByKey を更新する。
	 */
	updateReviewIdsByKeyAsync: (
		key: string,
		idsPromise: Promise<string[]>,
		updater: (prevIds: string[], fetchedIds: string[]) => string[],
	) => Promise<void>;

	// ------ public 削除メソッド ------

	/**
	 * #1513 論理削除した投稿（dish_media）をストアから取り除く。
	 *
	 * サーバ側で `deleted_at` が立つと以後の取得には出てこないが、**既に読み込み済みの
	 * 画面は再取得しない限りその投稿を持ち続ける**。フィード・検索結果・いいねタブ・
	 * 保存タブなどが同じ `entriesByMediaId` を共有しているので、ここで 1 回消せば
	 * 全部の並びから同時に消える。
	 *
	 * その投稿と一緒に作られたレビュー（`created_dish_media_id` が一致するもの）も
	 * 巻き添えで消す。サーバの削除単位と揃えないと、写真の無いレビューだけが残る。
	 */
	removeDishMediaEntry: (dishMediaId: string) => void;

	/**
	 * #1513 論理削除したレビュー（dish_reviews）をストアから取り除く。
	 * 紐づく dish_media は残す（サーバの削除単位と同じ）。
	 */
	removeDishReview: (dishReviewId: string) => void;

	/**
	 * 画面用途キーごとのエントリと状態をクリアする。
	 *
	 * - key を指定した場合:
	 *   - 該当 key の mediaIdsByKey / isLoadingByKey / errorByKey を削除
	 *   - 他の key から参照されなくなった entriesByMediaId の要素もクリーンアップ
	 *
	 * - key を省略した場合:
	 *   - 全てのキーと状態をクリア（完全リセット）
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
			data: DishMediaEntry[];
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
			data: DishMediaEntry[];
			nextCursor?: string | null;
		}>,
	) => Promise<void>;

	/**
	 * 初期取得 + store への反映（レビュー用）
	 */
	fetchInitialWithReviewsByKey: <TReq>(
		key: string,
		request: TReq,
		fetcher: (params: { cursor?: string | null; request?: TReq }) => Promise<{
			data: DishMediaEntry[];
			nextCursor?: string | null;
		}>,
	) => Promise<void>;

	/**
	 * 追加ページ取得 + store への追記（レビュー用）
	 */
	fetchMoreWithReviewsByKey: <TReq>(
		key: string,
		request: TReq | undefined,
		fetcher: (params: { cursor?: string | null; request?: TReq }) => Promise<{
			data: DishMediaEntry[];
			nextCursor?: string | null;
		}>,
	) => Promise<void>;
};

/**
 * 画面用途キーごとの id 配列を取得するセレクタ。
 * - ids: dish_media.id または dish_review.id の配列（デフォルト 空配列）
 * - isLoading: 当該キーのロード中フラグ（デフォルト false）
 * - error: 当該キーのエラー（デフォルト null）
 * - hasNextPage: 次ページがあるかどうか（デフォルト false）
 * - isLoadingMore: 追加ページ取得中かどうか（デフォルト false）
 */
export const selectIdsByKey =
	(key: string, idType: IdType) =>
	(
		state: DishMediaEntriesStore,
	): {
		ids: string[];
		isLoading: boolean;
		error: string | null;
		hasFetchedInitial: boolean;
		hasNextPage: boolean;
		isLoadingMore: boolean;
	} => {
		const ids = idType === "dish_media" ? (state.mediaIdsByKey[key] ?? []) : (state.reviewIdsByKey[key] ?? []);
		return {
			ids,
			isLoading: state.isLoadingByKey[key] ?? false,
			error: state.errorByKey[key] ?? null,
			hasFetchedInitial: state.hasFetchedInitialByKey[key] ?? false,
			hasNextPage: (state.nextCursorByKey[key] ?? null) !== null,
			isLoadingMore: state.isLoadingMoreByKey[key] ?? false,
		};
	};

/**
 * dish_media.id から正規化済み DishMediaEntry を取得するセレクタ。
 * レビュー情報が必要な場合は selectReviewsByMediaId や selectReviewByReviewId を併用する。
 */
export const selectEntryByMediaId =
	(mediaId: string) =>
	(state: DishMediaEntriesStore): NormalizedDishMediaEntry | null =>
		state.entriesByMediaId[mediaId] ?? null;

/**
 * dish_review.id から正規化済み DishMediaEntry を取得するセレクタ。
 * レビューに紐づく料理メディアエントリを返す。
 */
export const selectEntryByReviewId =
	(reviewId: string) =>
	(state: DishMediaEntriesStore): NormalizedDishMediaEntry | null => {
		const review = state.reviewsByReviewId[reviewId];
		if (!review) return null;
		// #1395 写真なしの「食べた」記録では created_dish_media_id が NULL になる。
		// String(null) は "null" という文字列になり entriesByMediaId["null"] を引いて
		// miss するため、落ちはしないが**検知できない形で静かに失敗する**。明示的に弾く
		const mediaId = review.created_dish_media_id;
		if (mediaId == null) return null;
		return state.entriesByMediaId[String(mediaId)] ?? null;
	};

/**
 * dish_media.id に紐づく全レビューを取得するセレクタ。
 */
export const selectReviewsByMediaId =
	(mediaId: string) =>
	(state: DishMediaEntriesStore): DishReview[] => {
		const entry = state.entriesByMediaId[mediaId];
		if (!entry) return [];
		return entry.dishReviewIds.map((id) => state.reviewsByReviewId[id]).filter((r): r is DishReview => !!r);
	};

/**
 * dish_review.id から特定のレビューを取得するセレクタ。
 */
export const selectReviewByReviewId =
	(reviewId: string) =>
	(state: DishMediaEntriesStore): DishReview | null =>
		state.reviewsByReviewId[reviewId] ?? null;

export const useDishMediaEntriesStore = createWithEqualityFn<DishMediaEntriesStore>()((set, get) => ({
	// ------ 初期状態 ------

	entriesByMediaId: {},
	mediaIdsByKey: {},
	reviewsByReviewId: {},
	reviewIdsByKey: {},
	// #1629【35】削除した id の墓標（型定義の JSDoc を参照）
	deletedIds: {},
	isLoadingByKey: {},
	errorByKey: {},
	hasFetchedInitialByKey: {},
	nextCursorByKey: {},
	isLoadingMoreByKey: {},

	// ------ 同期挿入・更新メソッド ------

	// #460 【設計】DishMediaEntry を正規化（並び順には触れない）
	upsertDishMediaEntries: (items) =>
		set((state) => {
			if (!items.length) return state;
			const { entriesPatch, reviewsPatch } = buildDishMediaPatches(state, items);
			return {
				entriesByMediaId: {
					...state.entriesByMediaId,
					...entriesPatch,
				},
				reviewsByReviewId: {
					...state.reviewsByReviewId,
					...reviewsPatch,
				},
			};
		}),

	// #460 【設計】並び順専用メソッド
	updateMediaIdsByKey: (key, updater) =>
		set((state) => {
			const prevIds = state.mediaIdsByKey[key] ?? [];
			const nextIds = updater(prevIds);
			return {
				mediaIdsByKey: {
					...state.mediaIdsByKey,
					[key]: nextIds,
				},
			};
		}),

	updateReviewIdsByKey: (key, updater) =>
		set((state) => {
			const prevIds = state.reviewIdsByKey[key] ?? [];
			const nextIds = updater(prevIds);
			return {
				reviewIdsByKey: {
					...state.reviewIdsByKey,
					[key]: nextIds,
				},
			};
		}),

	updateEntry: (dishMediaId, entryUpdater) =>
		set((state) => {
			return state.entriesByMediaId[dishMediaId] === undefined
				? state
				: {
						entriesByMediaId: {
							...state.entriesByMediaId,
							[dishMediaId]: entryUpdater(state.entriesByMediaId[dishMediaId]),
						},
					};
		}),

	updateReview: (dishReviewId, reviewUpdater) =>
		set((state) => {
			return state.reviewsByReviewId[dishReviewId] === undefined
				? state
				: {
						reviewsByReviewId: {
							...state.reviewsByReviewId,
							[dishReviewId]: reviewUpdater(state.reviewsByReviewId[dishReviewId]),
						},
					};
		}),

	// ------ 非同期挿入・更新メソッド ------
	updateMediaIdsByKeyAsync: async (key, promise, updater) =>
		handleAsyncAction(set, key, promise, (fetchedIds) =>
			get().updateMediaIdsByKey(key, (prevIds) => updater(prevIds, fetchedIds)),
		),

	updateReviewIdsByKeyAsync: async (key, promise, updater) =>
		handleAsyncAction(set, key, promise, (fetchedIds) =>
			get().updateReviewIdsByKey(key, (prevIds) => updater(prevIds, fetchedIds)),
		),

	// ------ 削除メソッド ------

	// #1513 論理削除した投稿を全キーから取り除く（宣言箇所のコメント参照）
	removeDishMediaEntry: (dishMediaId) =>
		set((state) => {
			// 一緒に消すのは「この投稿と一緒に作られたレビュー」だけ。
			// entry.dishReviewIds は同じ *料理* に付いた他人のレビューまで含むので、
			// それを消す集合にしてはいけない（他人の投稿の本文が巻き添えで消える）
			const removedReviewIds = new Set<string>();
			for (const [reviewId, review] of Object.entries(state.reviewsByReviewId)) {
				if (String(review.created_dish_media_id) === dishMediaId) {
					removedReviewIds.add(reviewId);
				}
			}

			// 同じ料理の他の投稿も、消えたレビューを dishReviewIds に持っている。
			// ここを外さないと本文欄が「存在しない id」を引き続けて 1 行分空く
			const nextEntriesByMediaId: Record<string, NormalizedDishMediaEntry> = {};
			for (const [mediaId, e] of Object.entries(state.entriesByMediaId)) {
				if (mediaId === dishMediaId) continue;
				nextEntriesByMediaId[mediaId] = e.dishReviewIds.some((id) => removedReviewIds.has(id))
					? { ...e, dishReviewIds: e.dishReviewIds.filter((id) => !removedReviewIds.has(id)) }
					: e;
			}

			const nextReviewsByReviewId = { ...state.reviewsByReviewId };
			for (const reviewId of removedReviewIds) {
				delete nextReviewsByReviewId[reviewId];
			}

			const nextMediaIdsByKey: Record<string, string[]> = {};
			for (const [key, ids] of Object.entries(state.mediaIdsByKey)) {
				nextMediaIdsByKey[key] = ids.filter((id) => id !== dishMediaId);
			}

			const nextReviewIdsByKey: Record<string, string[]> = {};
			for (const [key, ids] of Object.entries(state.reviewIdsByKey)) {
				nextReviewIdsByKey[key] = ids.filter((id) => !removedReviewIds.has(id));
			}

			return {
				entriesByMediaId: nextEntriesByMediaId,
				reviewsByReviewId: nextReviewsByReviewId,
				mediaIdsByKey: nextMediaIdsByKey,
				reviewIdsByKey: nextReviewIdsByKey,
				// #1629【35】並びを自分の state へ固定している画面（DishMediaFeed / DishMediaMap）が
				// «消えたセル» を落とせるように墓標を残す。巻き添えのレビュー id も入れる
				deletedIds: {
					...state.deletedIds,
					[dishMediaId]: true as const,
					...Object.fromEntries([...removedReviewIds].map((id) => [id, true as const])),
				},
			};
		}),

	// #1513 論理削除したレビューだけを取り除く（dish_media は残す）
	removeDishReview: (dishReviewId) =>
		set((state) => {
			const review = state.reviewsByReviewId[dishReviewId];
			if (!review) return state;

			const nextReviewsByReviewId = { ...state.reviewsByReviewId };
			delete nextReviewsByReviewId[dishReviewId];

			const nextReviewIdsByKey: Record<string, string[]> = {};
			for (const [key, ids] of Object.entries(state.reviewIdsByKey)) {
				nextReviewIdsByKey[key] = ids.filter((id) => id !== dishReviewId);
			}

			// entry 側の dishReviewIds からも外す。ここを忘れると
			// selectReviewsByMediaId が消えた id を引き続けて本文欄が 1 行分空く
			const mediaId = String(review.created_dish_media_id);
			const entry = state.entriesByMediaId[mediaId];
			const nextEntriesByMediaId = entry
				? {
						...state.entriesByMediaId,
						[mediaId]: {
							...entry,
							dishReviewIds: entry.dishReviewIds.filter((id) => id !== dishReviewId),
						},
					}
				: state.entriesByMediaId;

			return {
				entriesByMediaId: nextEntriesByMediaId,
				reviewsByReviewId: nextReviewsByReviewId,
				reviewIdsByKey: nextReviewIdsByKey,
				// #1629【35】レビュー単体の削除も同じく墓標を残す（`idType="dish_reviews"` のフィード用）
				deletedIds: { ...state.deletedIds, [dishReviewId]: true as const },
			};
		}),

	clearByKey: (key) =>
		set((state) => {
			// key 未指定 → 全リセット
			if (!key) {
				return {
					entriesByMediaId: {},
					mediaIdsByKey: {},
					reviewsByReviewId: {},
					reviewIdsByKey: {},
					isLoadingByKey: {},
					errorByKey: {},
					hasFetchedInitialByKey: {},
					nextCursorByKey: {},
					isLoadingMoreByKey: {},
				};
			}

			// 該当キーを削除した mediaIdsByKey / reviewIdsByKey / isLoadingByKey / errorByKey を作成
			const nextMediaIdsByKey = { ...state.mediaIdsByKey };
			const nextReviewIdsByKey = { ...state.reviewIdsByKey };
			const nextIsLoadingByKey = { ...state.isLoadingByKey };
			const nextErrorByKey = { ...state.errorByKey };
			const nextHasFetchedInitialByKey = { ...state.hasFetchedInitialByKey };
			const nextNextCursorByKey = { ...state.nextCursorByKey };
			const nextIsLoadingMoreByKey = { ...state.isLoadingMoreByKey };

			delete nextMediaIdsByKey[key];
			delete nextReviewIdsByKey[key];
			delete nextIsLoadingByKey[key];
			delete nextErrorByKey[key];
			delete nextHasFetchedInitialByKey[key];
			delete nextNextCursorByKey[key];
			delete nextIsLoadingMoreByKey[key];

			// 残っているキーから参照されている mediaId のみを entriesByMediaId に残す
			const remainingMediaIds = new Set<string>();
			for (const ids of Object.values(nextMediaIdsByKey)) {
				for (const id of ids) {
					remainingMediaIds.add(id);
				}
			}

			// reviews 側から参照されている mediaId も残す
			for (const reviewIds of Object.values(nextReviewIdsByKey)) {
				for (const reviewId of reviewIds) {
					const review = state.reviewsByReviewId[reviewId];
					// #1395 写真なし記録では NULL。ガードしないと GC 用 Set に "null" が混ざる
					if (review && review.created_dish_media_id != null) {
						remainingMediaIds.add(String(review.created_dish_media_id));
					}
				}
			}

			// entriesByMediaId をクリーンアップ
			const nextEntriesById: Record<string, NormalizedDishMediaEntry> = {};
			for (const id of remainingMediaIds) {
				const entry = state.entriesByMediaId[id];
				if (entry) {
					nextEntriesById[id] = entry;
				}
			}

			// #457 【設計】reviewsByReviewId をクリーンアップ（参照されているもののみ残す）
			const remainingReviewIds = new Set<string>();
			// reviewIdsByKey から参照されているレビュー
			for (const reviewIds of Object.values(nextReviewIdsByKey)) {
				for (const id of reviewIds) {
					remainingReviewIds.add(id);
				}
			}
			// entriesByMediaId から参照されているレビュー
			for (const entry of Object.values(nextEntriesById)) {
				for (const reviewId of entry.dishReviewIds) {
					remainingReviewIds.add(reviewId);
				}
			}

			const nextReviewsByReviewId: Record<string, DishReview> = {};
			for (const id of remainingReviewIds) {
				const review = state.reviewsByReviewId[id];
				if (review) nextReviewsByReviewId[id] = review;
			}

			return {
				entriesByMediaId: nextEntriesById,
				mediaIdsByKey: nextMediaIdsByKey,
				reviewsByReviewId: nextReviewsByReviewId,
				reviewIdsByKey: nextReviewIdsByKey,
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
			const { clearByKey, upsertDishMediaEntries, updateMediaIdsByKey } = get();
			// mediaIdsByKey[key] を初期化してから新規データを反映
			clearByKey(key);

			// 1. エンティティを正規化して反映
			upsertDishMediaEntries(asApiList(response.data));

			// 2. 並び順を id でセット
			const mediaIds = asApiList(response.data).map((item) => String(item.dish_media.id));
			updateMediaIdsByKey(key, () => mediaIds);

			// 3. nextCursor / hasFetchedInitial の更新
			set((state) => ({
				nextCursorByKey: { ...state.nextCursorByKey, [key]: response.nextCursor ?? null },
				hasFetchedInitialByKey: { ...state.hasFetchedInitialByKey, [key]: true },
			}));
		}),

	fetchMoreByKey: async (key, request, fetcher) => {
		const { nextCursorByKey, upsertDishMediaEntries, updateMediaIdsByKey } = get();
		const nextCursor = nextCursorByKey[key];

		// nextCursor が null の場合は何もしない
		if (nextCursor === null || nextCursor === undefined) return;

		return handleAsyncAction(
			set,
			key,
			fetcher({ cursor: nextCursor, request }),
			(response) => {
				// #1599 引っ張って更新に追い抜かれていたら、この応答は捨てる。
				// 追記すると «更新前のページ» が新しい一覧の末尾へ紛れ込み、
				// nextCursor も «更新前の連鎖» の値で上書きされる。
				//
				// 判定は **自分が使ったカーソルが今も現在値か**。まだ同じページ連鎖の
				// 上に居るならそのまま、更新や `clearByKey` が入っていれば
				// 別の値（または undefined）になっているのでそこで捨てる。
				if (get().nextCursorByKey[key] !== nextCursor) return;
				// 1. エンティティを正規化
				upsertDishMediaEntries(asApiList(response.data));

				// 2. 並び順の末尾に追加
				const mediaIds = asApiList(response.data).map((item) => String(item.dish_media.id));
				updateMediaIdsByKey(key, (prevIds) => {
					// #CodeQL 【バグ】重複IDを排除して追加（paginationで同じIDが返る場合に備える）
					const newIds = mediaIds.filter((id) => !prevIds.includes(id));
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

	fetchInitialWithReviewsByKey: async (key, request, fetcher) =>
		handleAsyncAction(set, key, fetcher({ request }), (response) => {
			const { clearByKey, upsertDishMediaEntries, updateReviewIdsByKey } = get();
			// reviewIdsByKey[key] を初期化してから新規データを反映
			clearByKey(key);

			// 1. エンティティを正規化して反映
			upsertDishMediaEntries(asApiList(response.data));

			// 2. 自分のレビュー一覧の id 配列をセット（最初のレビューのみ）
			const myReviewIds = asApiList(response.data)
				.filter((item) => item.dish_reviews.length > 0)
				.map((item) => String(item.dish_reviews[0].id));
			updateReviewIdsByKey(key, () => myReviewIds);

			// 3. nextCursor / hasFetchedInitial の更新
			set((state) => ({
				nextCursorByKey: { ...state.nextCursorByKey, [key]: response.nextCursor ?? null },
				hasFetchedInitialByKey: { ...state.hasFetchedInitialByKey, [key]: true },
			}));
		}),

	// #460 【設計】fetchMoreWithReviewsByKey を新API（upsertDishMediaEntries + updateReviewIdsByKey）に移行
	fetchMoreWithReviewsByKey: async (key, request, fetcher) => {
		const { nextCursorByKey, upsertDishMediaEntries, updateReviewIdsByKey } = get();
		const nextCursor = nextCursorByKey[key];

		// nextCursor が null の場合は何もしない
		if (nextCursor === null || nextCursor === undefined) return;

		return handleAsyncAction(
			set,
			key,
			fetcher({ cursor: nextCursor, request }),
			(response) => {
				// #1599 引っ張って更新に追い抜かれていたら、この応答は捨てる。
				// 追記すると «更新前のページ» が新しい一覧の末尾へ紛れ込み、
				// nextCursor も «更新前の連鎖» の値で上書きされる。
				//
				// 判定は **自分が使ったカーソルが今も現在値か**。まだ同じページ連鎖の
				// 上に居るならそのまま、更新や `clearByKey` が入っていれば
				// 別の値（または undefined）になっているのでそこで捨てる。
				if (get().nextCursorByKey[key] !== nextCursor) return;
				// 1. エンティティを正規化
				upsertDishMediaEntries(asApiList(response.data));

				// 2. 自分のレビュー一覧の id 配列の末尾に追加（最初のレビューのみ）
				const myReviewIds = asApiList(response.data)
					.filter((item) => item.dish_reviews.length > 0)
					.map((item) => String(item.dish_reviews[0].id));
				// #CodeQL 【バグ】レビューID重複防止のため、既存IDと重複しないもののみ追加
				updateReviewIdsByKey(key, (prevIds) => {
					const newIds = myReviewIds.filter((id) => !prevIds.includes(id));
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
	set: (
		partial: Partial<DishMediaEntriesStore> | ((state: DishMediaEntriesStore) => Partial<DishMediaEntriesStore>),
	) => void,
	key: string,
	promise: Promise<T>,
	onSuccess: (response: T) => void | Promise<void>,
	option?: { loadingType?: keyof Pick<DishMediaEntriesStore, "isLoadingByKey" | "isLoadingMoreByKey"> },
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
			// #940 【修正】useAPICall は API/HTTPエラーを Error インスタンスではなく
			// ApiError(プレーンオブジェクト、message フィールドを持つ)として throw するため、
			// String(err) では "[object Object]" になっていた。message フィールドを優先して抽出する
			// #1092 PR4b 同じ判定を各所へ手書きで散らさないよう共通関数へ寄せた（振る舞いは #940 のまま）
			// ⚠️ err が falsy のときの null（i18n へ渡さない）は維持する
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

// ------ 正規化ヘルパー ------
/**
 * DishMediaEntry 配列を正規化してパッチを生成するヘルパー。
 */
function buildDishMediaPatches(
	state: DishMediaEntriesStore,
	items: DishMediaEntry[],
): {
	entriesPatch: Record<string, NormalizedDishMediaEntry>;
	reviewsPatch: Record<string, DishReview>;
} {
	const entriesPatch: Record<string, NormalizedDishMediaEntry> = {};
	const reviewsPatch: Record<string, DishReview> = {};

	for (const item of items) {
		const { dish_reviews = [], ...rest } = item;
		const mediaId = String(item.dish_media.id);

		// #509 【設計】API から受け取った reviewIds を末尾に追加し、重複する既存 ID は除外
		// API から [古い → 新しい] 順で受け取った reviewIds を順に処理
		const newReviewIds = dish_reviews.map((review) => String(review.id));

		// reviews をパッチに積む
		for (const review of dish_reviews) {
			reviewsPatch[String(review.id)] = review;
		}

		// 既存 entry から dishReviewIds を取得（重複排除して末尾に移動）
		const existingEntry = entriesPatch[mediaId] ?? state.entriesByMediaId[mediaId];
		const existingReviewIds = existingEntry?.dishReviewIds ?? [];

		// 既存の reviewIds から新しい reviewIds を除外（後で末尾に追加するため）
		const filteredExistingIds = existingReviewIds.filter((id) => !newReviewIds.includes(id));

		// 既存の reviewIds + 新しい reviewIds で [古い → 新しい] の順序を維持
		const dishReviewIds = [...filteredExistingIds, ...newReviewIds];

		entriesPatch[mediaId] = { ...rest, dishReviewIds };
	}

	return { entriesPatch, reviewsPatch };
}
