import type { UserProfile } from "@shared/api/v1/res";
import { createWithEqualityFn } from "zustand/traditional";

/**
 * プロフィール情報を管理するグローバルストア
 *
 * 責務:
 * - ログインユーザーのプロフィール情報をグローバルに保持
 * - プロフィール更新時の状態反映
 *
 * ※認証状態（token/session）は AuthProvider が管理
 */
export type ProfileStore = {
	/** 現在のプロフィール情報（未ロード時は null） */
	profile: UserProfile | null;

	/** プロフィール全体を設定する（初回ロード・再ロード用） */
	setProfile: (profile: UserProfile | null) => void;

	/** プロフィールを部分的に更新する（編集フォーム用） */
	updateProfile: (updater: (prev: UserProfile | null) => UserProfile | null) => void;

	/** プロフィールをリセットする（ログアウト時用） */
	resetProfile: () => void;
};

export const useProfileStore = createWithEqualityFn<ProfileStore>()((set) => ({
	profile: null,

	setProfile: (profile) => set({ profile }),

	updateProfile: (updater) =>
		set((state) => ({
			profile: updater(state.profile),
		})),

	resetProfile: () => set({ profile: null }),
}));
