import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
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

// #235 【設計】同時生成数の上限（パフォーマンス対策）- 1に固定して取り違えバグを防止
const MAX_CONCURRENT_GENERATIONS = 1;

// #235 【設計】最大リトライ回数（生成失敗時）
const MAX_RETRY_COUNT = 3;

// #235 【設計】リトライ間隔（ms）
const RETRY_DELAY_MS = 500;

// #235 【設計】アクティブ色（正規化済み）
export const ACTIVE_COLOR_HEX = "#3477F8";
// #235 【設計】非アクティブ色（正規化済み）
export const INACTIVE_COLOR_HEX = "#FFFFFF";

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

/**
 * #235 【設計】外部ストア（useSyncExternalStore用）
 * React の render 規約に沿った購読を実現するため、状態を外部で管理
 */
type MarkerBitmapStore = {
	states: Map<string, GenerationState>;
	listeners: Set<() => void>;
	queue: GenerationRequest[];
	generatingCount: number;
	isProcessing: boolean; // #235 【バグ修正】processQueue 再入防止フラグ

	// #235 【設計】購読（useSyncExternalStore用）
	subscribe: (listener: () => void) => () => void;
	// #235 【設計】スナップショット取得
	getSnapshot: (key: string) => GenerationState;
	// #235 【設計】状態の初期化（未登録時）
	ensureState: (key: string) => void;
	// #235 【設計】状態更新（React外で実行）
	updateState: (key: string, update: Partial<GenerationState>) => void;
	// #235 【設計】bitmap生成リクエスト
	requestBitmap: (request: GenerationRequest) => void;
};

type MarkerBitmapRendererContextType = {
	store: MarkerBitmapStore;
};

// #235 【設計】Context でストアを提供
const MarkerBitmapRendererContext = React.createContext<MarkerBitmapRendererContextType | null>(null);

/**
 * #235 【設計】キャッシュキーを生成（uri|size|color のハッシュ）
 */
const getCacheKey = async (uri: string, size: number, color: string): Promise<string> => {
	// #235 【設計】色は既に正規化済みを前提
	const key = `${uri}|${size}|${color}`;
	const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);
	return hash.substring(0, 16);
};

/**
 * #235 【設計】色を正規化（rgb(r, g, b) → #RRGGBB）
 */
export const normalizeColor = (color: string): string => {
	// rgb(...) 形式を #RRGGBB に変換
	const rgbMatch = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
	if (rgbMatch) {
		const r = parseInt(rgbMatch[1], 10).toString(16).padStart(2, "0");
		const g = parseInt(rgbMatch[2], 10).toString(16).padStart(2, "0");
		const b = parseInt(rgbMatch[3], 10).toString(16).padStart(2, "0");
		return `#${r}${g}${b}`.toUpperCase();
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
 * #235 【設計】外部ストアを作成（useSyncExternalStore用）
 * React の render 中に他コンポーネントの setState を呼ばない設計
 */
const createMarkerBitmapStore = (processQueueFn: (store: MarkerBitmapStore) => Promise<void>): MarkerBitmapStore => {
	const store: MarkerBitmapStore = {
		states: new Map(),
		listeners: new Set(),
		queue: [],
		generatingCount: 0,
		isProcessing: false, // #235 【バグ修正】processQueue 再入防止

		subscribe: (listener: () => void) => {
			store.listeners.add(listener);
			return () => {
				store.listeners.delete(listener);
			};
		},

		ensureState: (key: string) => {
			// #235 【バグ修正】未登録なら初期状態を Map に追加（参照安定化のため必須）
			if (!store.states.has(key)) {
				store.states.set(key, {
					iconUri: undefined,
					isReady: false,
					isGenerating: false,
					error: undefined,
				});
			}
		},

		getSnapshot: (key: string) => {
			// #235 【バグ修正】ensureState で必ず Map に登録してから取得（参照安定化）
			store.ensureState(key);
			return store.states.get(key)!;
		},

		updateState: (key: string, update: Partial<GenerationState>) => {
			// #235 【バグ修正】ensureState で初期化してから更新
			store.ensureState(key);
			const currentState = store.states.get(key)!;
			const newState = { ...currentState, ...update };
			store.states.set(key, newState);
			// #235 【設計】全リスナーに通知（React外で実行）
			store.listeners.forEach((listener) => listener());
		},

		requestBitmap: (request: GenerationRequest) => {
			const key = `${request.uri}|${request.size}|${request.color}`;

			// #235 【バグ修正】ensureState で初期化
			store.ensureState(key);
			const currentState = store.states.get(key)!;

			// #235 【設計】既に生成済み or 生成中ならスキップ
			if (currentState.isReady || currentState.isGenerating) {
				return;
			}

			// #235 【設計】生成中フラグをセット
			store.updateState(key, { isGenerating: true });

			// #235 【設計】キューに追加
			store.queue.push(request);

			// #235 【設計】キュー処理開始（非同期）
			processQueueFn(store);
		},
	};

	return store;
};

/**
 * #235 【設計】MarkerBitmapRenderer Provider
 *
 * 全マーカーの bitmap 生成を一元管理する Renderer。
 * MapView の外に1個だけ配置し、オフスクリーン描画・生成キュー・キャッシュを担当。
 */
export function MarkerBitmapRendererProvider({ children }: { children: React.ReactNode }) {
	// #235 【設計】生成待ちの View 参照（1個の View で順次生成）
	const renderViewRef = useRef<View>(null);

	// #235 【設計】現在レンダリング中のリクエスト
	const [currentRequest, setCurrentRequest] = useState<GenerationRequest | null>(null);

	// #235 【設計】アンマウント検知用
	const isMountedRef = useRef(true);

	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	/**
	 * #235 【設計】bitmap 生成（リトライ付き）- iOS安定化のため copy+delete を使用
	 */
	const generateBitmap = async (store: MarkerBitmapStore, request: GenerationRequest, retryCount: number) => {
		const { uri, size, color } = request;
		const key = `${uri}|${size}|${color}`;

		try {
			// #235 【設計】キャッシュキー生成
			const cacheKey = await getCacheKey(uri, size, color);
			const cachedPath = `${CACHE_DIR}${cacheKey}.png`;

			// #235 【設計】キャッシュヒットチェック
			const cacheInfo = await FileSystem.getInfoAsync(cachedPath);
			if (cacheInfo.exists) {
				console.log(`[MarkerBitmapRenderer] Cache hit: ${cacheKey}`);
				store.updateState(key, {
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
				store.updateState(key, {
					isReady: true,
					isGenerating: false,
				});
				return;
			}

			console.log(`[MarkerBitmapRenderer] Generating bitmap: ${cacheKey} (retry: ${retryCount})`);

			// #235 【設計】現在のリクエストを設定してレンダリングをトリガー
			setCurrentRequest(request);

			// #235 【バグ修正】View ref が準備できるまで待機（同期）
			// requestAnimationFrame を2回 + renderViewRef.current の確認
			await new Promise((resolve) => requestAnimationFrame(resolve));
			await new Promise((resolve) => requestAnimationFrame(resolve));

			// #235 【バグ修正】ref が確実に準備されるまで最大10回リトライ
			let refReadyAttempts = 0;
			while (!renderViewRef.current && refReadyAttempts < 10) {
				await new Promise((resolve) => setTimeout(resolve, 50));
				refReadyAttempts++;
			}

			// #235 【設計】View をキャプチャして PNG 生成
			if (!renderViewRef.current) {
				throw new Error("View ref not ready after waiting");
			}

			// #235 【設計】captureRef(viewRef.current, ...) を使用（ref object ではなく実体）
			const tempUri = await captureRef(renderViewRef.current, {
				format: "png",
				quality: 1.0,
				result: "tmpfile",
			});

			// #235 【iOS安定化】moveAsync ではなく copyAsync + deleteAsync を使用
			// 既存ファイルを削除してから copy
			try {
				await FileSystem.deleteAsync(cachedPath, { idempotent: true });
			} catch (e) {
				// 削除失敗は無視（ファイルが存在しない場合）
			}

			await FileSystem.copyAsync({
				from: tempUri,
				to: cachedPath,
			});

			// #235 【設計】一時ファイルを削除
			try {
				await FileSystem.deleteAsync(tempUri, { idempotent: true });
			} catch (e) {
				console.warn("[MarkerBitmapRenderer] Failed to delete temp file:", e);
			}

			console.log(`[MarkerBitmapRenderer] Bitmap generated: ${cachedPath}`);

			// #235 【設計】アンマウント済みなら setState しない
			if (!isMountedRef.current) {
				return;
			}

			store.updateState(key, {
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
				await generateBitmap(store, request, retryCount + 1);
			} else {
				// #235 【設計】最大リトライ回数超過
				console.error("[MarkerBitmapRenderer] Max retry count exceeded");
				if (isMountedRef.current) {
					store.updateState(key, {
						isReady: true,
						isGenerating: false,
						error: error as Error,
					});
				}
			}
		}
	};

	/**
	 * #235 【設計】キューから次のリクエストを取り出して生成開始
	 * #235 【バグ修正】再入防止とループ処理で安定化
	 */
	const processQueue = async (store: MarkerBitmapStore) => {
		// #235 【バグ修正】既に処理中なら何もしない（再入防止）
		if (store.isProcessing) {
			return;
		}

		store.isProcessing = true;

		try {
			// #235 【バグ修正】whileループで全キューを処理（追加分も含む）
			while (store.queue.length > 0 && store.generatingCount < MAX_CONCURRENT_GENERATIONS) {
				// #235 【設計】優先度順にソート（high → low）
				store.queue.sort((a, b) => {
					if (a.priority === "high" && b.priority === "low") return -1;
					if (a.priority === "low" && b.priority === "high") return 1;
					return 0;
				});

				const request = store.queue.shift();
				if (!request) break;

				store.generatingCount++;

				try {
					await generateBitmap(store, request, 0);
				} finally {
					store.generatingCount--;
				}
			}
		} finally {
			store.isProcessing = false;
		}
	};

	// #235 【設計】外部ストアを作成（1回のみ）
	const storeRef = useRef<MarkerBitmapStore | null>(null);
	if (!storeRef.current) {
		storeRef.current = createMarkerBitmapStore(processQueue);
	}

	const contextValue: MarkerBitmapRendererContextType = {
		store: storeRef.current,
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
	return context.store;
}

/**
 * #235 【設計】特定のマーカーの状態を購読する Hook（useSyncExternalStore使用）
 */
export function useMarkerBitmapState(uri: string, size: number, color: string): GenerationState {
	const store = useMarkerBitmapRenderer();
	const key = `${uri}|${size}|${color}`;

	return useSyncExternalStore(
		store.subscribe,
		() => store.getSnapshot(key),
		() => store.getSnapshot(key), // #235 【設計】SSR用（常に同じ初期値）
	);
}
