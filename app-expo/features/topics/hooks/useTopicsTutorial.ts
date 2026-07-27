import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLogger } from "@/hooks/useLogger";
import type { TopicsTutorialOpenReason } from "@/features/topics/types/tutorial";

/**
 * 閲覧済みフラグは仕様変更時に明示的にバージョンを上げる。
 *
 * 既存キーを書き換えるより新しいキーへ移行する方が、
 * 「どのチュートリアルを見たか」が曖昧にならず安全。
 */
export const TOPICS_TUTORIAL_STORAGE_KEY = "topics_spotlight_tutorial_seen_v1";

type TutorialRequest = {
	id: number;
	reason: TopicsTutorialOpenReason;
};

type UseTopicsTutorialOptions = {
	/**
	 * 料理取得、Carouselの高さ計算、検索セッション確定まで完了したか。
	 *
	 * ここではrefの座標までは判定しない。実座標の最終確認は
	 * TopicsSpotlightTutorial が行い、表示成功後に onPresented を返す。
	 */
	canAutoOpen: boolean;
};

/**
 * 料理提案画面専用チュートリアルの永続状態と開閉要求を管理する。
 *
 * 検索画面のBottomSheetとは見た目もライフサイクルも異なるため、
 * useSearchTutorialを無理に共通化せず、AsyncStorageの設計だけを踏襲する。
 */
export function useTopicsTutorial({ canAutoOpen }: UseTopicsTutorialOptions) {
	const { logFrontendEvent } = useLogger();
	const [hasSeenTutorial, setHasSeenTutorial] = useState<boolean | null>(null);
	const [request, setRequest] = useState<TutorialRequest | null>(null);

	// 再レンダーやStorage失敗で、同じ画面表示中に自動openが連打されるのを防ぐ。
	const hasRequestedAutoOpenRef = useRef(false);
	// 同じ表示要求に対して、閲覧済み保存を二重実行しない。
	const presentedRequestIdRef = useRef<number | null>(null);
	// manual再表示も含め、Modalを確実に初期化できる単調増加ID。
	const nextRequestIdRef = useRef(0);

	useEffect(() => {
		let isMounted = true;

		const loadTutorialState = async () => {
			try {
				const storedValue = await AsyncStorage.getItem(TOPICS_TUTORIAL_STORAGE_KEY);
				if (isMounted) {
					setHasSeenTutorial(storedValue === "true");
				}
			} catch (error) {
				// Storage障害で主要画面を利用不能にしない。未閲覧扱いで1回だけ案内する。
				if (isMounted) {
					setHasSeenTutorial(false);
				}
				void logFrontendEvent({
					event_name: "topics_tutorial_storage_failed",
					error_level: "warn",
					payload: {
						operation: "read",
						message: error instanceof Error ? error.message : String(error),
					},
				});
			}
		};

		void loadTutorialState();

		return () => {
			isMounted = false;
		};
	}, [logFrontendEvent]);

	const createRequest = useCallback((reason: TopicsTutorialOpenReason) => {
		nextRequestIdRef.current += 1;
		presentedRequestIdRef.current = null;
		setRequest({ id: nextRequestIdRef.current, reason });
	}, []);

	useEffect(() => {
		if (!canAutoOpen || hasSeenTutorial !== false || hasRequestedAutoOpenRef.current || request) {
			return;
		}

		// 「対象が描画できる状態になった最初の1回」だけ自動表示を要求する。
		hasRequestedAutoOpenRef.current = true;
		createRequest("auto");
	}, [canAutoOpen, createRequest, hasSeenTutorial, request]);

	/** 「？」からの再表示。閲覧済みフラグは変更しない。 */
	const openManually = useCallback(() => {
		if (!canAutoOpen || request) return;
		// Storage読込と同時に押された場合でも、手動表示の直後にauto表示を重ねない。
		hasRequestedAutoOpenRef.current = true;
		createRequest("manual");
	}, [canAutoOpen, createRequest, request]);

	/** スキップ・完了・計測断念を同じ経路で閉じる。 */
	const close = useCallback(() => {
		setRequest(null);
	}, []);

	/**
	 * スポットライトが実際に描画可能になった時点で呼ばれる。
	 *
	 * auto要求を出しただけでは保存しないため、レイアウト計測に失敗した端末で
	 * 「見ていないのに閲覧済み」になることを防げる。
	 *
	 * reasonがmanualでも必ず保存する。ここで保存しないと、Storage読込完了前に
	 * 「？」から開いたユーザーがhasSeenTutorial=falseのまま次回起動を迎え、
	 * 見たばかりのチュートリアルが自動でもう一度開いてしまう。
	 */
	const markPresented = useCallback(() => {
		if (!request || presentedRequestIdRef.current === request.id) return;

		presentedRequestIdRef.current = request.id;

		// 保存完了を待たずメモリ上は閲覧済みにし、同一セッションの再表示を確実に防ぐ。
		setHasSeenTutorial(true);
		void AsyncStorage.setItem(TOPICS_TUTORIAL_STORAGE_KEY, "true").catch((error) => {
			void logFrontendEvent({
				event_name: "topics_tutorial_storage_failed",
				error_level: "warn",
				payload: {
					operation: "write",
					message: error instanceof Error ? error.message : String(error),
				},
			});
		});
	}, [logFrontendEvent, request]);

	return {
		hasSeenTutorial,
		isTutorialRequested: request !== null,
		tutorialRequestId: request?.id ?? 0,
		openReason: request?.reason ?? "manual",
		openManually,
		close,
		markPresented,
	};
}
