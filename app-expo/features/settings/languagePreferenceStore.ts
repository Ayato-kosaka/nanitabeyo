/*
このファイルの責務
- 「表示言語をユーザーが手動で選んだか、端末設定に従うか」という端末ローカルの設定値を持つ。
- AsyncStorage への読み書きを提供する。

#1508 【設計】永続化は既存の作法（features/onboarding/onboardingSeenStore.ts,
features/search/hooks/useRecentLocations.ts）に合わせ、AsyncStorage を直接使う。

読み手（`app/index.tsx` の起動時リダイレクト）と書き手（言語選択画面）が別マウントで、
どちらも「起動 or 画面表示のたびに 1 回読めば足りる」ため、onboardingSeenStore.ts のような
モジュールスコープの購読機構は持たせていない（不要な複雑さになるため）。
*/
import AsyncStorage from "@react-native-async-storage/async-storage";

import { isPublicLocale, type PublicLocale } from "@shared/api/v1/constants/publicLocales";

/** 端末ローカルに保存するキー */
export const LANGUAGE_PREFERENCE_STORAGE_KEY = "language_preference_v1";

/** `"system"` = 端末の設定に従う（＝保存値なし） */
export type LanguagePreference = PublicLocale | "system";

/**
 * 保存済みの言語設定を読み込む。
 *
 * @失敗時 例外は投げない。読めなかった場合は「端末設定に従う」へ倒す
 * （onboardingSeenStore.ts と同じ方針。最悪でも端末言語で起動するだけで済む）。
 */
export const loadLanguagePreference = async (): Promise<LanguagePreference> => {
	try {
		const value = await AsyncStorage.getItem(LANGUAGE_PREFERENCE_STORAGE_KEY);
		if (value && isPublicLocale(value)) return value;
		return "system";
	} catch (error) {
		console.error("Failed to load language preference:", error);
		return "system";
	}
};

/** 言語設定を保存する。`"system"` を選んだ場合は保存値そのものを消す */
export const saveLanguagePreference = async (preference: LanguagePreference): Promise<void> => {
	try {
		if (preference === "system") {
			await AsyncStorage.removeItem(LANGUAGE_PREFERENCE_STORAGE_KEY);
		} else {
			await AsyncStorage.setItem(LANGUAGE_PREFERENCE_STORAGE_KEY, preference);
		}
	} catch (error) {
		console.error("Failed to save language preference:", error);
	}
};
