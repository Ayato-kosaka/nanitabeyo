import { useEffect, useState } from "react";
import { useRootNavigationState, useRouter } from "expo-router";
import type { ExternalPathString } from "expo-router";
import * as Linking from "expo-linking";
import * as Localization from "expo-localization";
import * as SplashScreen from "expo-splash-screen";
import { Env } from "@/constants/Env";
import { getResolvedLocale } from "@/lib/i18n";
import { consumeLogoutRedirect } from "@/lib/logoutRedirect";
import { carriesOAuthResult } from "@/lib/oauthResultUrl";
// #721 ディープリンクの行き先判定は純関数へ切り出した（分岐をテストで固定するため）
// #1272 クエリは Linking.parse().path が落とすため、生 URL から別途切り出して行き先へ運ぶ
import { extractQueryString, toInAppPath } from "@/lib/deepLinkTarget";
import { loadLanguagePreference, type LanguagePreference } from "@/features/settings/languagePreferenceStore";
import * as WebBrowser from "expo-web-browser";
WebBrowser.maybeCompleteAuthSession();

// 初回表示中はスプラッシュ画面を保持（明示的に後で解除するまで表示）
SplashScreen.preventAutoHideAsync();

/**
 * #1124 起動時の URL を «ディープリンクの行き先» として採用済みか。
 *
 * `Linking.getInitialURL()` は「今回のディープリンク」ではなく «起動時の URL» を返し続けるため、
 * この画面が再マウントされるたびに参照すると、古い行き先へ繰り返し送ってしまう。
 * アプリのプロセス寿命で 1 回だけ採用する（モジュールスコープに置くのはそのため）。
 */
let hasConsumedInitialUrl = false;

/**
 * 🚀 アプリ初回起動時、デバイスのロケールに応じて自動的にリダイレクトする。
 *
 * - `expo-localization` の `getLocales()` を使用し、優先ロケールを抽出
 * - BCP 47 形式に従い、`languageTag` をそのままURLパスとして使用（例: `/ja`, `/en-US`）
 * @returns 画面表示を行わず、ルートリダイレクトのみを行う
 */
export default function App() {
	const router = useRouter();
	// #1124 ログアウトからの遷移では、起動時 URL をディープリンクとして再利用しない。
	// Android で実機確認済みの `router.replace("/")` を変えず、共有モジュールからロケールを一度だけ受け取る。
	const [logoutRedirectLocale] = useState(consumeLogoutRedirect);

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
	//
	// ⚠️ 「行き先があるならリダイレクトしない（expo-router に任せる）」は **不可**。
	// このアプリではルート (`/`) が何も描画しないため、遷移が来なければ空画面のまま固まる
	// （run 30470033327 の iOS では、その結果ディープリンク 2 件とも 2 分待って失敗した）。
	// 正しくは **リダイレクト先そのものを初期 URL に合わせる**。こうすると競合しようがない。
	//
	// `null` は「まだ初期 URL を調べていない」を表し、判定が付くまでリダイレクトを保留する
	const [initialPath, setInitialPath] = useState<string | null | undefined>(undefined);
	// #1272 【バグ】`Linking.parse().path` はクエリを落とす。`?tab=saved-dish-categories` のような
	// 行き先パラメータを保持するため、クエリ文字列は生 URL から別途切り出して持ち回る
	//（iOS はこの画面のリダイレクトが expo-router の初期 URL 解決に勝つため、ここで落とすと
	//  端末に届いたクエリが**アプリのどこにも到達しない**。probe の実測 `local=- global=-` で確定）
	const [initialQuery, setInitialQuery] = useState<string | null>(null);

	// #1508 【設計】端末言語より、ユーザーが設定画面で保存した言語を優先する。
	// `undefined` は「まだ AsyncStorage から読んでいない」を表し、判定が付くまでリダイレクトを保留する
	// （initialPath と同じ「未確定は保留」の作法）
	const [languagePreference, setLanguagePreference] = useState<LanguagePreference | undefined>(undefined);

	useEffect(() => {
		let cancelled = false;
		loadLanguagePreference().then((preference) => {
			if (!cancelled) setLanguagePreference(preference);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		// #1124 【バグ】2 回目以降のマウントでは初期 URL を採用しない。
		//
		// Linking.getInitialURL() は「今回のディープリンク」ではなく «起動時の URL» を返し続ける。
		//   - react-native-web: モジュール読み込み時の window.location.href に束縛される
		//     （react-native-web/dist/exports/Linking/index.js:13）
		//   - ネイティブ: アプリを起動した intent / URL のまま（onNewIntent では更新されない）
		// そのため、アプリ稼働中に "/" へ遷移してこの画面が再マウントされると
		//（ErrorBoundary の再試行、app/store.tsx、[locale]/_layout の復帰など）、
		// 「起動時の URL」を新しいディープリンクと誤認して古い行き先へ送ってしまう。
		//
		// 初回マウント（= コールドスタート）でだけ採用すれば、#1027 のディープリンク起動対応は
		// そのまま成立する。
		//
		// ⚠️ これは「再マウント時に古い行き先へ送らない」ための対策であって、
		// 「ログアウト後にホームへ戻る」ことの保証ではない。Web ではこの画面を一度も
		// マウントせずに深い URL で直接開くことがあり、その場合ログアウト時のマウントが
		// «初回» になって起動時 URL を採用してしまう（実測で設定画面へ戻った）。
		// ログアウトの行き先は AuthProvider が明示的に指定している。
		if (logoutRedirectLocale || hasConsumedInitialUrl) {
			// ログアウト直後に初めてここへ来る場合も、以後は古い起動時 URL を採用しない。
			if (logoutRedirectLocale) hasConsumedInitialUrl = true;
			setInitialPath(null);
			return;
		}
		hasConsumedInitialUrl = true;

		let cancelled = false;
		Linking.getInitialURL()
			.then((url) => {
				if (cancelled) return;
				// #1135 認証結果（code / error / access_token）を運んでいる URL は、行き先として採用しない。
				// `Linking.parse().path` はクエリを落とすため、採用すると `code` ごと捨てて遷移することになる。
				// 判定は lib/oauthResultUrl.ts の共有ロジック（callback 画面と同じもの）を使う。
				if (carriesOAuthResult(url)) {
					setInitialPath(null);
					return;
				}
				// #1272 パスとクエリを別々に保持する（parse().path がクエリを落とすため）
				setInitialQuery(extractQueryString(url));
				setInitialPath(url ? (Linking.parse(url).path ?? null) : null);
			})
			.catch(() => {
				// 取得できない場合は通常起動として扱う（起動できなくなる方が害が大きい）
				if (!cancelled) setInitialPath(null);
			});
		return () => {
			cancelled = true;
		};
	}, [logoutRedirectLocale]);

	useEffect(() => {
		if (!isNavigationReady) return;
		if (initialPath === undefined) return;
		if (languagePreference === undefined) return;

		// #1508 【設計】保存済みの言語設定があればそれを、無ければ（"system"）従来どおり
		// 端末のロケールを使う。deepLinkTarget が既にロケールを持つ URL（共有リンク等）を
		// 上書きしないのは変更前と同じ
		const deviceLocale = getResolvedLocale(Localization.getLocales?.()[0]?.languageTag);
		const resolvedLocale = languagePreference === "system" ? deviceLocale : languagePreference;
		// 初期 URL の先頭セグメントがロケールなら、そのパスをそのまま行き先にする。
		// アプリ内のルートとして解釈できない URL（OAuth コールバック等）は巻き込まない
		// #1272 クエリ（?tab= 等）も行き先の一部として運ぶ。落とすとタブ指定つきの
		// ディープリンクが iOS で先頭タブに化ける（純関数側の doc コメント参照）
		const deepLinkTarget = toInAppPath(initialPath, initialQuery);
		const target = logoutRedirectLocale ? `/${logoutRedirectLocale}` : (deepLinkTarget ?? `/${resolvedLocale}`);

		if (Env.NODE_ENV === "development") {
			console.log(`[LocaleRedirect] Detected locale: ${resolvedLocale} / target: ${target}`);
		}

		const timer = setTimeout(() => {
			router.replace(target as ExternalPathString);
		}, 0);
		return () => clearTimeout(timer);
	}, [isNavigationReady, initialPath, logoutRedirectLocale, languagePreference]);

	return null;
}
