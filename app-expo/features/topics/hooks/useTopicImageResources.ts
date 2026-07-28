import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { Image, type ImageRef, type ImageSource } from "expo-image";
import { Topic } from "@/types/search";
import { WIKIMEDIA_HEADERS } from "@/lib/wikimedia";
import { useLogger } from "@/hooks/useLogger";

export type TopicImageResourceState =
	| { status: "idle" }
	| { status: "loading" }
	// #802/#929 【設計】ready は表示イベントではなく、画面で共有できる source が確定した状態。
	// native は取得済み ImageRef、web は直接 URL を持ち、カードとサムネイルは必ず同じ値を参照する。
	| { status: "ready"; image: ImageRef | ImageSource }
	| { status: "error"; errorMessage?: string };

type TopicImageResourceStates = Record<string, TopicImageResourceState>;

type UseTopicImageResourcesParams = {
	topics: Topic[];
	sessionKey: string;
};

// categoryId だけでは同じ料理の画像 URL 更新を検知できないため、リソースの世代を URL まで含めて識別する。
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
 * #802/#929 【設計】Topics 画面を画像リソースの所有境界とし、カードとサムネイルへ同じ source を配る。
 * native は Image.loadAsync の完了を ready の根拠にして同じ ImageRef を共有し、表示側の onLoad 系イベントには依存しない。
 * web は Blob の生成と重複取得を避けるため URL を共有し、実際の表示失敗だけを onError から error へ反映する。
 * sessionKey が変わった後の非同期結果は現セッションへ混ぜず、所有権を失った ImageRef は必ず解放する。
 */
export const useTopicImageResources = ({ topics, sessionKey }: UseTopicImageResourcesParams) => {
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
		// generation を先に進めることで、キャンセル不能な旧 loadAsync の完了を新セッションへ混入させない。
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

			// #719/#929 【設計】expo-image 2.4.1 の web は loadAsync や空の headers でも
			// fetch→Blob URL を生成し、表示ごとの重複取得と解放不能な Blob を生む。
			// headers キーも含めず同じ URL を配り、ブラウザの通常キャッシュとリクエスト共有に委ねる。
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
				// #802/#929 【設計】native の URL 取得とキャッシュキー決定はこの一箇所に集約する。
				// loadAsync は native の disk cache を利用し、返した ImageRef を表示側が再利用するため、
				// 表示側 <Image> の cachePolicy を変えてもこの取得経路の disk cache 設定にはならない。
				const image = await Image.loadAsync({ uri: topic.imageUrl, headers: WIKIMEDIA_HEADERS, cacheKey: key });
				if (imageLoadGenerationRef.current !== imageLoadGeneration) {
					// 旧セッションの ImageRef はどの表示にも所有権を渡さないため、完了した時点で解放する。
					image.release();
					return;
				}
				topicImageStatesRef.current = {
					...topicImageStatesRef.current,
					[key]: { status: "ready", image },
				};
				setTopicImageStates(cloneTopicImageStates(topicImageStatesRef.current));
				// 表示イベントではなく共有リソースの準備時間を測り、onLoad 欠落が計測値や状態を左右しないようにする。
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
	 * web の ready は「共有する URL が確定済み」を表し、ネットワーク成功までは保証しない。
	 * 表示側の失敗だけをここで共有 error に変換し、カードとサムネイルに同じ再試行導線を出す。
	 */
	const markImageError = useCallback(
		(topic: Topic, errorMessage?: string) => {
			const key = getTopicImageKey(topic);
			const current = topicImageStatesRef.current[key];
			// 古い描画の onError で、すでに開始した再試行を error へ巻き戻さない。
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

	useEffect(() => {
		if (topics.length === 0) return;
		for (const topic of topics) {
			const key = getTopicImageKey(topic);
			const current = topicImageStatesRef.current[key];
			if (current) continue;
			void loadTopicImage(topic);
		}
	}, [topics, loadTopicImage]);

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
