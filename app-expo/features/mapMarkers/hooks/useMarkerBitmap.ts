import { useEffect, useRef, useState, useCallback } from "react";
import { captureRef } from "react-native-view-shot";
// #1156 Expo SDK 54 で expo-file-system は新 API が既定になった。
// 旧 API(cacheDirectory / EncodingType / FileSystemUploadType 等)は legacy サブパスへ移動している。
import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

type MarkerBitmapParams = {
	uri: string | undefined;
	size: number;
	color: string;
};

type MarkerBitmapResult = {
	iconUri: string | undefined;
	isReady: boolean;
	viewRef: React.RefObject<any>;
	generateIfNeeded: () => Promise<void>;
};

// #235 【設計】キャッシュディレクトリ
const CACHE_DIR = `${FileSystem.cacheDirectory}marker-icons/`;

// #235 【設計】キャッシュ上限（最大200ファイル or 20MB）
const MAX_CACHE_FILES = 200;
const MAX_CACHE_SIZE_BYTES = 20 * 1024 * 1024;

/**
 * #235 【設計】キャッシュキーを生成（uri|size|color のハッシュ）
 */
const getCacheKey = async (params: MarkerBitmapParams): Promise<string> => {
	const key = `${params.uri ?? ""}|${params.size}|${params.color}`;
	const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);
	return hash.substring(0, 16); // #235 【設計】16文字に短縮（ファイル名として使用）
};

/**
 * #235 【設計】キャッシュディレクトリの初期化
 */
const ensureCacheDir = async () => {
	// #235 【設計】intermediates: true により、既存ディレクトリでもエラーなし
	await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
};

/**
 * #235 【設計】キャッシュファイル一覧取得（LRU管理用）
 */
const getCacheFiles = async (): Promise<Array<{ uri: string; modificationTime: number; size: number }>> => {
	try {
		await ensureCacheDir();
		const files = await FileSystem.readDirectoryAsync(CACHE_DIR);
		const fileInfos = await Promise.all(
			files.map(async (filename) => {
				const uri = `${CACHE_DIR}${filename}`;
				const info = await FileSystem.getInfoAsync(uri);
				return {
					uri,
					// #235 【設計】optional chaining で簡潔に記述
					modificationTime: info.exists && !info.isDirectory ? (info.modificationTime ?? 0) : 0,
					size: info.exists && !info.isDirectory ? (info.size ?? 0) : 0,
				};
			}),
		);
		return fileInfos.sort((a, b) => a.modificationTime - b.modificationTime); // #235 【設計】古い順にソート
	} catch (error) {
		console.warn("[useMarkerBitmap] Failed to get cache files:", error);
		return [];
	}
};

/**
 * #235 【設計】古いキャッシュファイルを削除（LRU）
 */
const cleanupCache = async () => {
	try {
		const files = await getCacheFiles();
		const totalSize = files.reduce((sum, f) => sum + f.size, 0);

		let filesToDelete: Array<{ uri: string; modificationTime: number; size: number }> = [];

		// #235 【設計】ファイル数上限超過チェック
		if (files.length > MAX_CACHE_FILES) {
			const excess = files.length - MAX_CACHE_FILES;
			filesToDelete = files.slice(0, excess);
		}

		// #235 【設計】容量上限超過チェック（O(1) ルックアップのため Set を使用）
		if (totalSize > MAX_CACHE_SIZE_BYTES) {
			const filesToDeleteSet = new Set(filesToDelete.map((f) => f.uri));
			let currentSize = totalSize;
			for (const file of files) {
				if (currentSize <= MAX_CACHE_SIZE_BYTES) break;
				if (!filesToDeleteSet.has(file.uri)) {
					filesToDelete.push(file);
					filesToDeleteSet.add(file.uri);
					currentSize -= file.size;
				}
			}
		}

		// #235 【設計】削除実行
		for (const file of filesToDelete) {
			await FileSystem.deleteAsync(file.uri, { idempotent: true });
		}

		if (filesToDelete.length > 0) {
			console.log(`[useMarkerBitmap] Cleaned up ${filesToDelete.length} cache files`);
		}
	} catch (error) {
		console.warn("[useMarkerBitmap] Failed to cleanup cache:", error);
	}
};

/**
 * #235 【設計】Marker用bitmap生成・キャッシュ管理Hook
 *
 * @deprecated このフックは非推奨です。
 * Bitmap Marker 方式（view-shot + FileSystem）はパフォーマンス問題があるため廃止されました。
 * 代わりに View Marker 方式の AvatarBubbleMarker コンポーネントを使用してください。
 *
 * @param params - { uri: 画像URL, size: ピンサイズ, color: 枠色 }
 * @returns { iconUri: 生成済みPNG URI, isReady: 生成完了フラグ, viewRef: View参照, generateIfNeeded: 生成トリガー }
 */
export const useMarkerBitmap = (params: MarkerBitmapParams): MarkerBitmapResult => {
	const [iconUri, setIconUri] = useState<string | undefined>(undefined);
	const [isReady, setIsReady] = useState(false);
	const viewRef = useRef<any>(null);
	const generatingRef = useRef(false);

	const generateIfNeeded = useCallback(async () => {
		if (!params.uri || generatingRef.current) {
			return;
		}

		try {
			generatingRef.current = true;

			// #235 【設計】キャッシュキー生成
			const cacheKey = await getCacheKey(params);
			const cachedPath = `${CACHE_DIR}${cacheKey}.png`;

			// #235 【設計】キャッシュヒットチェック
			const cacheInfo = await FileSystem.getInfoAsync(cachedPath);
			if (cacheInfo.exists) {
				console.log(`[useMarkerBitmap] Cache hit: ${cacheKey}`);
				setIconUri(cachedPath);
				setIsReady(true);
				generatingRef.current = false;
				return;
			}

			// #235 【設計】キャッシュディレクトリ確保
			await ensureCacheDir();

			// #235 【設計】View をキャプチャして PNG 生成
			console.log(`[useMarkerBitmap] Generating bitmap: ${cacheKey}`);

			// Web環境では生成をスキップ（react-native-maps-webは異なるマーカー処理）
			if (Platform.OS === "web") {
				console.warn("[useMarkerBitmap] Bitmap generation not supported on web");
				setIsReady(true);
				generatingRef.current = false;
				return;
			}

			if (!viewRef.current) {
				console.warn("[useMarkerBitmap] View ref not ready");
				generatingRef.current = false;
				return;
			}

			const uri = await captureRef(viewRef, {
				format: "png",
				quality: 1.0,
				result: "tmpfile",
			});

			// #235 【設計】キャッシュディレクトリに移動
			await FileSystem.moveAsync({
				from: uri,
				to: cachedPath,
			});

			console.log(`[useMarkerBitmap] Bitmap generated: ${cachedPath}`);
			setIconUri(cachedPath);
			setIsReady(true);

			// #235 【設計】キャッシュクリーンアップ（非同期・非ブロッキング）
			cleanupCache().catch((err) => console.warn("[useMarkerBitmap] Cleanup failed:", err));
		} catch (error) {
			console.error("[useMarkerBitmap] Failed to generate bitmap:", error);
			setIsReady(true); // #235 【設計】失敗時もreadyにして無限待機を防ぐ
		} finally {
			generatingRef.current = false;
		}
	}, [params.uri, params.size, params.color]);

	return {
		iconUri,
		isReady,
		viewRef,
		generateIfNeeded,
	};
};
