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
	// #1629【40】id → key の対応表。設計は下の useEffect のコメントを参照
	const keyByIdRef = useRef<Record<string, string>>({});
	const [keyById, setKeyById] = useState<Record<string, string>>({});

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
		// #1629【40】id → key の対応表もセッションと寿命を揃える（下の keyById の設計コメント）
		keyByIdRef.current = {};
		setKeyById({});
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

	/*
	#1629【40】【設計】**id → key の対応表は «窓から外れても捨てない»。**

	`descriptors` は先読みの «窓»（`computePreloadIds`）だけを写したものである。
	以前はこの対応表を descriptors から毎回作り直していたので、**窓から外れた id は
	`keyById` から消え、`getBackgroundImageState` が `idle` を返していた**。
	`DishMediaContent` は `idle` を «まだ読み込み中» と見なして `SkeletonShimmer` を
	出すので、**一度読み終わって表示できていたセルが、指を動かした拍子に
	スケルトンへ戻る**。オーナーの «チカチカする»（#1629【30】）も、投稿を削除した
	直後に隣のセルがローディングに見えるのも、根はここである。

	画像の実体（`imageStates`）は key で持っており窓の外でも保持しているので、
	**対応表さえ残せば、窓の外でも読み終わった絵をそのまま出せる**。
	新しいメモリを掴むわけではない（文字列 2 本が増えるだけ）。

	⚠️ 捨ててよいのは «セッションが変わったとき» だけ。`resetImageStates` が
	   `imageStates` と一緒に捨てる。ここで捨てる条件を増やさないこと。
	*/
	useEffect(() => {
		let changed = false;
		const next = { ...keyByIdRef.current };
		for (const descriptor of descriptors) {
			if (next[descriptor.id] === descriptor.key) continue;
			next[descriptor.id] = descriptor.key;
			changed = true;
		}
		if (!changed) return;
		keyByIdRef.current = next;
		setKeyById(next);
		// ⚠️ `sessionKey` を依存に入れること。`resetImageStates`（この下ではなく上の effect）が
		// 対応表を空にしたあと、descriptors の参照が変わらないと二度と埋め直されない
	}, [descriptors, sessionKey]);

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
