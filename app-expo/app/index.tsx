import { useEffect, useState } from "react";
import { useRootNavigationState, useRouter } from "expo-router";
import type { ExternalPathString } from "expo-router";
import * as Linking from "expo-linking";
import * as Localization from "expo-localization";
import * as SplashScreen from "expo-splash-screen";
import { Env } from "@/constants/Env";
import { getResolvedLocale } from "@/lib/i18n";
import * as WebBrowser from "expo-web-browser";
WebBrowser.maybeCompleteAuthSession();

// 初回表示中はスプラッシュ画面を保持（明示的に後で解除するまで表示）
SplashScreen.preventAutoHideAsync();

/**
 * 🚀 アプリ初回起動時、デバイスのロケールに応じて自動的にリダイレクトする。
 *
 * - `expo-localization` の `getLocales()` を使用し、優先ロケールを抽出
 * - BCP 47 形式に従い、`languageTag` をそのままURLパスとして使用（例: `/ja`, `/en-US`）
 * @returns 画面表示を行わず、ルートリダイレクトのみを行う
 */
export default function App() {
	const router = useRouter();

	// #1027 【バグ】ルートナビゲータのマウント前に router.replace() を呼ぶと expo-router の
	// assertIsReady が「Attempted to navigate before mounting the Root Layout component.」を投げ、
	// JS 例外でアプリごとクラッシュする。setTimeout(0) だけでは「次のタスクまでに必ずマウント済み」を
	// 保証できない（release ビルド + 低速端末では間に合わないことがある）ため、
	// ナビゲータの準備完了を明示的に待ってからリダイレクトする
	const rootNavigationState = useRootNavigationState();
	const isNavigationReady = rootNavigationState?.key != null;

	// #1027 【バグ】ディープリンクで起動したときにこのリダイレクトが**行き先を奪う**。
	// iOS はコールドスタート時に一度ルート (`/`) を描画してから初期 URL を解決することがあり、
	// その隙に `router.replace("/ja-JP")` が走ると、`nanitabeyo:///ja-JP/profile` で起動しても
	// ロケール直下（= 既定タブの検索画面）へ着地してしまう
	// （run 30460621899 の iOS で実測。Android は解決が先に済むため顕在化しない）。
	// 初期 URL に行き先（パス）がある場合は expo-router 自身の遷移に任せ、ここでは何もしない。
	// `null` は「まだ調べていない」を表し、判定が付くまでリダイレクトを保留する
	const [hasInitialDeepLink, setHasInitialDeepLink] = useState<boolean | null>(null);

	useEffect(() => {
		let cancelled = false;
		Linking.getInitialURL()
			.then((url) => {
				if (cancelled) return;
				// パスが空（= アプリのスキームだけ）ならディープリンクとしての行き先が無いので通常起動と同じ
				const path = url ? Linking.parse(url).path : null;
				setHasInitialDeepLink(!!path && path !== "/");
			})
			.catch(() => {
				// 取得できない場合は従来どおりリダイレクトする（起動できなくなる方が害が大きい）
				if (!cancelled) setHasInitialDeepLink(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!isNavigationReady) return;
		if (hasInitialDeepLink === null || hasInitialDeepLink) return;

		const resolvedLocale = getResolvedLocale(Localization.getLocales?.()[0]?.languageTag);

		if (Env.NODE_ENV === "development") {
			console.log(`[LocaleRedirect] Detected locale: ${resolvedLocale}`);
		}

		const timer = setTimeout(() => {
			// 対応するロケールにリダイレクト
			router.replace(`/${resolvedLocale}` as ExternalPathString);
		}, 0);
		return () => clearTimeout(timer);
	}, [isNavigationReady, hasInitialDeepLink]);

	return null;
}
