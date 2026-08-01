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

/** BCP 47 言語タグの形式か（app/[locale]/_layout.tsx と同じ判定） */
const isValidBcp47Tag = (tag: string): boolean => /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(tag);

/**
 * #1124 起動時の URL を «ディープリンクの行き先» として採用済みか。
 *
 * `Linking.getInitialURL()` は「今回のディープリンク」ではなく «起動時の URL» を返し続けるため、
 * この画面が再マウントされるたびに参照すると、古い行き先へ繰り返し送ってしまう。
 * アプリのプロセス寿命で 1 回だけ採用する（モジュールスコープに置くのはそのため）。
 */
let hasConsumedInitialUrl = false;

/**
 * ディープリンクのパスを「アプリ内ルート」として解釈できるなら、その絶対パスを返す。
 *
 * #1027 先頭セグメントがロケールであることを条件にする。これによりロケール配下の画面
 *（`ja-JP/profile` 等）だけを行き先として採用し、OAuth コールバックのような
 * ルーティング対象外の URL でリダイレクト先を上書きしてしまう事故を防ぐ。
 *
 * @param path `Linking.parse(url).path`（先頭スラッシュ無し / 無ければ null）
 * @returns 採用できる場合は "/ja-JP/profile" 形式 / それ以外は null
 */
const toInAppPath = (path: string | null | undefined): string | null => {
	const normalized = path?.replace(/^\/+/, "") ?? "";
	if (!normalized) return null;
	const [firstSegment] = normalized.split("/");
	if (!firstSegment || !isValidBcp47Tag(firstSegment)) return null;
	return `/${normalized}`;
};

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
	//
	// ⚠️ 「行き先があるならリダイレクトしない（expo-router に任せる）」は **不可**。
	// このアプリではルート (`/`) が何も描画しないため、遷移が来なければ空画面のまま固まる
	// （run 30470033327 の iOS では、その結果ディープリンク 2 件とも 2 分待って失敗した）。
	// 正しくは **リダイレクト先そのものを初期 URL に合わせる**。こうすると競合しようがない。
	//
	// `null` は「まだ初期 URL を調べていない」を表し、判定が付くまでリダイレクトを保留する
	const [initialPath, setInitialPath] = useState<string | null | undefined>(undefined);

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
		if (hasConsumedInitialUrl) {
			setInitialPath(null);
			return;
		}
		hasConsumedInitialUrl = true;

		let cancelled = false;
		Linking.getInitialURL()
			.then((url) => {
				if (cancelled) return;
				setInitialPath(url ? (Linking.parse(url).path ?? null) : null);
			})
			.catch(() => {
				// 取得できない場合は通常起動として扱う（起動できなくなる方が害が大きい）
				if (!cancelled) setInitialPath(null);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!isNavigationReady) return;
		if (initialPath === undefined) return;

		const resolvedLocale = getResolvedLocale(Localization.getLocales?.()[0]?.languageTag);
		// 初期 URL の先頭セグメントがロケールなら、そのパスをそのまま行き先にする。
		// アプリ内のルートとして解釈できない URL（OAuth コールバック等）は巻き込まない
		const deepLinkTarget = toInAppPath(initialPath);
		const target = deepLinkTarget ?? `/${resolvedLocale}`;

		if (Env.NODE_ENV === "development") {
			console.log(`[LocaleRedirect] Detected locale: ${resolvedLocale} / target: ${target}`);
		}

		const timer = setTimeout(() => {
			router.replace(target as ExternalPathString);
		}, 0);
		return () => clearTimeout(timer);
	}, [isNavigationReady, initialPath]);

	return null;
}
