// app-expo/features/mapMarkers/components/MarkerBitmapRendererProvider.tsx
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Platform, View } from "react-native";
import { captureRef } from "react-native-view-shot";
// #1156 Expo SDK 54 で expo-file-system は新 API が既定になった。
// 旧 API(cacheDirectory / EncodingType / FileSystemUploadType 等)は legacy サブパスへ移動している。
import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";
import { BubblePinBitmap } from "./BubblePinBitmap";
import { FixedColors } from "@/constants/Palette";

/**
 * #235 MarkerBitmapRenderer
 *
 * ✅ MapView 直下には Marker しか置かないため、
 *    Offscreen View（PNG生成用）は Provider が MapView 外に1つだけ持つ。
 *
 * ✅ 生成状態は「外部ストア」を useSyncExternalStore で購読し、
 *    React の render 規約に準拠（setState in render を回避）する。
 *
 * ✅ Android で「画像が出ない」問題の根治：
 *    画像ロード完了（Image onLoadEnd）を待ってから capture する。
 *
 * ✅ iOS のファイル知道（tmp）系のクセに対処：
 *    moveAsync ではなく copyAsync を使用し、tmp delete は失敗しても握りつぶす（ノイズ削減）。
 */

// ----------------------------
// 定数（見た目/設計）
// ----------------------------

// 画面外に配置（MapView配下ではなく Provider 直下に置く）
const OFFSCREEN_POSITION = -9999;

// キャッシュディレクトリ
const CACHE_DIR = `${FileSystem.cacheDirectory}marker-icons/`;

// キャッシュ上限（運用上の安全弁）
const MAX_CACHE_FILES = 200;
const MAX_CACHE_SIZE_BYTES = 20 * 1024 * 1024;

// 生成スロットは 1 に固定（取り違えバグを根絶）
const MAX_CONCURRENT_GENERATIONS = 1;

// 生成失敗時の最大リトライ回数
const MAX_RETRY_COUNT = 3;

// リトライ間隔（ms）※軽いバックオフ
const RETRY_DELAY_MS = 500;

// capture 同期待ちの上限（ms）
const WAIT_REF_MS = 500; // ref が付くまで（描画の確知道）
const WAIT_IMAGE_MS = 2500; // 画像ロードを待つ（Android の「枠だけ」根治）

/*
#1629 【設計】マーカーのふち色（正規化済み）。ここはテーマで振らない。
焼いた PNG は Google Map のタイルの上に載り、タイルはアプリのテーマに追従せず
常にライト配色だからである（暗い色にすると明るい地図の上で見えなくなる）。
加えてこの 2 値は **生成済みビットマップのキャッシュキーの一部**であり、
テーマで変わるとキャッシュが総入れ替えになる。
*/
export const ACTIVE_COLOR_HEX = FixedColors.mapMarkerBorderActive;
export const INACTIVE_COLOR_HEX = FixedColors.mapMarkerSurface;

// ----------------------------
// 型
// ----------------------------

export type GenerationPriority = "high" | "low";

export type GenerationRequest = {
	uri: string;
	size: number;
	color: string; // 正規化済み #RRGGBB 前提
	priority: GenerationPriority;
};

export type GenerationState = {
	iconUri: string | undefined;
	isReady: boolean;
	isGenerating: boolean;
	error: Error | undefined;

	// ✅ 画像ロード完了待ち（Androidの空画像を根治）
	imageReady: boolean;
};

type MarkerBitmapStore = {
	// 状態（キー => state）
	states: Map<string, GenerationState>;

	// useSyncExternalStore 用
	listeners: Set<() => void>;
	subscribe: (listener: () => void) => () => void;
	getSnapshot: (key: string) => GenerationState;
	ensureState: (key: string) => void;

	// 生成キュー（優先度ごとに分離して sort を廃止）
	highQueue: GenerationRequest[];
	lowQueue: GenerationRequest[];

	// 重複リクエスト排除
	queuedKeys: Set<string>;

	// 同時生成数（1固定）
	generatingCount: number;

	// キュー処理の再入防止
	isProcessing: boolean;

	// 状態更新
	updateState: (key: string, patch: Partial<GenerationState>) => void;

	// 生成リクエスト
	requestBitmap: (req: Omit<GenerationRequest, "color"> & { color: string }) => void;

	// 画像ロード通知（BubblePinBitmap から呼ぶ）
	markImageReady: (key: string) => void;
	markImageError: (key: string, err?: unknown) => void;
};

type MarkerBitmapRendererContextType = {
	store: MarkerBitmapStore;
};

const MarkerBitmapRendererContext = React.createContext<MarkerBitmapRendererContextType | null>(null);

// ----------------------------
// ユーティリティ
// ----------------------------

/**
 * 色を正規化（rgb(r,g,b) / #rgb / #rrggbb などを #RRGGBB に寄せる）
 * ※ここでは最低限の正規化のみ（運用上は #RRGGBB 統一を推奨）
 */
export const normalizeColor = (color: string): string => {
	const c = (color ?? "").trim();

	// rgb(...) → #RRGGBB
	const rgbMatch = c.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
	if (rgbMatch) {
		const r = Number(rgbMatch[1]).toString(16).padStart(2, "0");
		const g = Number(rgbMatch[2]).toString(16).padStart(2, "0");
		const b = Number(rgbMatch[3]).toString(16).padStart(2, "0");
		return `#${r}${g}${b}`.toUpperCase();
	}

	// #rgb → #RRGGBB
	const shortHex = c.match(/^#([0-9a-fA-F]{3})$/);
	if (shortHex) {
		const [r, g, b] = shortHex[1].split("");
		return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
	}

	// #rrggbb
	const longHex = c.match(/^#([0-9a-fA-F]{6})$/);
	if (longHex) return `#${longHex[1]}`.toUpperCase();

	// 想定外はそのまま上げる（呼び出し側で統一を推奨）
	return c.toUpperCase();
};

/**
 * すべての状態キー生成をこの関数に統一（バグ温床を排除）
 */
export const makeKey = (uri: string, size: number, color: string) => {
	// color は正規化済みを前提
	return `${uri}|${size}|${color}`;
};

const ensureCacheDir = async () => {
	await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
};

const getCacheKey = async (uri: string, size: number, color: string): Promise<string> => {
	// color は既に正規化済みを前提
	const key = `${uri}|${size}|${color}`;
	const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);
	return hash.substring(0, 16);
};

/**
 * キャッシュ一覧取得（LRU削除用）
 */
const getCacheFiles = async (): Promise<Array<{ uri: string; modificationTime: number; size: number }>> => {
	try {
		await ensureCacheDir();
		const files = await FileSystem.readDirectoryAsync(CACHE_DIR);

		const infos = await Promise.all(
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

		// 古い順
		return infos.sort((a, b) => a.modificationTime - b.modificationTime);
	} catch (e) {
		console.warn("[MarkerBitmapRenderer] Failed to get cache files:", e);
		return [];
	}
};

/**
 * 古いキャッシュ削除（LRU + 容量制御）
 */
const cleanupCache = async () => {
	try {
		const files = await getCacheFiles();
		const totalSize = files.reduce((sum, f) => sum + f.size, 0);

		let toDelete: Array<{ uri: string; modificationTime: number; size: number }> = [];

		if (files.length > MAX_CACHE_FILES) {
			toDelete = files.slice(0, files.length - MAX_CACHE_FILES);
		}

		if (totalSize > MAX_CACHE_SIZE_BYTES) {
			const set = new Set(toDelete.map((f) => f.uri));
			let currentSize = totalSize;

			for (const f of files) {
				if (currentSize <= MAX_CACHE_SIZE_BYTES) break;
				if (!set.has(f.uri)) {
					toDelete.push(f);
					set.add(f.uri);
					currentSize -= f.size;
				}
			}
		}

		for (const f of toDelete) {
			await FileSystem.deleteAsync(f.uri, { idempotent: true });
		}

		if (toDelete.length > 0) {
			console.log(`[MarkerBitmapRenderer] Cleaned up ${toDelete.length} cache files`);
		}
	} catch (e) {
		console.warn("[MarkerBitmapRenderer] Failed to cleanup cache:", e);
	}
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

/**
 * "tmp delete は失敗しても OK" だが、warn 連打はログノイズになる。
 * よくある iOS の "not writable" は握りつぶす方針にする。
 */
const safeDeleteTemp = async (tempUri: string) => {
	try {
		// 念のため file info を見てから削除（失敗しても無視）
		const info = await FileSystem.getInfoAsync(tempUri);
		if (!info.exists) return;
		if (info.isDirectory) {
			// ここは基本来ない想定（来たら削除しない）
			return;
		}
		await FileSystem.deleteAsync(tempUri, { idempotent: true });
	} catch {
		// 失敗は握りつぶす（iOS の tmp は削除不可ケースがある）
	}
};

// ----------------------------
// 外部ストア生成
// ----------------------------

const createStore = (kickProcessQueue: () => void): MarkerBitmapStore => {
	const store: MarkerBitmapStore = {
		states: new Map(),
		listeners: new Set(),
		highQueue: [],
		lowQueue: [],
		queuedKeys: new Set(),
		generatingCount: 0,
		isProcessing: false,

		subscribe: (listener) => {
			store.listeners.add(listener);
			return () => store.listeners.delete(listener);
		},

		ensureState: (key) => {
			if (!store.states.has(key)) {
				store.states.set(key, {
					iconUri: undefined,
					isReady: false,
					isGenerating: false,
					error: undefined,
					imageReady: false,
				});
			}
		},

		getSnapshot: (key) => {
			// ✅ getSnapshot は同一参照を返す必要がある（無限ループ防止）
			store.ensureState(key);
			return store.states.get(key)!;
		},

		updateState: (key, patch) => {
			store.ensureState(key);
			const current = store.states.get(key)!;
			const next = { ...current, ...patch };
			store.states.set(key, next);

			// ✅ React 外でリスナー通知（useSyncExternalStore が再描画を管理）
			store.listeners.forEach((l) => l());
		},

		requestBitmap: (req) => {
			// Web は生成しない（呼び出し側で View Marker を使う想定）
			if (Platform.OS === "web") return;

			const color = normalizeColor(req.color);
			const key = makeKey(req.uri, req.size, color);

			store.ensureState(key);
			const st = store.states.get(key)!;

			// ✅ 生成済み / 生成中 / キュー済み は弾く
			if (st.isReady || st.isGenerating || store.queuedKeys.has(key)) return;

			// 生成開始フラグ（imageReady は false から）
			store.updateState(key, {
				isGenerating: true,
				isReady: false,
				error: undefined,
				imageReady: req.uri ? false : true, // uri が無いなら待つ必要なし
			});

			// キュー投入（dedupe 用に key を保持）
			store.queuedKeys.add(key);

			const request: GenerationRequest = { ...req, color };
			if (req.priority === "high") store.highQueue.push(request);
			else store.lowQueue.push(request);

			// キュー処理起動（再入は processQueue 側で防ぐ）
			kickProcessQueue();
		},

		markImageReady: (key) => {
			store.ensureState(key);
			const st = store.states.get(key)!;
			if (st.imageReady) return;
			store.updateState(key, { imageReady: true });
		},

		markImageError: (key, err) => {
			store.ensureState(key);
			// 画像が読めなくても capture は進めたい（プレースホルダ画像で確定）
			store.updateState(key, {
				imageReady: true,
				error: err instanceof Error ? err : undefined,
			});
		},
	};

	return store;
};

// ----------------------------
// Provider 本体
// ----------------------------

export function MarkerBitmapRendererProvider({ children }: { children: React.ReactNode }) {
	// Offscreen 描画先（1つだけ）
	const renderViewRef = useRef<View>(null);

	// いま生成中の request（Offscreen で描画する内容）
	const [currentRequest, setCurrentRequest] = useState<GenerationRequest | null>(null);

	// アンマウント後の更新防止
	const isMountedRef = useRef(true);
	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	/**
	 * processQueue の起動関数（store 生成のため useMemo 内から参照）
	 * ※ store は ref に保持されるので、ここは “storeRef.current を叩く” 方式
	 */
	const storeRef = useRef<MarkerBitmapStore | null>(null);

	const kickProcessQueue = () => {
		const s = storeRef.current;
		if (!s) return;
		// 非同期で回す（呼び出し元の render/handler を汚さない）
		void processQueue(s);
	};

	// store は 1 回だけ作る（画面単位で共有）
	const store = useMemo(() => {
		const s = createStore(kickProcessQueue);
		storeRef.current = s;
		return s;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// 初回マウント時にアプリで使うサイズ/色の placeholder を先行生成しておく
	useEffect(() => {
		if (Platform.OS === "web") return;

		// まずはアプリで使うサイズを列挙（現状48中心なら48だけでもOK）
		const SIZES = [48]; // 必要なら [40,48,56] など
		const COLORS = [INACTIVE_COLOR_HEX, ACTIVE_COLOR_HEX];

		for (const size of SIZES) {
			for (const color of COLORS) {
				// ✅ uri無し（＝画像待ち無し）placeholder を先行生成
				store.requestBitmap({
					uri: "", // ←重要：uri無し placeholder
					size,
					color, // 正規化済み前提
					priority: "high", // 初回の体感を上げるなら high
				});
			}
		}
	}, [store]);

	/**
	 * 実際の生成処理（1 request）
	 */
	const generateBitmap = async (s: MarkerBitmapStore, request: GenerationRequest, retryCount: number) => {
		const { uri, size, color } = request;
		const key = makeKey(uri, size, color);

		try {
			// キャッシュキー
			const cacheKey = await getCacheKey(uri, size, color);
			const cachedPath = `${CACHE_DIR}${cacheKey}.png`;

			// キャッシュヒット
			const cacheInfo = await FileSystem.getInfoAsync(cachedPath);
			if (cacheInfo.exists) {
				console.log(`[MarkerBitmapRenderer] Cache hit: ${cacheKey}`);
				s.updateState(key, { iconUri: cachedPath, isReady: true, isGenerating: false });
				return;
			}

			await ensureCacheDir();

			console.log(`[MarkerBitmapRenderer] Generating bitmap: ${cacheKey} (retry: ${retryCount})`);

			// Offscreen に描画する request をセット
			setCurrentRequest(request);

			// ✅ 描画同期：最低2フレーム待つ
			await nextFrame();
			await nextFrame();

			// ✅ ref が付くまで待機（最大 WAIT_REF_MS）
			const refDeadline = Date.now() + WAIT_REF_MS;
			while (!renderViewRef.current && Date.now() < refDeadline) {
				await sleep(50);
			}
			if (!renderViewRef.current) {
				throw new Error("View ref not ready after waiting");
			}

			// ✅ 画像ロード完了待ち（Android の「枠だけ」根治）
			// uri がある場合のみ待つ。BubblePinBitmap が onLoadEnd で markImageReady(key) を呼ぶ想定。
			if (uri) {
				const imgDeadline = Date.now() + WAIT_IMAGE_MS;
				while (!s.getSnapshot(key).imageReady && Date.now() < imgDeadline) {
					await sleep(50);
				}
				// タイムアウトしても capture は進める（最悪プレースホルダが焼き込まれる）
			}

			// ✅ 描画安定化待ち：さらに数フレーム待つ
			await nextFrame();
			await nextFrame();
			await sleep(16);

			// capture
			const tempUri = await captureRef(renderViewRef.current, {
				format: "png",
				quality: 1.0,
				result: "tmpfile",
			});

			// iOS 安定化：copy →（可能なら）tmp 削除
			try {
				await FileSystem.deleteAsync(cachedPath, { idempotent: true });
			} catch {
				// 既存が無い等は無視
			}

			await FileSystem.copyAsync({ from: tempUri, to: cachedPath });
			await safeDeleteTemp(tempUri);

			console.log(`[MarkerBitmapRenderer] Bitmap generated: ${cachedPath}`);

			if (!isMountedRef.current) return;

			s.updateState(key, {
				iconUri: cachedPath,
				isReady: true,
				isGenerating: false,
			});

			// キャッシュ掃除（非同期）
			cleanupCache().catch(() => {});
		} catch (e) {
			console.error(`[MarkerBitmapRenderer] Failed to generate bitmap (retry: ${retryCount}):`, e);

			if (retryCount < MAX_RETRY_COUNT) {
				await sleep(RETRY_DELAY_MS * (retryCount + 1));
				await generateBitmap(s, request, retryCount + 1);
			} else {
				console.error("[MarkerBitmapRenderer] Max retry count exceeded");
				if (isMountedRef.current) {
					const key = makeKey(request.uri, request.size, request.color);
					s.updateState(key, {
						isReady: true, // 無限待機防止
						isGenerating: false,
						error: e instanceof Error ? e : new Error(String(e)),
					});
				}
			}
		}
	};

	/**
	 * キュー処理（再入防止 + 同時1固定）
	 */
	const processQueue = async (s: MarkerBitmapStore) => {
		// ✅ 再入防止
		if (s.isProcessing) return;
		s.isProcessing = true;

		try {
			// ✅ while で “追加された分” も含めて処理
			while (s.generatingCount < MAX_CONCURRENT_GENERATIONS) {
				// 次の request を取り出す（high → low）
				const request = s.highQueue.shift() ?? s.lowQueue.shift();
				if (!request) break;

				const key = makeKey(request.uri, request.size, request.color);

				// queued フラグ解除（取り出した時点で解除）
				s.queuedKeys.delete(key);

				s.generatingCount++;

				try {
					await generateBitmap(s, request, 0);
				} finally {
					s.generatingCount--;
				}
			}
		} finally {
			s.isProcessing = false;

			// まだ残っているなら、イベントループに返してから続行（UI優先）
			if (s.highQueue.length + s.lowQueue.length > 0) {
				// “今の call stack” を抜けてから再実行（微妙な再入を避ける）
				setTimeout(() => kickProcessQueue(), 0);
			}
		}
	};

	const contextValue: MarkerBitmapRendererContextType = { store };

	return (
		<MarkerBitmapRendererContext.Provider value={contextValue}>
			{children}

			{/* ✅ Offscreen View（MapView 外） */}
			<View style={{ position: "absolute", left: OFFSCREEN_POSITION, top: OFFSCREEN_POSITION }}>
				{currentRequest && (
					<View
						ref={renderViewRef}
						collapsable={false} // ✅ Android最適化で潰れないように
					>
						{/* BubblePinBitmap が画像ロード完了を通知する前提 */}
						<BubblePinBitmap
							uri={currentRequest.uri}
							size={currentRequest.size}
							color={currentRequest.color}
							// ↓ BubblePinBitmap 側で実装してもらう想定の props
							requestKey={makeKey(currentRequest.uri, currentRequest.size, currentRequest.color)}
							onImageReady={(k: string) => store.markImageReady(k)}
							onImageError={(k: string, err?: unknown) => store.markImageError(k, err)}
						/>
					</View>
				)}
			</View>
		</MarkerBitmapRendererContext.Provider>
	);
}

// ----------------------------
// Hooks
// ----------------------------

/**
 * Provider から store を取り出す Hook
 */
export function useMarkerBitmapRenderer() {
	const ctx = React.useContext(MarkerBitmapRendererContext);
	if (!ctx) {
		throw new Error("useMarkerBitmapRenderer must be used within MarkerBitmapRendererProvider");
	}
	return ctx.store;
}

/**
 * 特定 key の状態を購読（useSyncExternalStore）
 * ✅ getSnapshot の参照安定が前提（ensureState + Map.get）
 */
export function useMarkerBitmapState(uri: string, size: number, color: string): GenerationState {
	const store = useMarkerBitmapRenderer();
	const normalizedColor = normalizeColor(color);
	const key = makeKey(uri, size, normalizedColor);

	return useSyncExternalStore(
		store.subscribe,
		() => store.getSnapshot(key),
		() => store.getSnapshot(key), // SSR用（同じ参照を返す）
	);
}
