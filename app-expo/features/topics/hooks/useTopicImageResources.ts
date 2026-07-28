import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { Image, type ImageRef, type ImageSource } from "expo-image";
import { Topic } from "@/types/search";
import { WIKIMEDIA_HEADERS } from "@/lib/wikimedia";
import { useLogger } from "@/hooks/useLogger";

export type TopicImageResourceState =
	| { status: "idle" }
	| { status: "loading" }
	// #929 【設計】image は native では Image.loadAsync 済みの ImageRef、web では直接渡す URI ソース。
	// どちらも同一の state を cards/thumbnails 双方へ渡すことで、画面単位で1回だけ取得したリソースを共有する。
	| { status: "ready"; image: ImageRef | ImageSource }
	| { status: "error"; errorMessage?: string };

type TopicImageResourceStates = Record<string, TopicImageResourceState>;

type UseTopicImageResourcesParams = {
	topics: Topic[];
	sessionKey: string;
	// #1010 【設計】現在アクティブなカードのindex。プリロード範囲を activeIndex 基準に絞るために使う。
	activeIndex: number;
};

// #1010 【設計】アクティブカードの前後何枚分を同時にプリロードするか。
const PRELOAD_RADIUS = 2;

const getTopicImageKey = (topic: Topic) => `${topic.categoryId}::${topic.imageUrl}`;

const cloneTopicImageStates = (states: TopicImageResourceStates): TopicImageResourceStates => ({ ...states });

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
 * #802 【設計】Topics 画面の画像リソース取得状態を管理する。
 * 入力: 表示中の topics と検索条件を表す sessionKey。
 * 出力: cards/thumbnails が参照する画像 state、retry/reset 用の操作。
 * 副作用: 未取得画像を Image.loadAsync で先読みし、失敗時は error state として保持する。
 * 失敗時: 古い session の非同期結果は破棄し、現在 session の state のみ更新する。
 */
export const useTopicImageResources = ({ topics, sessionKey, activeIndex }: UseTopicImageResourcesParams) => {
	const { logFrontendEvent } = useLogger();
	const topicImageStatesRef = useRef<TopicImageResourceStates>({});
	const imageLoadGenerationRef = useRef(0);
	const [topicImageStates, setTopicImageStates] = useState<TopicImageResourceStates>({});

	/**
	 * #929 【設計】直前の setState commit(＝旧 <Image> の source 差し替え)より前に release すると
	 * 表示中の native 画像が消えるため、release は次の tick まで遅延させて実行する。
	 */
	const releaseStatesDeferred = useCallback((states: TopicImageResourceStates) => {
		setTimeout(() => {
			for (const state of Object.values(states)) {
				if (state.status === "ready") releaseIfImageRef(state.image);
			}
		}, 0);
	}, []);

	const resetImageStates = useCallback(() => {
		imageLoadGenerationRef.current += 1;
		const previousStates = topicImageStatesRef.current;
		topicImageStatesRef.current = {};
		setTopicImageStates({});
		releaseStatesDeferred(previousStates);
	}, [releaseStatesDeferred]);

	// #929 【設計】アンマウント時も検索セッション終了と同様に、保持中の ImageRef を解放する。
	useEffect(() => {
		return () => releaseStatesDeferred(topicImageStatesRef.current);
	}, [releaseStatesDeferred]);

	const loadTopicImage = useCallback(
		async (topic: Topic) => {
			const key = getTopicImageKey(topic);
			const current = topicImageStatesRef.current[key];
			if (current?.status === "loading" || current?.status === "ready") return;

			const imageLoadGeneration = imageLoadGenerationRef.current;
			topicImageStatesRef.current = {
				...topicImageStatesRef.current,
				[key]: { status: "loading" },
			};
			setTopicImageStates(cloneTopicImageStates(topicImageStatesRef.current));

			// #929 【設計】web の Image.loadAsync は fetch→blob→createObjectURL を internally 行い、
			// release() が実質no-opでBlob URLを解放できない(expo-image 2.4.1)。検索を繰り返す本画面では
			// Blob が蓄積し続けるため、web は取得を介さずURLをそのまま cards/thumbnails 双方へ渡す。
			// #929 【バグ】source に headers を渡すと(値が空オブジェクトでも)、expo-image web の
			// useHeaders が同じ fetch→blob 変換を <Image> インスタンスごとに個別実行してしまい、
			// ブラウザキャッシュ共有もdedupeも効かなくなる。web は #719 により実際のヘッダーを
			// 送れないため、headers キー自体を省略して plain <img src> 経路のみを使う。
			if (Platform.OS === "web") {
				topicImageStatesRef.current = {
					...topicImageStatesRef.current,
					[key]: { status: "ready", image: { uri: topic.imageUrl } },
				};
				setTopicImageStates(cloneTopicImageStates(topicImageStatesRef.current));
				return;
			}

			const loadStartedAt = Date.now();
			try {
				const image = await Image.loadAsync({ uri: topic.imageUrl, headers: WIKIMEDIA_HEADERS, cacheKey: key });
				if (imageLoadGenerationRef.current !== imageLoadGeneration) {
					// #929 【設計】古い検索セッションの結果はUIへ渡らないため、保持し続けずその場で解放する。
					image.release();
					return;
				}
				topicImageStatesRef.current = {
					...topicImageStatesRef.current,
					[key]: { status: "ready", image },
				};
				setTopicImageStates(cloneTopicImageStates(topicImageStatesRef.current));
				logFrontendEvent({
					event_name: "topic_image_resource_ready",
					error_level: "log",
					payload: {
						topic_id: topic.categoryId,
						duration_ms: Date.now() - loadStartedAt,
						platform: Platform.OS,
					},
				});
			} catch (error: unknown) {
				if (imageLoadGenerationRef.current !== imageLoadGeneration) return;
				const errorMessage = error instanceof Error ? error.message : String(error);
				topicImageStatesRef.current = {
					...topicImageStatesRef.current,
					[key]: { status: "error", errorMessage },
				};
				setTopicImageStates(cloneTopicImageStates(topicImageStatesRef.current));
				logFrontendEvent({
					event_name: "topic_image_resource_load_error",
					error_level: "warn",
					payload: {
						topic_id: topic.categoryId,
						image_url: topic.imageUrl,
						error_message: errorMessage,
					},
				});
			}
		},
		[logFrontendEvent],
	);

	const retryImage = useCallback(
		(topic: Topic) => {
			logFrontendEvent({
				event_name: "topic_image_manual_retry",
				error_level: "log",
				payload: {
					topic_id: topic.categoryId,
					image_url: topic.imageUrl,
				},
			});
			void loadTopicImage(topic);
		},
		[loadTopicImage, logFrontendEvent],
	);

	/**
	 * #929 【修正】表示側 <Image> の onError から呼び、該当 topic を error 状態へ遷移させる。
	 * web の ready state は URL を渡すだけで実際の読み込み成否を検証していないため
	 * (PR #980 レビュー指摘)、期限切れ・無効・一時的に取得不能な画像が「ready のまま
	 * 白いカード」になっていた。error へ遷移させることで native と同じ失敗オーバーレイと
	 * 再試行導線(retryImage)が表示される。retryImage は error state からの再取得を行うため、
	 * 一時的な失敗ならリトライで復帰できる。
	 */
	const markImageError = useCallback(
		(topic: Topic, errorMessage?: string) => {
			const key = getTopicImageKey(topic);
			const current = topicImageStatesRef.current[key];
			// すでに error / 再取得中(loading)の場合は上書きしない(遅延到着した onError で
			// リトライ中の状態を巻き戻さないため)
			if (current?.status === "error" || current?.status === "loading") return;

			topicImageStatesRef.current = {
				...topicImageStatesRef.current,
				[key]: { status: "error", errorMessage },
			};
			setTopicImageStates(cloneTopicImageStates(topicImageStatesRef.current));
			logFrontendEvent({
				event_name: "topic_image_resource_load_error",
				error_level: "warn",
				payload: {
					topic_id: topic.categoryId,
					image_url: topic.imageUrl,
					error_message: errorMessage ?? "render-side image load failed",
					platform: Platform.OS,
					source: "render_onerror",
				},
			});
		},
		[logFrontendEvent],
	);

	const getImageState = useCallback(
		(topic: Topic) => topicImageStates[getTopicImageKey(topic)] ?? { status: "idle" as const },
		[topicImageStates],
	);

	useEffect(() => {
		resetImageStates();
	}, [sessionKey, resetImageStates]);

	// #1010 【設計】全topics無条件のプリロードは検索結果の全画像を同時取得してしまうため、
	// activeIndex を基準とした前後 PRELOAD_RADIUS 件のみを先読み対象にする。
	// 範囲外へ出た画像の解放は resetImageStates/アンマウント時の release 経路に委ねる(二重取得はしない)。
	useEffect(() => {
		if (topics.length === 0) return;
		const start = Math.max(0, activeIndex - PRELOAD_RADIUS);
		const end = Math.min(topics.length - 1, activeIndex + PRELOAD_RADIUS);
		for (let i = start; i <= end; i++) {
			const topic = topics[i];
			const key = getTopicImageKey(topic);
			const current = topicImageStatesRef.current[key];
			if (current) continue;
			void loadTopicImage(topic);
		}
	}, [topics, activeIndex, loadTopicImage]);

	return useMemo(
		() => ({
			imageStates: topicImageStates,
			getImageState,
			retryImage,
			markImageError,
			resetImageStates,
		}),
		[getImageState, retryImage, markImageError, topicImageStates, resetImageStates],
	);
};
