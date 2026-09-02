import { useCallback, useEffect, useRef, useState } from "react";

import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { toErrorLogMessage } from "@/lib/errorMessage";
import type {
	QueryMeNotificationPreferencesResponse,
	UpdateMeNotificationPreferenceResponse,
} from "@shared/api/v1/res";
import type { NotificationCategory } from "@shared/api/v1/constants/notificationCategories";

/** カテゴリ → 受信するか。取得前は null（「全部オン」と区別する） */
export type NotificationPreferenceMap = Partial<Record<NotificationCategory, boolean>>;

export interface UseNotificationPreferencesResult {
	/** 取得済みの設定。未取得・取得失敗のときは null */
	preferences: NotificationPreferenceMap | null;
	/** 初回取得中 */
	isLoading: boolean;
	/** 取得に失敗した（再試行できる） */
	hasLoadError: boolean;
	/** 現在保存中のカテゴリ（多重送信の抑止と、行ごとの操作不可表示に使う） */
	pendingCategory: NotificationCategory | null;
	/** 再取得する */
	reload: () => void;
	/**
	 * 1 カテゴリを更新する。楽観更新し、失敗したら元の値へ戻す。
	 * @returns 保存に成功したか（呼び出し側は false のとき snackbar を出す）
	 */
	setPreference: (category: NotificationCategory, enabled: boolean) => Promise<boolean>;
}

/**
 * 🔔 #1510 SET-02 通知カテゴリ別の受信設定フック。
 *
 * ## 取得に失敗したときに「全部オン」を描かない理由
 * この画面が答える問いは「自分は今どれを受け取る設定になっているか」である。
 * 取得に失敗した状態で既定値（全部オン）を描くと、実際にはオフにしているユーザーへ
 * 「オンになっている」と嘘をつくことになり、その状態でトグルに触れると
 * 意図しない上書きが起きる。取得できないときは `preferences` を null のままにして、
 * 呼び出し側に「読み込めなかった」ことを描かせる。
 *
 * ## 既定値の解決はサーバー側にある
 * GET は `user_notification_preferences` に行が無いカテゴリも既定値で埋めて返す
 *（api: `NotificationsService.getMyNotificationPreferences`）。
 * クライアントは返ってきた値をそのまま描画すればよく、既定値の表を二重に持たない。
 */
export function useNotificationPreferences(options: { enabled: boolean }): UseNotificationPreferencesResult {
	const { enabled: isFeatureEnabled } = options;
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();

	const [preferences, setPreferences] = useState<NotificationPreferenceMap | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [hasLoadError, setHasLoadError] = useState(false);
	const [pendingCategory, setPendingCategory] = useState<NotificationCategory | null>(null);
	// 取得を何度目かで数えるのではなく、明示的な再試行トリガーとして使う
	const [reloadToken, setReloadToken] = useState(0);

	// アンマウント後の setState を避ける（設定画面は戻る操作で簡単に消える）
	const isMountedRef = useRef(true);
	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		if (!isFeatureEnabled) {
			setPreferences(null);
			return;
		}

		let isCancelled = false;
		const fetchPreferences = async () => {
			setIsLoading(true);
			setHasLoadError(false);
			try {
				const response = await callBackend<Record<string, never>, QueryMeNotificationPreferencesResponse>(
					"/v1/users/me/notification-preferences",
					{ method: "GET", requestPayload: {} },
				);
				if (isCancelled || !isMountedRef.current) return;

				const next: NotificationPreferenceMap = {};
				for (const item of response.data) {
					next[item.category] = item.enabled;
				}
				setPreferences(next);
			} catch (error) {
				if (isCancelled || !isMountedRef.current) return;
				setHasLoadError(true);
				logFrontendEvent({
					event_name: "notification_preferences_fetch_failed",
					error_level: "error",
					payload: { error: toErrorLogMessage(error) },
				});
			} finally {
				if (!isCancelled && isMountedRef.current) setIsLoading(false);
			}
		};

		fetchPreferences();
		return () => {
			isCancelled = true;
		};
	}, [callBackend, logFrontendEvent, isFeatureEnabled, reloadToken]);

	const reload = useCallback(() => {
		setReloadToken((token) => token + 1);
	}, []);

	const setPreference = useCallback(
		async (category: NotificationCategory, nextEnabled: boolean): Promise<boolean> => {
			// 取得前・保存中は受け付けない（前の値が分からないとロールバックできない）
			if (!preferences || pendingCategory) return false;

			const previousEnabled = preferences[category];
			setPendingCategory(category);
			// 楽観更新: 通信の往復を待たせるとトグルが指に付いてこない
			setPreferences({ ...preferences, [category]: nextEnabled });

			try {
				// PATCH なのは useAPICall / fetchWithAuth が PUT を受け付けないため。
				// この 1 機能のために全 API の共通経路（メソッドの許容集合）を広げるより、
				// 既に通っている PATCH に寄せるほうが影響が小さい
				const response = await callBackend<{ enabled: boolean }, UpdateMeNotificationPreferenceResponse>(
					`/v1/users/me/notification-preferences/${category}`,
					{ method: "PATCH", requestPayload: { enabled: nextEnabled } },
				);
				if (!isMountedRef.current) return true;

				// サーバーが確定した値で上書きする（楽観更新した値とずれていたらサーバーが正）
				setPreferences((current) => (current ? { ...current, [category]: response.enabled } : current));
				logFrontendEvent({
					event_name: "notification_preference_updated",
					error_level: "log",
					payload: { category, enabled: response.enabled },
				});
				return true;
			} catch (error) {
				if (isMountedRef.current) {
					// ロールバック: 保存できていないのにオフのまま見えると、
					// ユーザーは「切ったつもり」で通知を受け取り続けることになる
					setPreferences((current) =>
						current ? { ...current, [category]: previousEnabled ?? !nextEnabled } : current,
					);
				}
				logFrontendEvent({
					event_name: "notification_preference_update_failed",
					error_level: "error",
					payload: { error: toErrorLogMessage(error), category, enabled: nextEnabled },
				});
				return false;
			} finally {
				if (isMountedRef.current) setPendingCategory(null);
			}
		},
		[callBackend, logFrontendEvent, preferences, pendingCategory],
	);

	return { preferences, isLoading, hasLoadError, pendingCategory, reload, setPreference };
}
