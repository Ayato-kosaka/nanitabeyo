import { useState, useCallback, useEffect, useMemo, useRef } from "react";

type LoadState = "loading" | "loaded" | "error";

interface UseImageLoadWithRetryOptions {
	uri: string | undefined;
	/** 自動リトライ最大回数（例: 2） */
	maxAutoRetry?: number;
	/** ベースのリトライ間隔(ms)。n 回目は base * n でバックオフ */
	baseRetryDelayMs?: number;
	/** 自動リトライを有効にするか */
	enableAutoRetry?: boolean;
	/** キャッシュバスターに混ぜるキー（categoryId や mediaId など） */
	cacheBustingKey?: string | number;

	/** エラー時（エラーカウント更新時）に呼ばれる */
	onErrorCountChange?: (errorCount: number) => void;
	/** 自動リトライを諦めたタイミングで呼ばれる */
	onGiveUp?: (errorCount: number) => void;
}

/**
 * #630 expo-image 向け ロード状態 + 自動/手動リトライ + キャッシュバスター管理フック
 * UI や文言には一切依存しない薄い共通化。
 * @param param0 useImageLoadWithRetry のオプション
 * @returns ロード状態、expo-image 用ハンドラ、手動リトライ関数
 */
export const useImageLoadWithRetry = ({
	uri,
	maxAutoRetry = 2,
	baseRetryDelayMs = 1000,
	enableAutoRetry = true,
	cacheBustingKey,
	onErrorCountChange,
	onGiveUp,
}: UseImageLoadWithRetryOptions) => {
	const [loadState, setLoadState] = useState<LoadState>("loading");
	const [errorCount, setErrorCount] = useState(0);
	const [isRetrying, setIsRetrying] = useState(false);
	const [reloadToken, setReloadToken] = useState(0);

	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const prevSourceKeyRef = useRef<string | undefined>(undefined);

	// uri + cacheBustingKey をまとめた “ソースキー”
	const sourceKey = useMemo(() => {
		if (!uri) return undefined;
		return cacheBustingKey ? `${uri}::${cacheBustingKey}` : uri;
	}, [uri, cacheBustingKey]);

	// uri 変更時に状態をリセット
	useEffect(() => {
		if (prevSourceKeyRef.current !== sourceKey) {
			prevSourceKeyRef.current = sourceKey;
			setLoadState("loading");
			setErrorCount(0);
			setIsRetrying(false);
			setReloadToken(0);

			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		}
	}, [sourceKey]);

	// 実際に <Image> に渡す URI（キャッシュバスター付き）
	const effectiveUri = useMemo(() => {
		if (!uri) return undefined;
		if (reloadToken === 0) return uri;

		const separator = uri.includes("?") ? "&" : "?";
		const cacheParam = cacheBustingKey
			? `${reloadToken}_${cacheBustingKey}`
			: String(reloadToken);

		return `${uri}${separator}t=${cacheParam}`;
	}, [uri, reloadToken, cacheBustingKey]);

	const clearTimer = useCallback(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	const scheduleRetry = useCallback(
		(nextCount: number) => {
			if (!enableAutoRetry || !uri) return;
			if (nextCount > maxAutoRetry) return;

			clearTimer();
			setIsRetrying(true);

			const delay = baseRetryDelayMs * nextCount; // シンプルな線形バックオフ
			timerRef.current = setTimeout(() => {
				setReloadToken((prev) => prev + 1);
				setIsRetrying(false);
			}, delay);
		},
		[enableAutoRetry, uri, maxAutoRetry, baseRetryDelayMs, clearTimer],
	);

	const handleLoadStart = useCallback(() => {
		setLoadState("loading");
	}, []);

	const handleLoad = useCallback(() => {
		setLoadState("loaded");
		setIsRetrying(false);
		clearTimer();
	}, [clearTimer]);

	const handleError = useCallback(() => {
		setLoadState("error");

		setErrorCount((prev) => {
			const next = prev + 1;
			onErrorCountChange?.(next);

			if (enableAutoRetry && next <= maxAutoRetry) {
				scheduleRetry(next);
			} else if (next > maxAutoRetry) {
				onGiveUp?.(next);
			}

			return next;
		});
	}, [enableAutoRetry, maxAutoRetry, scheduleRetry, onErrorCountChange, onGiveUp]);

	// 手動リトライ（UI から呼ぶ）
	const manualRetry = useCallback(() => {
		if (!uri) return;
		clearTimer();
		setErrorCount(0);
		setIsRetrying(true);
		setReloadToken((prev) => prev + 1);
		setLoadState("loading");
		// 読み込み開始のタイミングと被らないように少し後で false に
		setTimeout(() => setIsRetrying(false), 100);
	}, [uri, clearTimer]);

	// unmount 時にタイマーをクリーンアップ
	useEffect(
		() => () => {
			clearTimer();
		},
		[clearTimer],
	);

	const hasGivenUp = errorCount > maxAutoRetry;

	return {
		// 状態
		loadState,
		errorCount,
		isRetrying,
		hasGivenUp,
		uri: effectiveUri,

		// expo-image 用ハンドラ
		handlers: {
			onLoadStart: handleLoadStart,
			onLoad: handleLoad,
			onError: handleError,
		},

		// 手動リトライ
		manualRetry,
	};
};