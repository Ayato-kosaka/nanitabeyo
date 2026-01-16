// app-expo/features/mapMarkers/hooks/useSkiaMarkerBitmap.ts

/**
 * #235 useSkiaMarkerBitmap
 *
 * 🎯 目的：
 * - Skia ベースのマーカー画像生成を React Hook として提供
 * - メモリキャッシュを活用した高速な画像生成
 * - 非同期生成中も UI をブロックしない
 *
 * 🧠 設計：
 * - 初回呼び出しで非同期に Skia 描画をキック
 * - 完了時に source をキャッシュ & isReady 更新
 * - エラー時は placeholder を使用（undefined を返す）
 */

import { useEffect, useState, useRef } from "react";
import { getOrGenerateMarkerBitmap, type MarkerBitmapKey } from "../utils/markerSkiaRenderer";

type UseSkiaMarkerBitmapResult = {
	source: { uri: string } | undefined;
	isReady: boolean;
	error?: Error;
};

/**
 * #235 【設計】Skia マーカー画像生成Hook
 *
 * @param key - { uri: サムネURL, size: ピンサイズ, color: 枠色 }
 * @returns { source: Marker に渡せる形式, isReady: 生成完了フラグ, error?: エラー }
 */
export function useSkiaMarkerBitmap(key: MarkerBitmapKey): UseSkiaMarkerBitmapResult {
	const [source, setSource] = useState<{ uri: string } | undefined>(undefined);
	const [isReady, setIsReady] = useState(false);
	const [error, setError] = useState<Error | undefined>(undefined);

	// 生成中フラグ（重複リクエスト防止）
	const generatingRef = useRef(false);
	const mountedRef = useRef(true);

	// キー変化を検知するための文字列化
	const keyString = `${key.uri}|${key.size}|${key.color}`;

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		// リセット（新しいキーに変わった場合）
		setSource(undefined);
		setIsReady(false);
		setError(undefined);
		generatingRef.current = false;

		// #235 【設計】非同期で画像生成
		const generate = async () => {
			if (generatingRef.current) return;
			generatingRef.current = true;

			try {
				const dataUri = await getOrGenerateMarkerBitmap(key);

				// アンマウント後の更新を防止
				if (!mountedRef.current) return;

				setSource({ uri: dataUri });
				setIsReady(true);
				setError(undefined);
			} catch (err) {
				console.error("[useSkiaMarkerBitmap] Generation failed:", err);

				if (!mountedRef.current) return;

				setSource(undefined);
				setIsReady(true); // エラーでも ready として扱う（placeholder表示のため）
				setError(err instanceof Error ? err : new Error(String(err)));
			} finally {
				generatingRef.current = false;
			}
		};

		generate();
	}, [keyString]); // keyString が変わるたびに再生成

	return {
		source,
		isReady,
		error,
	};
}
