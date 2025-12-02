import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthProvider";
import { ApiError, useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { userProfile } from "@/data/profileData";
import { useProfileStore } from "../stores/useProfileStore";
import type { GetUserProfileResponse } from "@shared/api/v1/res";
import { Image } from "expo-image";
import { useProfile } from "./useProfile";

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
	const { createUserProfile } = useProfile();
	// ロード済みフラグとリトライフラグを管理するための ref
	const hasLoadedRef = useRef(false);

	const isGuest = user?.is_anonymous !== false;

	// ★セッション（userId / isGuest）が変わったらキャッシュをリセット
	useEffect(() => {
		useProfileStore.getState().resetProfile();
		hasLoadedRef.current = false;
	}, [user?.id, isGuest]);

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

			if (hasLoadedRef.current) return;
			try {
				const data = await callBackend<{}, GetUserProfileResponse>(`v1/users/${user?.id}`, {
					method: "GET",
					requestPayload: {},
				});
				// #467 【設計】アバター画像をプリフェッチして表示を高速化
				const avatarUrl = data.avatarUrls?.md;
				avatarUrl && (await Image.prefetch(avatarUrl));
				setProfile(data);
			} catch (rawError: unknown) {
				const error = rawError as ApiError;
				if (error.status === 404) {
					// #260 【設計】プロフィールが存在しない場合は新規作成(冪等)
					await createUserProfile({});
					// 再度ロードを試みる
					if (hasLoadedRef.current) return;
					const data = await callBackend<{}, GetUserProfileResponse>(`v1/users/${user?.id}`, {
						method: "GET",
						requestPayload: {},
					});
					// #467 【設計】アバター画像をプリフェッチして表示を高速化
					const avatarUrl = data.avatarUrls?.md;
					avatarUrl && (await Image.prefetch(avatarUrl));
					setProfile(data);
					return;
				}
				// その他のエラーはログに記録
				logFrontendEvent({
					event_name: "load_own_profile_error",
					error_level: "error",
					payload: { message: error.message, userId: user?.id, isGuest },
				});
			} finally {
				hasLoadedRef.current = true;
			}
		};

		loadProfile();
	}, [callBackend, isGuest, logFrontendEvent, user?.id, createUserProfile]);
}
