// lib/localeSwitch.ts
//
// #1508 【設計】言語切り替え画面が「現在地のパスを保ったまま」再ナビゲートするための純関数。
//
// `lib/authNext.ts` の `withCurrentLocale`（非公開）と同じ考え方だが、あちらは
// 「別ロケールで組まれた `next` パスを、いま居るロケールへ寄せる」向きで、こちらは
// 「いま居るパスは変えず、ロケール部分だけを新しい値へ差し替える」向き。用途が逆なので
// 呼び出し側を混同しないよう、あえて別関数として切り出している。
//
// ⚠️ `router` を引数に取らないこと。authNext.ts と同じ理由（テストを expo-router の
// モックから独立させるため）。

import { isValidBcp47Tag } from "./deepLinkTarget";

/**
 * パス先頭のロケールセグメントだけを差し替える。
 *
 * 先頭セグメントがロケールの形をしていない（起こりえないはずだが、念のため）場合は
 * ロケール直下へのパスにフォールバックする。
 *
 * @param pathname `usePathname()` の戻り値（クエリを含まない）
 * @param locale 差し替え先のロケール
 * @returns 新しいパス（例: `/en-US/profile/settings`）
 */
export const replaceLocaleInPath = (pathname: string, locale: string): string => {
	const segments = pathname.split("/");
	if (segments.length > 1 && isValidBcp47Tag(segments[1])) {
		segments[1] = locale;
		return segments.join("/");
	}
	return `/${locale}`;
};

/**
 * #1629【28】言語切替の**着地先**を決める。
 *
 * ## なぜ «いまのパス» ではいけないのか（実測したこと）
 *
 * 素直に `router.replace(replaceLocaleInPath(pathname, next))` すると、
 * **戻るが効かなくなる**。web ビルドで実測した遷移がこれ:
 *
 * ```
 * /ja-JP/profile                  → 端末設定へ
 * /ja-JP/profile/device-settings  → 言語設定へ
 * /ja-JP/profile/language         → 英語を選ぶ
 * /en-US/profile/language         ← ここで «戻る» を押すと…
 * /en-US/search                   ← **検索タブへ飛ぶ**
 * ```
 *
 * `router.replace` は «いまの navigator の現在地を差し替える» 操作なので、
 * 新しいロケールの Stack は **その 1 画面だけ**で組まれる。戻り先が Stack に無いので
 * タブの初期タブ（検索）へ抜ける。しかも profile の Stack は `language` のまま残るため、
 * もう一度プロフィールを開くと言語画面が出て、そこから戻るとまた検索へ行く。
 * **プロフィールへ二度と戻れない。**
 *
 * ⚠️ `unstable_settings.initialRouteName`（= anchor）では直らない。
 *    あれは **URL から state を組み立てるとき**に効くもので、`replace` には効かない。
 *    一度これで «直した» と報告して直っていなかった。
 *
 * ## どうするか
 *
 * **タブの根（`/<locale>/<tab>`）へ着地する。** 根なら Stack は 1 枚でも行き止まりにならず、
 * タブバーからも普通に戻れる。言語のような «アプリ全体の設定» を変えた直後に
 * その設定画面へ留まる必要はない。
 *
 * @param pathname `usePathname()` の戻り値
 * @param locale 切り替え先のロケール
 */
export const localeSwitchLandingPath = (pathname: string, locale: string): string => {
	const replaced = replaceLocaleInPath(pathname, locale);
	// `/en-US/profile/language` → `["", "en-US", "profile", "language"]`
	const segments = replaced.split("/");
	// ロケールの次のセグメントがタブ名。無ければロケールの根
	return segments.length > 2 && segments[2] ? `/${locale}/${segments[2]}` : `/${locale}`;
};
