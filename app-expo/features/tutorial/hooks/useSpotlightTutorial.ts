import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { readE2ETutorialSeen } from "@/lib/e2e/tutorialSeed";
import { useLogger } from "@/hooks/useLogger";
import { toErrorLogMessage } from "@/lib/errorMessage";
import type { SpotlightOpenReason } from "@/features/tutorial/types/spotlight";

/*
スポットライト型チュートリアルの «見たかどうか» と開閉要求。

画面ごとに違うのは **保存キーだけ**なので、そこだけ引数で受ける（#1375 で my-dishes にも
同じ形が要ることになり、料理提案画面の実装から切り出した）。

閲覧済みフラグは仕様変更時に明示的にバージョンを上げること。既存キーを書き換えるより
新しいキーへ移行する方が、「どのチュートリアルを見たか」が曖昧にならず安全。
*/

type TutorialRequest = {
	id: number;
	reason: SpotlightOpenReason;
};

type UseSpotlightTutorialOptions = {
	/** AsyncStorage のキー。画面ごとに別（`*_seen_v1`） */
	storageKey: string;
	/**
	 * 料理取得、Carouselの高さ計算、検索セッション確定まで完了したか。
	 *
	 * ここではrefの座標までは判定しない。実座標の最終確認は
	 * TopicsSpotlightTutorial が行い、表示成功後に onPresented を返す。
	 */
	canAutoOpen: boolean;
};

/**
 * スポットライト型チュートリアルの永続状態と開閉要求を管理する。
 *
 * 検索画面の BottomSheet とは見た目もライフサイクルも異なるため、
 * useSearchTutorial を無理に共通化せず、AsyncStorage の設計だけを踏襲している。
 */
export function useSpotlightTutorial({ storageKey, canAutoOpen }: UseSpotlightTutorialOptions) {
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
			// #1156 【設計】E2E(Detox) では起動引数で視聴済みフラグを固定できる。
			// useSearchTutorial と同じシード方式へ揃える（#1027 の「出ていたら閉じる」ではなくシードする方針）。
			//
			// これが無いと、料理提案画面へ入る spec は毎回スポットライトチュートリアルと競合する。
			// 実際 Expo SDK 54 化（#1156）で Carousel の高さ確定タイミングが変わった結果、
			// canAutoOpen が成立する瞬間がずれ、iOS の search-double-tap / topics-flow が
			// 「チュートリアルがヘッダーを覆って topics-header-back を押せない」で落ちるようになった。
			//
			// 通常ビルドでは metro の resolver が noop 実装へ差し替えるため、この関数は常に null を返す
			// （= 以下の AsyncStorage 読み込みへそのまま進み、本番と 1 バイトも挙動が変わらない）。
			const seeded = readE2ETutorialSeen();
			if (seeded !== null) {
				if (isMounted) setHasSeenTutorial(seeded);
				return;
			}

			try {
				const storedValue = await AsyncStorage.getItem(storageKey);
				if (isMounted) {
					setHasSeenTutorial(storedValue === "true");
				}
			} catch (error) {
				// Storage障害で主要画面を利用不能にしない。未閲覧扱いで1回だけ案内する。
				if (isMounted) {
					setHasSeenTutorial(false);
				}
				void logFrontendEvent({
					event_name: "spotlight_tutorial_storage_failed",
					error_level: "warn",
					payload: {
						operation: "read",
						// #1092 PR4b 置換前は (B) なので message 側へ寄せる（Error は message のみで非回帰）
						message: toErrorLogMessage(error),
					},
				});
			}
		};

		void loadTutorialState();

		return () => {
			isMounted = false;
		};
		// ⚠️ storageKey を依存から外さないこと。画面ごとに違う値なので、抜けると
		// 「別の画面のチュートリアルを見た」で既読判定される
	}, [logFrontendEvent, storageKey]);

	const createRequest = useCallback((reason: SpotlightOpenReason) => {
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
		void AsyncStorage.setItem(storageKey, "true").catch((error) => {
			void logFrontendEvent({
				event_name: "spotlight_tutorial_storage_failed",
				error_level: "warn",
				payload: {
					operation: "write",
					// #1092 PR4b 置換前は (B) なので message 側へ寄せる（Error は message のみで非回帰）
					message: toErrorLogMessage(error),
				},
			});
		});
	}, [logFrontendEvent, request, storageKey]);

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
