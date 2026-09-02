import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { Image, type ImageRef, type ImageSource } from "expo-image";
import { DishCategoryRecommendation } from "@/types/search";
import { WIKIMEDIA_HEADERS } from "@/lib/wikimedia";
import { useLogger } from "@/hooks/useLogger";

export type DishCategoryImageResourceState =
	| { status: "idle" }
	| { status: "loading" }
	// #802/#929 【設計】ready は表示イベントではなく、画面で共有できる source が確定した状態。
	// native は取得済み ImageRef、web は直接 URL を持ち、カードとサムネイルは必ず同じ値を参照する。
	| { status: "ready"; image: ImageRef | ImageSource }
	| { status: "error"; errorMessage?: string };

type DishCategoryImageResourceStates = Record<string, DishCategoryImageResourceState>;

type UseDishCategoryImageResourcesParams = {
	dishCategories: DishCategoryRecommendation[];
	sessionKey: string;
};

// categoryId だけでは同じ料理の画像 URL 更新を検知できないため、リソースの世代を URL まで含めて識別する。
const getDishCategoryImageKey = (dishCategory: DishCategoryRecommendation) => `${dishCategory.categoryId}::${dishCategory.imageUrl}`;

const cloneDishCategoryImageStates = (states: DishCategoryImageResourceStates): DishCategoryImageResourceStates => ({ ...states });

/**
 * #929 【設計】ready state が保持する native の ImageRef のみを解放する。
 * web の ready state は uri を直接渡す ImageSource であり、native画像リソースを確保していないため対象外。
 */
const releaseIfImageRef = (image: ImageRef | ImageSource) => {
	if (typeof (image as Partial<ImageRef>).release === "function") {
		(image as ImageRef).release();
	}
};

/**
 * #1213 取得中の HTMLImageElement は、参照が切れると取得ごと中断されうる。決着するまで保持する。
 * 決着後は必ず外すので、画面を離れても要素が溜まり続けることはない。
 */
const pendingCacheWarmups = new Set<HTMLImageElement>();

/**
 * #1213 【修正】web の ready は「共有する URL が確定した」ことしか意味せず、実体の取得は
 * 表示側の `<img>` が最初に描かれたときに初めて始まる。カルーセルとサムネイルで全件を同時に
 * 描く DishCategories 検索画面ではそれで足りていたが、カードを **1 枚ずつしか描かない**画面
 * （友達投票の投票画面）では先読みが一切効かないのと同じで、候補を送るたびに取得完了まで
 * カード背景色(#EEE)が見えていた（実測: 画像応答を 1200ms 遅らせた環境で毎回 1200ms 前後）。
 *
 * ready の意味も描画経路も変えず、**ブラウザキャッシュへ実体だけ先に載せる**。
 * 後から同じ URL を `<img>` へ渡した時点でキャッシュヒットになり、グレーを挟まずに描ける。
 * fetch + Blob を使わないのは #719/#929 と同じ理由（解放不能な Blob と重複取得を作らない）。
 * 同じ URL の重複要求はブラウザ側で共有されるため、既に描画中の画像を二重に取りに行くことはない。
 *
 * SSR（web の静的レンダリング）では Platform.OS === "web" でも window が無いので、必ず存在確認する。
 */
const warmBrowserImageCache = (uri: string) => {
	if (typeof window === "undefined" || typeof window.Image !== "function") return;
	const image = new window.Image();
	const settle = () => {
		pendingCacheWarmups.delete(image);
	};
	image.onload = settle;
	image.onerror = settle;
	pendingCacheWarmups.add(image);
	image.decoding = "async";
	image.src = uri;
};

/**
 * #802/#929 【設計】DishCategories 画面を画像リソースの所有境界とし、カードとサムネイルへ同じ source を配る。
 * native は Image.loadAsync の完了を ready の根拠にして同じ ImageRef を共有し、表示側の onLoad 系イベントには依存しない。
 * web は Blob の生成と重複取得を避けるため URL を共有し、実際の表示失敗だけを onError から error へ反映する。
 * sessionKey が変わった後の非同期結果は現セッションへ混ぜず、所有権を失った ImageRef は必ず解放する。
 */
export const useDishCategoryImageResources = ({ dishCategories, sessionKey }: UseDishCategoryImageResourcesParams) => {
	const { logFrontendEvent } = useLogger();
	const dishCategoryImageStatesRef = useRef<DishCategoryImageResourceStates>({});
	const imageLoadGenerationRef = useRef(0);
	const [dishCategoryImageStates, setDishCategoryImageStates] = useState<DishCategoryImageResourceStates>({});

	/**
	 * #929 【設計】直前の setState commit(＝旧 <Image> の source 差し替え)より前に release すると
	 * 表示中の native 画像が消えるため、release は次の tick まで遅延させて実行する。
	 */
	const releaseStatesDeferred = useCallback((states: DishCategoryImageResourceStates) => {
		setTimeout(() => {
			for (const state of Object.values(states)) {
				if (state.status === "ready") releaseIfImageRef(state.image);
			}
		}, 0);
	}, []);

	const resetImageStates = useCallback(() => {
		// generation を先に進めることで、キャンセル不能な旧 loadAsync の完了を新セッションへ混入させない。
		imageLoadGenerationRef.current += 1;
		const previousStates = dishCategoryImageStatesRef.current;
		dishCategoryImageStatesRef.current = {};
		setDishCategoryImageStates({});
		releaseStatesDeferred(previousStates);
	}, [releaseStatesDeferred]);

	// #929 【設計】アンマウント時も検索セッション終了と同様に、保持中の ImageRef を解放する。
	useEffect(() => {
		return () => releaseStatesDeferred(dishCategoryImageStatesRef.current);
	}, [releaseStatesDeferred]);

	const loadDishCategoryImage = useCallback(
		async (dishCategory: DishCategoryRecommendation) => {
			const key = getDishCategoryImageKey(dishCategory);
			const current = dishCategoryImageStatesRef.current[key];
			if (current?.status === "loading" || current?.status === "ready") return;

			const imageLoadGeneration = imageLoadGenerationRef.current;
			dishCategoryImageStatesRef.current = {
				...dishCategoryImageStatesRef.current,
				[key]: { status: "loading" },
			};
			setDishCategoryImageStates(cloneDishCategoryImageStates(dishCategoryImageStatesRef.current));

			// #719/#929 【設計】expo-image 2.4.1 の web は loadAsync や空の headers でも
			// fetch→Blob URL を生成し、表示ごとの重複取得と解放不能な Blob を生む。
			// headers キーも含めず同じ URL を配り、ブラウザの通常キャッシュとリクエスト共有に委ねる。
			if (Platform.OS === "web") {
				// #1213 ready にする前に取得を始める（ready の意味・タイミングは変えない。上の warmBrowserImageCache 参照）
				warmBrowserImageCache(dishCategory.imageUrl);
				dishCategoryImageStatesRef.current = {
					...dishCategoryImageStatesRef.current,
					[key]: { status: "ready", image: { uri: dishCategory.imageUrl } },
				};
				setDishCategoryImageStates(cloneDishCategoryImageStates(dishCategoryImageStatesRef.current));
				return;
			}

			const loadStartedAt = Date.now();
			try {
				// #802/#929 【設計】native の URL 取得とキャッシュキー決定はこの一箇所に集約する。
				// loadAsync は native の disk cache を利用し、返した ImageRef を表示側が再利用するため、
				// 表示側 <Image> の cachePolicy を変えてもこの取得経路の disk cache 設定にはならない。
				const image = await Image.loadAsync({ uri: dishCategory.imageUrl, headers: WIKIMEDIA_HEADERS, cacheKey: key });
				if (imageLoadGenerationRef.current !== imageLoadGeneration) {
					// 旧セッションの ImageRef はどの表示にも所有権を渡さないため、完了した時点で解放する。
					image.release();
					return;
				}
				dishCategoryImageStatesRef.current = {
					...dishCategoryImageStatesRef.current,
					[key]: { status: "ready", image },
				};
				setDishCategoryImageStates(cloneDishCategoryImageStates(dishCategoryImageStatesRef.current));
				// 表示イベントではなく共有リソースの準備時間を測り、onLoad 欠落が計測値や状態を左右しないようにする。
				logFrontendEvent({
					event_name: "topic_image_resource_ready",
					error_level: "log",
					payload: {
						topic_id: dishCategory.categoryId,
						duration_ms: Date.now() - loadStartedAt,
						platform: Platform.OS,
					},
				});
			} catch (error: unknown) {
				if (imageLoadGenerationRef.current !== imageLoadGeneration) return;
				const errorMessage = error instanceof Error ? error.message : String(error);
				dishCategoryImageStatesRef.current = {
					...dishCategoryImageStatesRef.current,
					[key]: { status: "error", errorMessage },
				};
				setDishCategoryImageStates(cloneDishCategoryImageStates(dishCategoryImageStatesRef.current));
				logFrontendEvent({
					event_name: "topic_image_resource_load_error",
					error_level: "warn",
					payload: {
						topic_id: dishCategory.categoryId,
						image_url: dishCategory.imageUrl,
						error_message: errorMessage,
					},
				});
			}
		},
		[logFrontendEvent],
	);

	const retryImage = useCallback(
		(dishCategory: DishCategoryRecommendation) => {
			logFrontendEvent({
				event_name: "topic_image_manual_retry",
				error_level: "log",
				payload: {
					topic_id: dishCategory.categoryId,
					image_url: dishCategory.imageUrl,
				},
			});
			void loadDishCategoryImage(dishCategory);
		},
		[loadDishCategoryImage, logFrontendEvent],
	);

	/**
	 * web の ready は「共有する URL が確定済み」を表し、ネットワーク成功までは保証しない。
	 * 表示側の失敗だけをここで共有 error に変換し、カードとサムネイルに同じ再試行導線を出す。
	 */
	const markImageError = useCallback(
		(dishCategory: DishCategoryRecommendation, errorMessage?: string) => {
			const key = getDishCategoryImageKey(dishCategory);
			const current = dishCategoryImageStatesRef.current[key];
			// 古い描画の onError で、すでに開始した再試行を error へ巻き戻さない。
			if (current?.status === "error" || current?.status === "loading") return;

			dishCategoryImageStatesRef.current = {
				...dishCategoryImageStatesRef.current,
				[key]: { status: "error", errorMessage },
			};
			setDishCategoryImageStates(cloneDishCategoryImageStates(dishCategoryImageStatesRef.current));
			logFrontendEvent({
				event_name: "topic_image_resource_load_error",
				error_level: "warn",
				payload: {
					topic_id: dishCategory.categoryId,
					image_url: dishCategory.imageUrl,
					error_message: errorMessage ?? "render-side image load failed",
					platform: Platform.OS,
					source: "render_onerror",
				},
			});
		},
		[logFrontendEvent],
	);

	const getImageState = useCallback(
		(dishCategory: DishCategoryRecommendation) => dishCategoryImageStates[getDishCategoryImageKey(dishCategory)] ?? { status: "idle" as const },
		[dishCategoryImageStates],
	);

	useEffect(() => {
		resetImageStates();
	}, [sessionKey, resetImageStates]);

	// サムネイルは検索結果の全件を常時表示するナビゲーションであり、メインカードと同じ共有リソースを参照する。
	// 一部だけを先読みすると範囲外のサムネイルと循環Carouselの隣接カードがSkeletonのままになるため、
	// この画面では全件を事前取得する。
	useEffect(() => {
		if (dishCategories.length === 0) return;
		for (const dishCategory of dishCategories) {
			const key = getDishCategoryImageKey(dishCategory);
			const current = dishCategoryImageStatesRef.current[key];
			if (current) continue;
			void loadDishCategoryImage(dishCategory);
		}
	}, [dishCategories, loadDishCategoryImage]);

	return useMemo(
		() => ({
			imageStates: dishCategoryImageStates,
			getImageState,
			retryImage,
			markImageError,
			resetImageStates,
		}),
		[getImageState, retryImage, markImageError, dishCategoryImageStates, resetImageStates],
	);
};
