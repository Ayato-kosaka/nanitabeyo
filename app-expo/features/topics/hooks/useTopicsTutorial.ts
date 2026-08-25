import { useSpotlightTutorial } from "@/features/tutorial/hooks/useSpotlightTutorial";

/**
 * 閲覧済みフラグは仕様変更時に明示的にバージョンを上げる。
 *
 * 既存キーを書き換えるより新しいキーへ移行する方が、
 * 「どのチュートリアルを見たか」が曖昧にならず安全。
 */
export const TOPICS_TUTORIAL_STORAGE_KEY = "topics_spotlight_tutorial_seen_v1";

/**
 * #927 料理提案画面のチュートリアル。中身は共通の `useSpotlightTutorial`（#1375 で切り出し）で、
 * ここが持つのは **保存キーだけ**である。
 */
export function useTopicsTutorial({ canAutoOpen }: { canAutoOpen: boolean }) {
	return useSpotlightTutorial({ storageKey: TOPICS_TUTORIAL_STORAGE_KEY, canAutoOpen });
}
