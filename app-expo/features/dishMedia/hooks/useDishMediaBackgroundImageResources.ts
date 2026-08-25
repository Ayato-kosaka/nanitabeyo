import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, type ImageRef } from "expo-image";
import { useLogger } from "@/hooks/useLogger";
import { getCacheKeyForImage } from "@/lib/image";
import {
	selectEntryByMediaId,
	selectEntryByReviewId,
	type DishMediaEntriesStore,
	type IdType,
	useDishMediaEntriesStore,
} from "@/stores/useDishMediaEntriesStore";
import {
	getDishMediaBackgroundImageKey,
	getDishMediaBackgroundImageUri,
} from "@/features/dishMedia/utils/backgroundImage";

export type DishMediaBackgroundImageState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ready"; image: ImageRef }
	| { status: "error"; errorMessage?: string };

type DishMediaBackgroundImageDescriptor = {
	id: string;
	key: string;
	uri?: string;
	mediaId?: string;
	mediaType?: string;
};

type DishMediaBackgroundImageStates = Record<string, DishMediaBackgroundImageState>;

type UseDishMediaBackgroundImageResourcesParams = {
	ids: string[];
	idType: IdType;
	sessionKey: string;
};

const BACKGROUND_IMAGE_LOAD_MAX_RETRY = 2;
const BACKGROUND_IMAGE_LOAD_RETRY_BASE_DELAY_MS = 700;

const cloneBackgroundImageStates = (states: DishMediaBackgroundImageStates): DishMediaBackgroundImageStates => ({
	...states,
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const loadImageResourceWithRetry = async (uri: string) => {
	let lastError: unknown;

	for (let attempt = 0; attempt <= BACKGROUND_IMAGE_LOAD_MAX_RETRY; attempt += 1) {
		try {
			return await Image.loadAsync({
				uri,
				cacheKey: getCacheKeyForImage(uri),
			});
		} catch (error: unknown) {
			lastError = error;

			if (attempt < BACKGROUND_IMAGE_LOAD_MAX_RETRY) {
				await wait(BACKGROUND_IMAGE_LOAD_RETRY_BASE_DELAY_MS * (attempt + 1));
			}
		}
	}

	throw lastError;
};

// #802 【設計】restaurant / reviews / likes など背景画像と無関係な store 更新で反応しないよう、
// 背景画像リソース descriptor にだけ依存する比較を行う。
export const areDishMediaBackgroundImageDescriptorsEqual = (
	a: DishMediaBackgroundImageDescriptor[],
	b: DishMediaBackgroundImageDescriptor[],
) => {
	if (a.length !== b.length) return false;

	return a.every((left, index) => {
		const right = b[index];
		if (!right) return false;
		return (
			left.id === right.id &&
			left.key === right.key &&
			left.uri === right.uri &&
			left.mediaId === right.mediaId &&
			left.mediaType === right.mediaType
		);
	});
};

/**
 * #802 【責務分離】親コンポーネントに entry 購読を持ち込まず、
 * 背景画像 preload に必要な最小 descriptor のみを購読する。
 * restaurant/reviews/likes 等の更新では反応せず、bgUri 変更時だけ preload を走らせる。
 */
export const useDishMediaBackgroundImageResources = ({
	ids,
	idType,
	sessionKey,
}: UseDishMediaBackgroundImageResourcesParams) => {
	const { logFrontendEvent } = useLogger();
	const imageStatesRef = useRef<DishMediaBackgroundImageStates>({});
	const imageLoadGenerationRef = useRef(0);
	const [imageStates, setImageStates] = useState<DishMediaBackgroundImageStates>({});

	/*
	#1375（全画面のクラッシュ棚卸し）**捨てる前に `release()` する。**

	以前はここで `imageStatesRef.current = {}` と参照を捨てるだけだった。
	`Image.loadAsync` が返す `ImageRef` は **ネイティブ側にデコード済みのビットマップを
	確保している**ので、JS の参照を捨てても GC が回るまで解放されない。
	この画面は全画面サイズの画像を扱うため、フィードを開閉して回ると
	Android の低メモリ端末で OOM に至る（＝ JS では捕まらないネイティブのクラッシュ）。

	同じ役割の `features/dishCategories/hooks/useDishCategoryImageResources.ts` は
	`releaseIfImageRef` を持っており解放している。**こちらだけ抜けていた。**

	⚠️ 解放は **次のティックで**行う。いま描かれている `<Image>` が同じ ImageRef を
	参照している最中に解放すると、その 1 フレームだけ画像が消える。
	（dishCategories 側の `releaseStatesDeferred` と同じ理由・同じ作法）
	*/
	const releaseStatesDeferred = useCallback((states: DishMediaBackgroundImageStates) => {
		setTimeout(() => {
			for (const state of Object.values(states)) {
				if (state.status !== "ready") continue;
				const image = state.image as Partial<{ release: () => void }>;
				if (typeof image?.release === "function") image.release();
			}
		}, 0);
	}, []);

	const resetImageStates = useCallback(() => {
		imageLoadGenerationRef.current += 1;
		const previousStates = imageStatesRef.current;
		imageStatesRef.current = {};
		setImageStates({});
		releaseStatesDeferred(previousStates);
	}, [releaseStatesDeferred]);

	// #802 【設計】processing 中の polling で thumbnailImageUrl -> mediaUrl に切り替わることがある。
	// bgUri を含む descriptor 単位で購読することで、新しい画像リソースだけを preload 対象にする。
	const descriptors = useDishMediaEntriesStore(
		useCallback(
			(state: DishMediaEntriesStore): DishMediaBackgroundImageDescriptor[] =>
				ids
					.map((id): DishMediaBackgroundImageDescriptor | null => {
						const entry = idType === "dish_media" ? selectEntryByMediaId(id)(state) : selectEntryByReviewId(id)(state);
						if (!entry) return null;

						const uri = getDishMediaBackgroundImageUri(entry) ?? undefined;
						return {
							id,
							key: getDishMediaBackgroundImageKey(entry),
							uri,
							mediaId: entry.dish_media.id,
							mediaType: entry.dish_media.media_type,
						};
					})
					.filter((descriptor): descriptor is DishMediaBackgroundImageDescriptor => descriptor !== null),
			[idType, ids],
		),
		areDishMediaBackgroundImageDescriptorsEqual,
	);

	const keyById = useMemo(
		() => Object.fromEntries(descriptors.map((descriptor) => [descriptor.id, descriptor.key])),
		[descriptors],
	);

	// #802 【設計】表示の真実は Image.loadAsync で取得した ImageRef の ready/error に置く。
	// 表示側 Image の mount/cache hit/re-render による load イベント欠落は状態決定に使わない。
	const loadBackgroundImage = useCallback(
		async (descriptor: DishMediaBackgroundImageDescriptor) => {
			const { key, uri, mediaId, mediaType } = descriptor;
			const current = imageStatesRef.current[key];
			if (current?.status === "loading" || current?.status === "ready" || current?.status === "error") return;

			if (!uri) {
				console.warn("[DishMediaBackgroundImageResources] bgUri is undefined", {
					mediaId,
					mediaType,
				});
				const errorMessage = "background image uri is undefined";
				imageStatesRef.current = {
					...imageStatesRef.current,
					[key]: { status: "error", errorMessage },
				};
				setImageStates(cloneBackgroundImageStates(imageStatesRef.current));
				logFrontendEvent({
					event_name: "dish_media_background_image_resource_load_error",
					error_level: "warn",
					payload: {
						media_id: mediaId ?? null,
						media_type: mediaType ?? null,
						bg_uri: null,
						error_message: errorMessage,
					},
				});
				return;
			}

			const imageLoadGeneration = imageLoadGenerationRef.current;
			imageStatesRef.current = {
				...imageStatesRef.current,
				[key]: { status: "loading" },
			};
			setImageStates(cloneBackgroundImageStates(imageStatesRef.current));

			try {
				const image = await loadImageResourceWithRetry(uri);
				if (imageLoadGenerationRef.current !== imageLoadGeneration) {
					// 旧セッションの ImageRef はどの表示にも渡らないので、その場で解放する
					// （topics 側 `useTopicImageResources.ts` と同じ扱い）
					const stale = image as Partial<{ release: () => void }>;
					if (typeof stale?.release === "function") stale.release();
					return;
				}
				imageStatesRef.current = {
					...imageStatesRef.current,
					[key]: { status: "ready", image },
				};
				setImageStates(cloneBackgroundImageStates(imageStatesRef.current));
			} catch (error: unknown) {
				if (imageLoadGenerationRef.current !== imageLoadGeneration) return;
				const errorMessage = error instanceof Error ? error.message : String(error);
				imageStatesRef.current = {
					...imageStatesRef.current,
					[key]: { status: "error", errorMessage },
				};
				setImageStates(cloneBackgroundImageStates(imageStatesRef.current));
				logFrontendEvent({
					event_name: "dish_media_background_image_resource_load_error",
					error_level: "warn",
					payload: {
						media_id: mediaId ?? null,
						media_type: mediaType ?? null,
						bg_uri: uri,
						error_message: errorMessage,
					},
				});
			}
		},
		[logFrontendEvent],
	);

	useEffect(() => {
		resetImageStates();
	}, [sessionKey, resetImageStates]);

	// 画面を離れるときも解放する。これが無いと «最後に見ていたぶん» が残り続ける
	useEffect(
		() => () => {
			imageLoadGenerationRef.current += 1;
			releaseStatesDeferred(imageStatesRef.current);
			imageStatesRef.current = {};
		},
		[releaseStatesDeferred],
	);

	// #802 【設計】descriptor の key が変わったものだけ Image.loadAsync を走らせる。
	useEffect(() => {
		if (descriptors.length === 0) return;
		for (const descriptor of descriptors) {
			const current = imageStatesRef.current[descriptor.key];
			if (current?.status === "loading" || current?.status === "ready" || current?.status === "error") continue;
			void loadBackgroundImage(descriptor);
		}
	}, [descriptors, loadBackgroundImage]);

	const getBackgroundImageState = useCallback(
		(id: string) => {
			const key = keyById[id];
			if (!key) return { status: "idle" as const };
			return imageStates[key] ?? { status: "idle" as const };
		},
		[keyById, imageStates],
	);

	return useMemo(
		() => ({
			imageStates,
			getBackgroundImageState,
			resetImageStates,
		}),
		[getBackgroundImageState, imageStates, resetImageStates],
	);
};
