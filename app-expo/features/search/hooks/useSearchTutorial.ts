import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { readE2ETutorialSeen } from "@/lib/e2e/tutorialSeed";

const TUTORIAL_STORAGE_KEY = "search_tutorial_seen_v1";

/**
 * #642 【設計】Searchチュートリアルの表示状態を管理するフック
 * - AsyncStorage に完了フラグを保存
 * - 初回表示時: false → 自動表示
 * - 完了後: true → 自動表示しない
 */
export function useSearchTutorial() {
	const [hasSeenTutorial, setHasSeenTutorial] = useState<boolean | null>(null);
	const [isLoading, setIsLoading] = useState(true);

	// チュートリアル表示状態を読み込み
	const loadTutorialState = useCallback(async () => {
		// #1027 【設計】E2E(Detox) では起動引数で視聴済みフラグを固定できる。
		// 通常ビルドでは metro の resolver が noop 実装へ差し替えるため、この関数は常に null を返す
		//（= 以下の AsyncStorage 読み込みへそのまま進み、本番と 1 バイトも挙動が変わらない）。
		// 詳細と、なぜ「出ていたら閉じる」ではなくシード方式にしたのかは lib/e2e/tutorialSeed.ts を参照
		const seeded = readE2ETutorialSeen();
		if (seeded !== null) {
			setHasSeenTutorial(seeded);
			setIsLoading(false);
			return;
		}

		try {
			const value = await AsyncStorage.getItem(TUTORIAL_STORAGE_KEY);
			setHasSeenTutorial(value === "true");
		} catch (error) {
			console.error("Failed to load tutorial state:", error);
			setHasSeenTutorial(false); // デフォルトは未表示扱い
		} finally {
			setIsLoading(false);
		}
	}, []);

	// チュートリアル完了をマーク
	const markTutorialAsSeen = useCallback(async () => {
		try {
			await AsyncStorage.setItem(TUTORIAL_STORAGE_KEY, "true");
			setHasSeenTutorial(true);
		} catch (error) {
			console.error("Failed to save tutorial state:", error);
		}
	}, []);

	// チュートリアル状態をリセット（開発/テスト用）
	const resetTutorialState = useCallback(async () => {
		try {
			await AsyncStorage.removeItem(TUTORIAL_STORAGE_KEY);
			setHasSeenTutorial(false);
		} catch (error) {
			console.error("Failed to reset tutorial state:", error);
		}
	}, []);

	useEffect(() => {
		loadTutorialState();
	}, [loadTutorialState]);

	return {
		hasSeenTutorial,
		isLoading,
		markTutorialAsSeen,
		resetTutorialState,
	};
}
