import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
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
 *
 * #1120 【設計】戻り値の `isProfileResolved` は「ロードが決着したか（成功・失敗を問わず）」。
 * `profile === null` は「まだ読んでいない」と「読んだが取れなかった」の両方を意味するため、
 * これだけを見て UI を分岐すると、ログイン済みユーザーにも数百 ms だけゲスト向け UI が出て
 * 消える（= ちらつき）。未決着の間は分岐そのものを保留する用途に使う。
 */
export function useEnsureOwnProfileLoaded(): { isProfileResolved: boolean } {
	const { user } = useAuth();
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { createUserProfile } = useProfile();
	// ロード済みフラグとリトライフラグを管理するための ref
	const hasLoadedRef = useRef(false);
	// #1120 ref は再レンダーを起こさないため、呼び出し側へ返す決着状態は state で持つ
	const [isProfileResolved, setIsProfileResolved] = useState(false);

	// #1092 PR4b タブの表示判定（lib/authGuest.ts）と同じ式にしておく。
	// ここだけ判定がずれると「reviews タブは出ているのにプロフィールはダミーのまま」になる
	const isGuest = isGuestUser(user);

	// ★セッション（userId / isGuest）が変わったらキャッシュをリセット
	useEffect(() => {
		useProfileStore.getState().resetProfile();
		hasLoadedRef.current = false;
		// #1120 セッションが変わればロードもやり直しになるので、決着状態も未決着へ戻す
		setIsProfileResolved(false);
	}, [user?.id, isGuest]);

	useEffect(() => {
		// #467 【設計】既にプロフィールがロード済みの場合は何もしない
		if (hasLoadedRef.current) {
			setIsProfileResolved(true);
			return;
		}
		const { profile, setProfile } = useProfileStore.getState();
		if (profile) {
			setIsProfileResolved(true);
			return;
		}

		const loadProfile = async () => {
			// #467 【設計】ゲストユーザーの場合はダミープロフィールを設定
			if (isGuest) {
				setProfile(userProfile);
				hasLoadedRef.current = true;
				setIsProfileResolved(true);
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
				// #1120 失敗しても「決着した（= これ以上待っても profile は増えない）」ことは確定する。
				// ここを成功時だけにすると、プロフィール取得が落ちた人の UI が永久にローディングで固まる
				setIsProfileResolved(true);
			}
		};

		loadProfile();
	}, [callBackend, isGuest, logFrontendEvent, user?.id, createUserProfile]);

	return { isProfileResolved };
}
