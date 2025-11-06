import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { getRemoteConfig } from "@/lib/remoteConfig";
import type { DishMediaEntry, CreateDishMediaViewResponse } from "@shared/api/v1/res";
import type { DishMediaImpressionBodyDto, CreateDishMediaViewDto } from "@shared/api/v1/dto";

interface UseMediaTrackingParams {
        isActive: boolean;
        sessionId: string;
        source: string;
        dishMedia: DishMediaEntry["dish_media"];
}

interface VideoProgressPayload {
        currentTime: number;
        duration: number;
}

// Impression + WatchTime + VideoProgress を統合
export const useMediaTracking = ({ isActive, sessionId, source, dishMedia }: UseMediaTrackingParams) => {
        const { callBackend } = useAPICall();
        const { logFrontendEvent } = useLogger();

        const impressionId = useRef<string | null>(null);
        const viewSending = useRef(false);
        const watchStartTime = useRef<Date>(new Date());
        const watchMs = useRef(0);
        const isCompleted = useRef(false);
        const rewatchCount = useRef(0);
        const watchTimerRef = useRef<NodeJS.Timeout | null>(null);
        const appStateRef = useRef(AppState.currentState);
        const lastActiveTimeRef = useRef(Date.now());

        // Impression: isActive になった瞬間に開始し、sessionId/source を添えて送信
        useEffect(() => {
                if (!isActive) {
                        return;
                }

                const id = Crypto.randomUUID();
                impressionId.current = id;
                watchStartTime.current = new Date();
                watchMs.current = 0;
                isCompleted.current = false;
                rewatchCount.current = 0;

                callBackend<DishMediaImpressionBodyDto, void>(`v1/dish-media/${dishMedia.id}/impression`, {
                        method: "POST",
                        requestPayload: {
                                id,
                                session_id: sessionId,
                                source,
                        },
                });
        }, [callBackend, dishMedia.id, isActive, sessionId, source]);

        // WatchTime: 100ms ごとに前回 tick との差分を加算。AppState が active の時のみ
        useEffect(() => {
                const remoteConfig = getRemoteConfig();
                const parsed = parseInt(remoteConfig?.v1_dish_media_image_completion_threshold_ms ?? "0", 10);
                const imageCompletionThresholdMs = Number.isFinite(parsed) ? parsed : 0;

                if (!isActive) {
                        return undefined;
                }

                lastActiveTimeRef.current = Date.now();

                const interval = setInterval(() => {
                        if (appStateRef.current === "active") {
                                const now = Date.now();
                                const elapsed = now - lastActiveTimeRef.current;
                                lastActiveTimeRef.current = now;

                                const newWatchMs = watchMs.current + elapsed;

                                // 画像完了: RemoteConfig の ms 閾値を超えたら 1 回だけ完了ログ
                                if (
                                        dishMedia.media_type === "image" &&
                                        !isCompleted.current &&
                                        newWatchMs >= imageCompletionThresholdMs
                                ) {
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
                }, 100);

                watchTimerRef.current = interval;

                return () => {
                        if (watchTimerRef.current) {
                                clearInterval(watchTimerRef.current);
                                watchTimerRef.current = null;
                        }
                };
        }, [dishMedia.id, dishMedia.media_type, isActive, logFrontendEvent]);

        // AppState: 非アクティブ時にタイマーを停止し、復帰時に再開
        useEffect(() => {
                const subscription = AppState.addEventListener("change", (nextAppState) => {
                        if (appStateRef.current === "active" && nextAppState.match(/inactive|background/)) {
                                appStateRef.current = nextAppState;
                        } else if (appStateRef.current.match(/inactive|background/) && nextAppState === "active") {
                                appStateRef.current = nextAppState;
                                lastActiveTimeRef.current = Date.now();
                        }
                });

                return () => {
                        subscription.remove();
                };
        }, []);

        const sendView = useCallback(async () => {
                if (!impressionId.current || viewSending.current) {
                        return;
                }

                const isSkipped = watchMs.current < 1000 && !isCompleted.current;
                const payload = {
                        impression_id: impressionId.current,
                        started_at: watchStartTime.current,
                        watch_ms: Math.round(watchMs.current),
                        is_completed: isCompleted.current,
                        is_skipped: isSkipped,
                        rewatch_count: rewatchCount.current,
                } satisfies CreateDishMediaViewDto;

                viewSending.current = true;
                await callBackend<CreateDishMediaViewDto, CreateDishMediaViewResponse>(
                        `v1/dish-media/${dishMedia.id}/view`,
                        {
                                method: "POST",
                                requestPayload: payload,
                        },
                );
                impressionId.current = null;
                viewSending.current = false;
        }, [callBackend, dishMedia.id]);

        // view 送信: 非アクティブ化、またはアンマウント時に送信（送信中フラグで多重抑止）
        useEffect(() => {
                if (!isActive) {
                        sendView();
                }

                return () => {
                        sendView().catch((error) => {
                                logFrontendEvent({
                                        event_name: "dish_media_view_send_cleanup_error",
                                        error_level: "warn",
                                        payload: {
                                                error: error instanceof Error ? error.message : String(error),
                                                dish_media_id: dishMedia.id,
                                        },
                                });
                        });
                };
        }, [dishMedia.id, isActive, logFrontendEvent, sendView]);

        const handleVideoProgress = useCallback(
                ({ currentTime, duration }: VideoProgressPayload) => {
                        if (dishMedia.media_type !== "video" || duration <= 0) {
                                return;
                        }

                        const progressPercent = (currentTime / duration) * 100;

                        // 動画完了: currentTime/duration が 90% を超えたら 1 回だけ完了ログ
                        if (!isCompleted.current && progressPercent >= 90) {
                                isCompleted.current = true;
                                logFrontendEvent({
                                        event_name: "dish_media_video_completed",
                                        error_level: "log",
                                        payload: {
                                                dish_media_id: dishMedia.id,
                                                progress_percent: progressPercent,
                                                current_time: currentTime,
                                                duration,
                                        },
                                });
                        }
                },
                [dishMedia.id, dishMedia.media_type, logFrontendEvent],
        );

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
