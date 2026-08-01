import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";


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
