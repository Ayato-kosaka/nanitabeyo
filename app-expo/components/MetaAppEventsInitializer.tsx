import { useEffect, useRef, useCallback } from "react";
import { InteractionManager, Platform } from "react-native";
import { usePathname } from "expo-router";
import { requestTrackingPermissionsAsync, getTrackingPermissionsAsync } from "expo-tracking-transparency";
import { Settings } from "react-native-fbsdk-next";
import { Env } from "@/constants/Env";
import { isOnboardingPath } from "@/features/onboarding/navigation";
import { loadOnboardingSeen } from "@/features/onboarding/onboardingSeenStore";
import i18n from "@/lib/i18n";

/**
 * #492 【設計】Meta (Facebook) App Events 初期化用コンポーネント。
 *
 * - ATT (App Tracking Transparency) の回答を得てから Meta SDK を初期化する（iOS のみ）
 * - ATT 許可ステータスに基づいて広告 ID 収集 / イベント送信を設定
 * - Expo Go では動作しない（EAS Build / Dev Client が必要）
 *
 * @returns null（UI を持たない初期化専用コンポーネント）
 */

/**
 * #1486 §8【設計】**ATT を要求してよいのは «アプリ本体に入った後» だけ**。
 *
 * 以前はこのコンポーネントが `app/[locale]/_layout.tsx` のマウント直後に走っていた。
 * 新オンボーディングでは、その瞬間ユーザーが見ているのは 3 ステップの 1 枚目である。
 * 「食べたいものが決まらない」という話をしている最中に OS のトラッキング許可ダイアログが
 * 割り込むと、文脈が無いぶん拒否されやすく、オンボーディング自体も分断される。
 *
 * ## 判定の組み立て（パス判定だけでは足りない — 実機で ATT が最初に出たバグの修正）
 *
 * コールドスタート直後の `usePathname()` は、検索画面がオンボーディングへ push する
 * **前の** `/ja-JP` を一瞬返す。パスだけで判定すると、その隙間で ATT が要求されて
 * 「トラッキング許可が一番始めに出てくる」（実機で報告された）。そこで
 * `initializeMetaAppEvents` の冒頭で完了フラグを読み、**未読の日本語ユーザー**
 *（これからオンボーディングが始まる人）は見送る。完了後にアプリ本体へ戻ると
 * pathname が変わって effect が再実行され、そこで初めて要求される。
 * 日本語以外のユーザーはオンボーディングを通らずフラグが立たない（#642）ので
 * 見送らず、従来どおり起動直後に要求される。
 *
 * ⚠️ 完了フラグは **描画中に購読しない**（useOnboardingSeen を使わない）こと。
 * この階層（[locale] レイアウト直下）のコンポーネントで既読ストアを購読すると、
 * オンボーディングへの push 遷移中の再描画と干渉して [locale] レイアウトが作り直され、
 * AppProvider(LoadScript) が「google api is already presented」で固まり
 * **アプリ全体が Loading のまま止まる**（PushTokenRegistration で e2e により実証済み）。
 * effect 内で `loadOnboardingSeen()` を await する分には描画へ影響しない。
 */
export const MetaAppEventsInitializer = () => {
	const hasInitializedRef = useRef(false);
	const pathname = usePathname();
	const mayRequest = !isOnboardingPath(pathname);

	const initializeMetaAppEvents = useCallback(async () => {
		if (hasInitializedRef.current) return;

		// #492 【設計】Web は Meta SDK 非対応のためスキップ
		if (Platform.OS === "web") return;

		// #1486 §8 未読の日本語ユーザーはまだオンボーディングが始まっていない（あるいは最中）。
		// ATT を出さずに見送る。`hasInitializedRef` は立てないので、完了後の画面遷移で
		// effect が再実行されたときに改めてここを通る
		const seen = await loadOnboardingSeen();
		const isJapanese = ["ja-JP", "ja"].includes(i18n.locale);
		if (!seen && isJapanese) return;

		try {
			// #1486 §8【設計】**ATT の回答より先にトラッキングを始めない**。
			//
			// そのため順序が入れ替わっている（以前は initializeSDK が先頭にあった）。
			// `Settings.initializeSDK()` を呼んだ時点で SDK は `fb_mobile_activate_app` を
			// 自動送信しうるため、広告 ID 収集・自動イベント送信の可否を **確定させてから**
			// 初期化する。app.config.ts の fbsdk プラグインでも
			// `isAutoInitEnabled` / `autoLogAppEventsEnabled` / `advertiserIDCollectionEnabled` を
			// すべて false にしてあり（= ネイティブ側の自動初期化も止めてある）、
			// ここが SDK が動き出す唯一の入口になっている。
			let trackingEnabled = true; // Android はデフォルトで有効
			if (Platform.OS === "ios") {
				let { status } = await getTrackingPermissionsAsync();
				if (status === "undetermined") {
					const result = await requestTrackingPermissionsAsync();
					status = result.status;
				}
				// #492 【設計】ATT 許可ステータスに基づいて広告 ID 収集を設定
				if (status === "granted") {
					trackingEnabled = true;
				} else if (status === "denied") {
					trackingEnabled = false;
				} else {
					// unavailable / restricted などは SDK デフォルトに任せる or false で明示的に切る
					// trackingEnabled = true; // こうする、などポリシーで決める
				}
				await Settings.setAdvertiserTrackingEnabled(trackingEnabled);
			}

			// 回答が確定してから、SDK 側のフラグを立てて初期化する
			Settings.setAdvertiserIDCollectionEnabled(trackingEnabled);
			Settings.setAutoLogAppEventsEnabled(true);
			Settings.initializeSDK();

			hasInitializedRef.current = true;

			if (Env.NODE_ENV === "development") {
				console.log("[MetaAppEventsInitializer] Meta SDK initialized, tracking:", trackingEnabled);
			}
		} catch (error) {
			if (Env.NODE_ENV === "development") {
				console.error("[MetaAppEventsInitializer] Failed to initialize Meta SDK:", error);
			}
		}
	}, []);

	useEffect(() => {
		// #1486 §8 オンボーディングが済む（または対象外と分かる）まで ATT を要求しない。
		// 条件が揃った時点でこの effect が張り直され、そこで初めて要求される
		if (!mayRequest) return;

		// #1013 【パフォーマンス】root layout 直下でネイティブブリッジ(SDK初期化・ATTダイアログ)を
		// 即時実行すると起動直後の描画が遅れるため、初回インタラクション完了後まで初期化を遅延する
		const task = InteractionManager.runAfterInteractions(() => {
			initializeMetaAppEvents();
		});
		return () => task.cancel();
	}, [initializeMetaAppEvents, mayRequest]);

	return null;
};
