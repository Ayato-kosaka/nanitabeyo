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
