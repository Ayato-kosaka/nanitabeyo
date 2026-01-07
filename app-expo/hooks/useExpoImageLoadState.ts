import { useState, useCallback, useEffect, useRef } from "react";

/**
 * #630 【設計】expo-image のロード状態管理フック（薄い共通化）
 *
 * TopicCard / DishMediaContent で expo-image のロード状態（loading/loaded/error）を
 * 薄く共通化するためのフック。失敗 UI やリトライ機能は含まず、各画面が自由に実装できる。
 *
 * @param sourceKey - 画像ソースを一意に識別するキー（通常は uri）。変更時に loading にリセット。
 *                    undefined の場合は画像ソースが未確定として loading 状態を維持。
 * @returns ロード状態と expo-image 用のイベントハンドラ
 */
export const useExpoImageLoadState = (sourceKey: string | undefined) => {
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const prevSourceKeyRef = useRef(sourceKey);

	// #630 【設計】sourceKey 変更時にロード状態をリセット（thumbnail → mediaUrl 切替対応）
	useEffect(() => {
		if (prevSourceKeyRef.current !== sourceKey) {
			setLoadState("loading");
			prevSourceKeyRef.current = sourceKey;
		}
	}, [sourceKey]);

	// #630 【設計】expo-image の onLoadStart ハンドラ
	const handleLoadStart = useCallback(() => {
		setLoadState("loading");
	}, []);

	// #630 【設計】expo-image の onLoad ハンドラ
	const handleLoad = useCallback(() => {
		setLoadState("loaded");
	}, []);

	// #630 【設計】expo-image の onError ハンドラ
	const handleError = useCallback(() => {
		setLoadState("error");
	}, []);

	return {
		loadState,
		handlers: {
			onLoadStart: handleLoadStart,
			onLoad: handleLoad,
			onError: handleError,
		},
	};
};
