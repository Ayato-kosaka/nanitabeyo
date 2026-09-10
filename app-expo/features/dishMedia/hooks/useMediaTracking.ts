import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { generateUUID } from "@/lib/uuid";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { getRemoteConfig } from "@/lib/remoteConfig";
import type { DishMediaEntry, CreateDishMediaViewResponse } from "@shared/api/v1/res";
import type { DishMediaImpressionBodyDto, CreateDishMediaViewDto } from "@shared/api/v1/dto";
import { toErrorLogMessage } from "@/lib/errorMessage";

interface UseMediaTrackingParams {
	isActive: boolean;
	sessionId: string;
	source: string;
	dishMedia: DishMediaEntry["dish_media"];
}

// Impression + WatchTime + VideoProgress を統合
export const useMediaTracking = ({ isActive, sessionId, source, dishMedia }: UseMediaTrackingParams) => {
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();

	// ===== Tracking State =====
	const impressionId = useRef<string | null>(null);
	const viewSending = useRef(false);
	const watchStartTime = useRef<Date>(new Date());
	const watchMs = useRef(0);
	const isCompleted = useRef(false);
	const rewatchCount = useRef(0);
	const watchTimerRef = useRef<NodeJS.Timeout | string | number | null>(null);
	const appStateRef = useRef(AppState.currentState);
	const lastActiveTimeRef = useRef(Date.now());

	// ===== Impression Tracking =====
	useEffect(() => {
		if (isActive) {
			if (!impressionId.current)
				logFrontendEvent({
					event_name: "dish_media_impression_started",
					error_level: "log",
					payload: {
						dish_media_id: dishMedia.id,
					},
				});

			// 新しいインプレッションを作成
			const id = generateUUID();
			impressionId.current = id;
			watchStartTime.current = new Date();
			watchMs.current = 0;
			isCompleted.current = false;
			rewatchCount.current = 0;
			/*
			#1785【修正】**ここも投げっぱなしにしない。**（下の視聴ログと同じ理由）
			`callBackend` は失敗を Error ではない素のオブジェクトで throw するので、
			`.catch()` が無いと `unhandledrejection` になり、ブラウザには発生源の分からない
			エラーだけが残る。表示ログは «送れたら送る» 記録であって、送信の失敗で
			画面を壊してよいものではない。
			*/
			callBackend<DishMediaImpressionBodyDto, void>(`v1/dish-media/${dishMedia.id}/impression`, {
				method: "POST",
				requestPayload: {
					id,
					session_id: sessionId,
					source,
				},
			}).catch((error) => {
				logFrontendEvent({
					event_name: "dish_media_impression_send_error",
					error_level: "warn",
					payload: {
						error: toErrorLogMessage(error),
						dish_media_id: dishMedia.id,
					},
				});
			});
		}
	}, [isActive, dishMedia.id, sessionId, source, logFrontendEvent]);

	// ===== Watch Time Tracking =====
	useEffect(() => {
		const remoteConfig = getRemoteConfig();
		const imageCompletionThresholdMs = parseInt(remoteConfig?.v1_dish_media_image_completion_threshold_ms!, 10);

		if (isActive) {
			// タイマーのスタート
			lastActiveTimeRef.current = Date.now();

			const interval = setInterval(() => {
				if (appStateRef.current === "active") {
					const now = Date.now();
					const elapsed = now - lastActiveTimeRef.current;
					lastActiveTimeRef.current = now;

					const newWatchMs = watchMs.current + elapsed;
					// Check completion for images
					if (dishMedia.media_type === "image" && !isCompleted.current && newWatchMs >= imageCompletionThresholdMs) {
						isCompleted.current = true;
						logFrontendEvent({
							event_name: "dish_media_image_completed",
							error_level: "log",
							payload: {
								dish_media_id: dishMedia.id,
								watch_ms: newWatchMs,
							},
						});
					}
					watchMs.current = newWatchMs;
				}
			}, 100); // Update every 100ms

			watchTimerRef.current = interval;
		}

		return () => {
			if (watchTimerRef.current) {
				clearInterval(watchTimerRef.current);
				watchTimerRef.current = null;
			}
		};
	}, [isActive, dishMedia.id, dishMedia.media_type, logFrontendEvent]);

	// ===== AppState Tracking =====
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (nextAppState) => {
			if (appStateRef.current === "active" && nextAppState.match(/inactive|background/)) {
				// App is going to background - pause watch time tracking
				appStateRef.current = nextAppState;
			} else if (appStateRef.current.match(/inactive|background/) && nextAppState === "active") {
				// App is coming back to foreground - resume from current time
				appStateRef.current = nextAppState;
				lastActiveTimeRef.current = Date.now();
			}
		});

		return () => {
			subscription.remove();
		};
	}, []);

	// ===== Send View on Deactivate or Unmount =====
	const sendView = useCallback(async () => {
		if (!impressionId.current || viewSending.current) return;

		const isSkipped = watchMs.current < 1000 && !isCompleted.current;
		const payload = {
			impression_id: impressionId.current,
			started_at: watchStartTime.current,
			watch_ms: Math.round(watchMs.current),
			is_completed: isCompleted.current,
			is_skipped: isSkipped,
			rewatch_count: rewatchCount.current,
		};

		viewSending.current = true;
		/*
		#1785【修正】**送信中フラグは `finally` で必ず戻す。**
		以前は成功したときにしか戻していなかったので、1 度でも失敗すると
		`viewSending.current` が true のまま残り、**そのメディアの視聴ログは
		二度と送られなくなっていた**（先頭の早期 return に永久に引っかかる）。
		*/
		try {
			await callBackend<CreateDishMediaViewDto, CreateDishMediaViewResponse>(`v1/dish-media/${dishMedia.id}/view`, {
				method: "POST",
				requestPayload: payload,
			});
			impressionId.current = null;
		} finally {
			viewSending.current = false;
		}
	}, [dishMedia.id, callBackend, logFrontendEvent]);

	/*
	#1785【修正】**視聴ログの送信は «投げっぱなし» にしない。**

	以前は unmount 側にだけ `.catch()` があり、`isActive` が false になったときの
	呼び出しは素の `sendView()` だった。`callBackend` は失敗を **Error ではない素の
	オブジェクト**（`ApiError`）で throw するので、その拒否は誰にも拾われず
	`unhandledrejection` になる。ブラウザではこれが «原因の分からないエラー» として出る
	（Playwright の失敗ログに `[pageerror] Object` としか出ないのはこれ。素のオブジェクトには
	stack が無いので、発生源すら出ない）。

	視聴ログは «送れたら送る» 種類の記録であって、送信の失敗で画面を壊してよいものではない。
	どちらの経路も同じ受け口を通す。
	*/
	const sendViewIgnoringFailure = useCallback(
		(reason: "deactivated" | "unmounted") => {
			sendView().catch((error) => {
				logFrontendEvent({
					event_name: "dish_media_view_send_cleanup_error",
					error_level: "warn",
					payload: {
						error: toErrorLogMessage(error),
						dish_media_id: dishMedia.id,
						reason,
					},
				});
			});
		},
		[sendView, dishMedia.id, logFrontendEvent],
	);

	useEffect(() => {
		if (!isActive) {
			sendViewIgnoringFailure("deactivated");
		}

		// Also send on unmount
		return () => {
			// Fire and forget - we can't await in cleanup
			sendViewIgnoringFailure("unmounted");
		};
	}, [isActive, sendViewIgnoringFailure]);

	// ===== Video Progress Tracking =====
	const handleVideoProgress = (progress: { currentTime: number; duration: number }) => {
		if (dishMedia.media_type === "video" && progress.duration > 0) {
			const progressPercent = (progress.currentTime / progress.duration) * 100;

			// 動画完了: currentTime/duration が 90% を超えたら 1 回だけ完了ログ
			if (!isCompleted.current && progressPercent >= 90) {
				isCompleted.current = true;
				logFrontendEvent({
					event_name: "dish_media_video_completed",
					error_level: "log",
					payload: {
						dish_media_id: dishMedia.id,
						progress_percent: progressPercent,
						current_time: progress.currentTime,
						duration: progress.duration,
					},
				});
			}
		}
	};

	const handleVideoLoop = useCallback(() => {
		rewatchCount.current += 1;
		logFrontendEvent({
			event_name: "dish_media_video_looped",
			error_level: "log",
			payload: {
				dish_media_id: dishMedia.id,
				rewatch_count: rewatchCount.current,
			},
		});
	}, [dishMedia.id, logFrontendEvent]);

	return {
		handleVideoProgress,
		handleVideoLoop,
	};
};
