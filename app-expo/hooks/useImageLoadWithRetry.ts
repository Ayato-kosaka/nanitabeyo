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

	/** エラー時（エラーカウント更新時）に呼ばれる。#715 errorMessage 追加（後方互換） */
	onErrorCountChange?: (errorCount: number, errorMessage?: string) => void;
	/** 自動リトライを諦めたタイミングで呼ばれる。#715 errorMessage 追加（後方互換） */
	onGiveUp?: (errorCount: number, errorMessage?: string) => void;
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
	// #715 【設計】最後のエラーメッセージを保持（ログ連携用）
	const [lastErrorMessage, setLastErrorMessage] = useState<string | undefined>(undefined);

	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const prevSourceKeyRef = useRef<string | undefined>(undefined);

	// uri + cacheBustingKey をまとめた “ソースキー”
	const sourceKey = useMemo(() => {
		if (!uri) return undefined;
		return cacheBustingKey ? `${uri}::${cacheBustingKey}` : uri;
	}, [uri, cacheBustingKey]);

	// 実際に <Image> に渡す URI（キャッシュバスター付き）
	const effectiveUri = useMemo(() => {
		if (!uri) return undefined;
		if (reloadToken === 0) return uri;

		const separator = uri.includes("?") ? "&" : "?";
		const cacheParam = cacheBustingKey ? `${reloadToken}_${cacheBustingKey}` : String(reloadToken);

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

	// #715 【設計】onDisplay ハンドラ: 画像が表示されたら確実に loaded 扱い
	const handleDisplay = useCallback(() => {
		setLoadState("loaded");
		setIsRetrying(false);
		clearTimer();
	}, [clearTimer]);

	// #715 【設計】onLoadEnd ハンドラ: 最低限 loading のまま残らないようにする
	const handleLoadEnd = useCallback(() => {
		setIsRetrying(false);
		clearTimer();
		// error 状態の場合は loaded に戻さない（安全側）
		setLoadState((prev) => (prev === "loading" ? "loaded" : prev));
	}, [clearTimer]);

	const handleError = useCallback(
		// #715 【設計】event 引数を受け取り event.error を抽出
		(event?: { error?: string }) => {
			const errorMessage = event?.error;
			setLastErrorMessage(errorMessage);
			setLoadState("error");

			setErrorCount((prev) => {
				const next = prev + 1;
				// #715 【設計】errorMessage を optional 引数として渡す（後方互換）
				onErrorCountChange?.(next, errorMessage);

				if (enableAutoRetry && next <= maxAutoRetry) {
					scheduleRetry(next);
				} else if (next > maxAutoRetry) {
					// #715 【設計】errorMessage を optional 引数として渡す（後方互換）
					onGiveUp?.(next, errorMessage);
				}

				return next;
			});
		},
		[enableAutoRetry, maxAutoRetry, scheduleRetry, onErrorCountChange, onGiveUp],
	);

	// 手動リトライ（UI から呼ぶ）
	const manualRetry = useCallback(() => {
		if (!uri) return;
		clearTimer();
		setErrorCount(0);
		setLastErrorMessage(undefined); // #715 【設計】エラーメッセージもリセット
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

	// uri 変更時に状態をリセット
	useEffect(() => {
		if (prevSourceKeyRef.current !== sourceKey) {
			prevSourceKeyRef.current = sourceKey;
			setErrorCount(0);
			setLastErrorMessage(undefined); // #715 【設計】エラーメッセージもリセット
			setIsRetrying(false);
			setReloadToken(0);
			clearTimer();
		}
	}, [sourceKey, clearTimer]);

	const hasGivenUp = errorCount > maxAutoRetry;

	return {
		// 状態
		loadState,
		errorCount,
		isRetrying,
		hasGivenUp,
		uri: effectiveUri,
		lastErrorMessage, // #715 【設計】エラーメッセージを公開（呼び出し元でログに使える）

		// expo-image 用ハンドラ
		handlers: {
			onLoadStart: handleLoadStart,
			onLoad: handleLoad,
			onError: handleError,
			// #715 【設計】onDisplay / onLoadEnd ハンドラを追加
			onDisplay: handleDisplay,
			onLoadEnd: handleLoadEnd,
		},

		// 手動リトライ
		manualRetry,
	};
};
