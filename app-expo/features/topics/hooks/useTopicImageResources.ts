import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, type ImageRef } from "expo-image";
import { Topic } from "@/types/search";
import { WIKIMEDIA_HEADERS } from "@/lib/wikimedia";
import { useLogger } from "@/hooks/useLogger";

export type TopicImageResourceState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ready"; image: ImageRef }
	| { status: "error"; errorMessage?: string };

type TopicImageResourceStates = Record<string, TopicImageResourceState>;

type UseTopicImageResourcesParams = {
	topics: Topic[];
	sessionKey: string;
};

const getTopicImageKey = (topic: Topic) => `${topic.categoryId}::${topic.imageUrl}`;

const cloneTopicImageStates = (states: TopicImageResourceStates): TopicImageResourceStates => ({ ...states });

/**
 * #802 【設計】Topics 画面の画像リソース取得状態を管理する。
 * 入力: 表示中の topics と検索条件を表す sessionKey。
 * 出力: cards/thumbnails が参照する画像 state、retry/reset 用の操作。
 * 副作用: 未取得画像を Image.loadAsync で先読みし、失敗時は error state として保持する。
 * 失敗時: 古い session の非同期結果は破棄し、現在 session の state のみ更新する。
 */
export const useTopicImageResources = ({ topics, sessionKey }: UseTopicImageResourcesParams) => {
	const { logFrontendEvent } = useLogger();
	const topicImageStatesRef = useRef<TopicImageResourceStates>({});
	const imageLoadGenerationRef = useRef(0);
	const [topicImageStates, setTopicImageStates] = useState<TopicImageResourceStates>({});

	const resetImageStates = useCallback(() => {
		imageLoadGenerationRef.current += 1;
		topicImageStatesRef.current = {};
		setTopicImageStates({});
	}, []);

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

			try {
				const image = await Image.loadAsync({ uri: topic.imageUrl, headers: WIKIMEDIA_HEADERS, cacheKey: key });
				if (imageLoadGenerationRef.current !== imageLoadGeneration) return;
				topicImageStatesRef.current = {
					...topicImageStatesRef.current,
					[key]: { status: "ready", image },
				};
				setTopicImageStates(cloneTopicImageStates(topicImageStatesRef.current));
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
			resetImageStates,
		}),
		[getImageState, retryImage, topicImageStates, resetImageStates],
	);
};
