import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Platform } from "react-native";
import { captureRef } from "react-native-view-shot";
import * as FileSystem from "expo-file-system";
import * as Crypto from "expo-crypto";
import { BubblePinBitmap } from "./BubblePinBitmap";

// #235 【設計】オフスクリーン描画用Viewの配置位置（画面外）
const OFFSCREEN_POSITION = -9999;

// #235 【設計】キャッシュディレクトリ
const CACHE_DIR = `${FileSystem.cacheDirectory}marker-icons/`;

// #235 【設計】キャッシュ上限（最大200ファイル or 20MB）
const MAX_CACHE_FILES = 200;
const MAX_CACHE_SIZE_BYTES = 20 * 1024 * 1024;

// #235 【設計】同時生成数の上限（パフォーマンス対策）
const MAX_CONCURRENT_GENERATIONS = 2;

// #235 【設計】最大リトライ回数（生成失敗時）
const MAX_RETRY_COUNT = 3;

// #235 【設計】リトライ間隔（ms）
const RETRY_DELAY_MS = 500;

type GenerationRequest = {
	uri: string;
	size: number;
	color: string;
	priority: "high" | "low"; // #235 【設計】high=active(オンデマンド), low=inactive(初回優先)
};

type GenerationState = {
	iconUri: string | undefined;
	isReady: boolean;
	isGenerating: boolean;
	error: Error | undefined;
};

type MarkerBitmapRendererContextType = {
	requestBitmap: (request: GenerationRequest) => void;
	getState: (uri: string, size: number, color: string) => GenerationState;
	subscribe: (uri: string, size: number, color: string, callback: (state: GenerationState) => void) => () => void;
};

// #235 【設計】Context でグローバルな Renderer を提供
const MarkerBitmapRendererContext = React.createContext<MarkerBitmapRendererContextType | null>(null);

/**
 * #235 【設計】キャッシュキーを生成（uri|size|color のハッシュ）
 */
const getCacheKey = async (uri: string, size: number, color: string): Promise<string> => {
	// #235 【設計】色を正規化（rgb(...) → #RRGGBB）してキャッシュヒット率向上
	const normalizedColor = normalizeColor(color);
	const key = `${uri}|${size}|${normalizedColor}`;
	const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);
	return hash.substring(0, 16);
};

/**
 * #235 【設計】色を正規化（rgb(r, g, b) → #RRGGBB）
 */
const normalizeColor = (color: string): string => {
	// rgb(...) 形式を #RRGGBB に変換
	const rgbMatch = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
	if (rgbMatch) {
		const r = parseInt(rgbMatch[1], 10).toString(16).padStart(2, "0");
		const g = parseInt(rgbMatch[2], 10).toString(16).padStart(2, "0");
		const b = parseInt(rgbMatch[3], 10).toString(16).padStart(2, "0");
		return `#${r}${g}${b}`;
	}
	return color.toUpperCase();
};

/**
 * #235 【設計】キャッシュディレクトリの初期化
 */
const ensureCacheDir = async () => {
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
					modificationTime: info.exists && !info.isDirectory ? (info.modificationTime ?? 0) : 0,
					size: info.exists && !info.isDirectory ? (info.size ?? 0) : 0,
				};
			}),
		);
		return fileInfos.sort((a, b) => a.modificationTime - b.modificationTime);
	} catch (error) {
		console.warn("[MarkerBitmapRenderer] Failed to get cache files:", error);
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

		// #235 【設計】容量上限超過チェック
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
			console.log(`[MarkerBitmapRenderer] Cleaned up ${filesToDelete.length} cache files`);
		}
	} catch (error) {
		console.warn("[MarkerBitmapRenderer] Failed to cleanup cache:", error);
	}
};

/**
 * #235 【設計】MarkerBitmapRenderer Provider
 *
 * 全マーカーの bitmap 生成を一元管理する Renderer。
 * MapView の外に1個だけ配置し、オフスクリーン描画・生成キュー・キャッシュを担当。
 */
export function MarkerBitmapRendererProvider({ children }: { children: React.ReactNode }) {
	// #235 【設計】生成状態管理（uri|size|color → state）
	const [states, setStates] = useState<Map<string, GenerationState>>(new Map());

	// #235 【設計】生成キュー（優先度付き）
	const queueRef = useRef<GenerationRequest[]>([]);

	// #235 【設計】現在生成中の数
	const generatingCountRef = useRef(0);

	// #235 【設計】購読者管理
	const subscribersRef = useRef<Map<string, Set<(state: GenerationState) => void>>>(new Map());

	// #235 【設計】アンマウント検知用
	const isMountedRef = useRef(true);

	// #235 【設計】生成待ちの View 参照（1個の View で順次生成）
	const renderViewRef = useRef<View>(null);

	// #235 【設計】現在レンダリング中のリクエスト
	const [currentRequest, setCurrentRequest] = useState<GenerationRequest | null>(null);

	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	/**
	 * #235 【設計】状態の取得
	 */
	const getState = useCallback(
		(uri: string, size: number, color: string): GenerationState => {
			const key = `${uri}|${size}|${normalizeColor(color)}`;
			return (
				states.get(key) ?? {
					iconUri: undefined,
					isReady: false,
					isGenerating: false,
					error: undefined,
				}
			);
		},
		[states],
	);

	/**
	 * #235 【設計】状態の更新＆購読者への通知
	 */
	const updateState = useCallback((uri: string, size: number, color: string, update: Partial<GenerationState>) => {
		const key = `${uri}|${size}|${normalizeColor(color)}`;
		setStates((prev) => {
			const newStates = new Map(prev);
			const currentState = newStates.get(key) ?? {
				iconUri: undefined,
				isReady: false,
				isGenerating: false,
				error: undefined,
			};
			const newState = { ...currentState, ...update };
			newStates.set(key, newState);

			// #235 【設計】購読者に通知
			const subscribers = subscribersRef.current.get(key);
			if (subscribers) {
				subscribers.forEach((callback) => callback(newState));
			}

			return newStates;
		});
	}, []);

	/**
	 * #235 【設計】購読
	 */
	const subscribe = useCallback(
		(uri: string, size: number, color: string, callback: (state: GenerationState) => void) => {
			const key = `${uri}|${size}|${normalizeColor(color)}`;
			if (!subscribersRef.current.has(key)) {
				subscribersRef.current.set(key, new Set());
			}
			subscribersRef.current.get(key)!.add(callback);

			// #235 【設計】購読解除
			return () => {
				const subscribers = subscribersRef.current.get(key);
				if (subscribers) {
					subscribers.delete(callback);
					if (subscribers.size === 0) {
						subscribersRef.current.delete(key);
					}
				}
			};
		},
		[],
	);

	/**
	 * #235 【設計】キューから次のリクエストを取り出して生成開始
	 */
	const processQueue = useCallback(async () => {
		// #235 【設計】同時生成数の制限
		if (generatingCountRef.current >= MAX_CONCURRENT_GENERATIONS) {
			return;
		}

		// #235 【設計】優先度順にソート（high → low）
		queueRef.current.sort((a, b) => {
			if (a.priority === "high" && b.priority === "low") return -1;
			if (a.priority === "low" && b.priority === "high") return 1;
			return 0;
		});

		const request = queueRef.current.shift();
		if (!request) return;

		generatingCountRef.current++;

		try {
			await generateBitmap(request, 0);
		} finally {
			generatingCountRef.current--;
			// #235 【設計】次のキューを処理
			processQueue();
		}
	}, []);

	/**
	 * #235 【設計】bitmap 生成（リトライ付き）
	 */
	const generateBitmap = async (request: GenerationRequest, retryCount: number) => {
		const { uri, size, color } = request;

		try {
			// #235 【設計】キャッシュキー生成
			const cacheKey = await getCacheKey(uri, size, color);
			const cachedPath = `${CACHE_DIR}${cacheKey}.png`;

			// #235 【設計】キャッシュヒットチェック
			const cacheInfo = await FileSystem.getInfoAsync(cachedPath);
			if (cacheInfo.exists) {
				console.log(`[MarkerBitmapRenderer] Cache hit: ${cacheKey}`);
				updateState(uri, size, color, {
					iconUri: cachedPath,
					isReady: true,
					isGenerating: false,
				});
				return;
			}

			// #235 【設計】キャッシュディレクトリ確保
			await ensureCacheDir();

			// #235 【設計】Web環境では生成をスキップ
			if (Platform.OS === "web") {
				console.warn("[MarkerBitmapRenderer] Bitmap generation not supported on web");
				updateState(uri, size, color, {
					isReady: true,
					isGenerating: false,
				});
				return;
			}

			console.log(`[MarkerBitmapRenderer] Generating bitmap: ${cacheKey} (retry: ${retryCount})`);

			// #235 【設計】現在のリクエストを設定してレンダリングをトリガー
			setCurrentRequest(request);

			// #235 【設計】次フレーム以降に capture（ref 安定化のため）
			await new Promise((resolve) => requestAnimationFrame(resolve));
			await new Promise((resolve) => requestAnimationFrame(resolve));

			// #235 【設計】View をキャプチャして PNG 生成
			if (!renderViewRef.current) {
				throw new Error("View ref not ready");
			}

			// #235 【設計】captureRef(viewRef.current, ...) を使用（ref object ではなく実体）
			const tempUri = await captureRef(renderViewRef.current, {
				format: "png",
				quality: 1.0,
				result: "tmpfile",
			});

			// #235 【設計】キャッシュディレクトリに移動
			await FileSystem.moveAsync({
				from: tempUri,
				to: cachedPath,
			});

			console.log(`[MarkerBitmapRenderer] Bitmap generated: ${cachedPath}`);

			// #235 【設計】アンマウント済みなら setState しない
			if (!isMountedRef.current) {
				return;
			}

			updateState(uri, size, color, {
				iconUri: cachedPath,
				isReady: true,
				isGenerating: false,
			});

			// #235 【設計】キャッシュクリーンアップ（非同期・非ブロッキング）
			cleanupCache().catch((err) => console.warn("[MarkerBitmapRenderer] Cleanup failed:", err));
		} catch (error) {
			console.error(`[MarkerBitmapRenderer] Failed to generate bitmap (retry: ${retryCount}):`, error);

			// #235 【設計】リトライ制御
			if (retryCount < MAX_RETRY_COUNT) {
				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
				await generateBitmap(request, retryCount + 1);
			} else {
				// #235 【設計】最大リトライ回数超過
				console.error("[MarkerBitmapRenderer] Max retry count exceeded");
				if (isMountedRef.current) {
					updateState(uri, size, color, {
						isReady: true,
						isGenerating: false,
						error: error as Error,
					});
				}
			}
		}
	};

	/**
	 * #235 【設計】bitmap 生成リクエスト
	 */
	const requestBitmap = useCallback(
		(request: GenerationRequest) => {
			const { uri, size, color } = request;
			const key = `${uri}|${size}|${normalizeColor(color)}`;

			// #235 【設計】既に生成済み or 生成中ならスキップ
			const currentState = getState(uri, size, color);
			if (currentState.isReady || currentState.isGenerating) {
				return;
			}

			// #235 【設計】生成中フラグをセット
			updateState(uri, size, color, { isGenerating: true });

			// #235 【設計】キューに追加
			queueRef.current.push(request);

			// #235 【設計】キュー処理開始
			processQueue();
		},
		[getState, updateState, processQueue],
	);

	const contextValue: MarkerBitmapRendererContextType = {
		requestBitmap,
		getState,
		subscribe,
	};

	return (
		<MarkerBitmapRendererContext.Provider value={contextValue}>
			{children}

			{/* #235 【設計】オフスクリーン描画用の View（画面外に配置） */}
			<View
				style={{
					position: "absolute",
					left: OFFSCREEN_POSITION,
					top: OFFSCREEN_POSITION,
				}}>
				{currentRequest && (
					<View
						ref={renderViewRef}
						collapsable={false} // #235 【設計】最適化で潰れないように
					>
						<BubblePinBitmap uri={currentRequest.uri} size={currentRequest.size} color={currentRequest.color} />
					</View>
				)}
			</View>
		</MarkerBitmapRendererContext.Provider>
	);
}

/**
 * #235 【設計】MarkerBitmapRenderer Context を使用する Hook
 */
export function useMarkerBitmapRenderer() {
	const context = React.useContext(MarkerBitmapRendererContext);
	if (!context) {
		throw new Error("useMarkerBitmapRenderer must be used within MarkerBitmapRendererProvider");
	}
	return context;
}
