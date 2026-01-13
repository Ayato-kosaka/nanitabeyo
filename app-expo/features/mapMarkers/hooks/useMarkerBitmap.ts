import { useRef, useState, useCallback } from "react";
import { Platform } from "react-native";
import { captureRef } from "react-native-view-shot";
import { Directory, File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";

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

// #235 【設計】キャッシュディレクトリ（モダンAPI版）
// - 旧: `${FileSystem.cacheDirectory}marker-icons/`
// - 新: Paths.cache をベースに Directory オブジェクトで管理
const MARKER_CACHE_DIR = new Directory(Paths.cache, "marker-icons");

// #235 【設計】キャッシュ上限（最大200ファイル or 20MB）
const MAX_CACHE_FILES = 200;
const MAX_CACHE_SIZE_BYTES = 20 * 1024 * 1024;

/**
 * #235 【設計】キャッシュキーを生成（uri|size|color のハッシュ）
 */
const getCacheKey = async (params: MarkerBitmapParams): Promise<string> => {
	const key = `${params.uri ?? ""}|${params.size}|${params.color}`;
	const hash = await Crypto.digestStringAsync(
		Crypto.CryptoDigestAlgorithm.SHA256,
		key,
	);
	// #235 【設計】16文字に短縮（ファイル名として使用）
	return hash.substring(0, 16);
};

/**
 * #235 【設計】キャッシュディレクトリの初期化（モダンAPI版）
 *
 * Directory.create:
 *  - 同期メソッドだが、ここでは async ラッパーで包んでおく
 *  - intermediates / idempotent を true にすると複数回呼んでも安全
 */
const ensureCacheDir = async () => {
	try {
		MARKER_CACHE_DIR.create({
			intermediates: true,
			idempotent: true,
		});
	} catch (error) {
		console.warn("[useMarkerBitmap] Failed to ensure cache directory:", error);
		throw error;
	}
};

/**
 * #235 【設計】キャッシュファイル一覧取得（LRU管理用・モダンAPI版）
 *
 * - Directory.list() で File / Directory インスタンス一覧を取得
 * - File のみを対象に LRU 用メタデータを組み立て
 */
const getCacheFiles = async (): Promise<
	Array<{ file: File; uri: string; modificationTime: number; size: number }>
> => {
	try {
		await ensureCacheDir();

		// Directory.list() は同期メソッド
		const entries = MARKER_CACHE_DIR.list();

		const files = entries.filter(
			(entry): entry is File => entry instanceof File,
		);

		const fileInfos = files.map((file) => ({
			file,
			uri: file.uri,
			modificationTime: file.modificationTime ?? 0,
			size: file.size ?? 0,
		}));

		// #235 【設計】古い順にソート
		return fileInfos.sort((a, b) => a.modificationTime - b.modificationTime);
	} catch (error) {
		console.warn("[useMarkerBitmap] Failed to get cache files:", error);
		return [];
	}
};

/**
 * #235 【設計】古いキャッシュファイルを削除（LRU・モダンAPI版）
 *
 * - File.delete() を使用して削除
 */
const cleanupCache = async () => {
	try {
		const files = await getCacheFiles();
		const totalSize = files.reduce((sum, f) => sum + f.size, 0);

		let filesToDelete: Array<{
			file: File;
			uri: string;
			modificationTime: number;
			size: number;
		}> = [];

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

		// #235 【設計】削除実行（同期メソッド）
		for (const { file } of filesToDelete) {
			try {
				file.delete();
			} catch (error) {
				console.warn(
					`[useMarkerBitmap] Failed to delete cache file: ${file.uri}`,
					error,
				);
			}
		}

		if (filesToDelete.length > 0) {
			console.log(
				`[useMarkerBitmap] Cleaned up ${filesToDelete.length} cache files`,
			);
		}
	} catch (error) {
		console.warn("[useMarkerBitmap] Failed to cleanup cache:", error);
	}
};

/**
 * #235 【設計】Marker用bitmap生成・キャッシュ管理Hook（モダンAPI版）
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
			const cacheFile = new File(MARKER_CACHE_DIR, `${cacheKey}.png`);

			// #235 【設計】キャッシュヒットチェック
			if (cacheFile.exists) {
				console.log(`[useMarkerBitmap] Cache hit: ${cacheKey}`);
				setIconUri(cacheFile.uri);
				setIsReady(true);
				generatingRef.current = false;
				return;
			}

			// Web環境では生成をスキップ（react-native-maps-webは異なるマーカー処理）
			if (Platform.OS === "web") {
				console.warn("[useMarkerBitmap] Bitmap generation not supported on web");
				setIsReady(true);
				generatingRef.current = false;
				return;
			}

			// #235 【設計】キャッシュディレクトリ確保
			await ensureCacheDir();

			if (!viewRef.current) {
				console.warn("[useMarkerBitmap] View ref not ready");
				generatingRef.current = false;
				return;
			}

			// #235 【設計】View をキャプチャして PNG 生成
			console.log(`[useMarkerBitmap] Generating bitmap: ${cacheKey}`);

			const tmpUri = await captureRef(viewRef, {
				format: "png",
				quality: 1.0,
				result: "tmpfile",
			});

			// captureRef の結果 (file://...) を File インスタンスとして扱う
			const tmpFile = new File(tmpUri);

			// #235 【設計】キャッシュディレクトリに移動（モダンAPI版）
			// - File.move(destination) は同期メソッド
			tmpFile.move(cacheFile);

			console.log(`[useMarkerBitmap] Bitmap generated: ${cacheFile.uri}`);
			setIconUri(cacheFile.uri);
			setIsReady(true);

			// #235 【設計】キャッシュクリーンアップ（非同期・非ブロッキング）
			cleanupCache().catch((err) =>
				console.warn("[useMarkerBitmap] Cleanup failed:", err),
			);
		} catch (error) {
			console.error("[useMarkerBitmap] Failed to generate bitmap:", error);
			// #235 【設計】失敗時もreadyにして無限待機を防ぐ
			setIsReady(true);
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
