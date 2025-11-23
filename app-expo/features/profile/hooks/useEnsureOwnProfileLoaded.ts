import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthProvider";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { userProfile } from "@/data/profileData";
import { useProfileStore } from "../stores/useProfileStore";
import type { GetUserProfileResponse } from "@shared/api/v1/res";
import { Image } from "expo-image";

/**
 * ログインユーザーのプロフィールをストアに確実にロードするカスタムフック
 *
 * 機能:
 * - 初回実行時のみ API を呼び出してプロフィールをストアに保存
 * - 2回目以降は API を呼ばず、ストアのキャッシュを利用
 * - ゲストユーザーの場合は userProfile のダミーデータを設定
 *
 * 使用例:
 * ```tsx
 * function MyComponent() {
 *   useEnsureOwnProfileLoaded();
 *   const profile = useProfileStore(state => state.profile);
 *   // profile が利用可能
 * }
 * ```
 */
export function useEnsureOwnProfileLoaded() {
	const { user } = useAuth();
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const hasLoadedRef = useRef(false);

	const isGuest = user?.is_anonymous !== false;

	useEffect(() => {
		// #467 【設計】既にプロフィールがロード済みの場合は何もしない
		if (hasLoadedRef.current) return;
		const { profile, setProfile } = useProfileStore.getState();
		if (profile) return;

		const loadProfile = async () => {
			// #467 【設計】ゲストユーザーの場合はダミープロフィールを設定
			if (isGuest) {
				setProfile(userProfile);
				hasLoadedRef.current = true;
				return;
			}

			try {
				const data = await callBackend<{}, GetUserProfileResponse>(`v1/users/${user?.id}`, {
					method: "GET",
					requestPayload: {},
				});
				// #467 【設計】アバター画像をプリフェッチして表示を高速化
				const avatarUrl = data.avatarUrls?.md;
				avatarUrl && (await Image.prefetch(avatarUrl));
				setProfile(data);
				hasLoadedRef.current = true;
			} catch (error: any) {
				logFrontendEvent({
					event_name: "load_own_profile_error",
					error_level: "error",
					payload: { error: error.message, userId: user?.id, isGuest },
				});
			}
		};

		loadProfile();
	}, [callBackend, isGuest, logFrontendEvent, user?.id]);
}
