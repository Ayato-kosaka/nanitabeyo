import { useMemo } from "react";

import { useAppTheme } from "@/contexts/ThemeProvider";

/**
 * #1629【27】**`Stack` / `Tabs` の «画面の下地» をテーマへ追従させる。**
 *
 * ## なぜ要るのか
 *
 * expo-router の `NavigationContainer` は既定で react-navigation の `DefaultTheme` を使う
 * （このリポジトリに `DarkTheme` を渡している箇所は無い）。`DefaultTheme.colors.background` は
 * `rgb(242,242,242)` の明るいグレーで、**画面が全面を塗り切らない瞬間**にそれが見える。
 *
 * - 画面遷移アニメーションの最中（前の画面と次の画面の隙間）
 * - モーダルの背後
 * - 画面のマウント直後、まだ中身が描かれていない一瞬
 *
 * ダークモードだと、そこだけ明るいグレーが光る。
 *
 * ## なぜ検査で見つからなかったのか
 *
 * `scripts/assert-no-hardcoded-colors.mjs` が見るのは **«書いた色»** である。
 * これは **«色を書かなかった»** ことで起きる不具合なので、原理的に検出できない
 * （2026-08-27 の全体監査で判明。#1629 の監査コメント B-4）。
 *
 * ## 使い方
 *
 * ```tsx
 * const screenOptions = useThemedStackScreenOptions({ headerShown: false });
 * return <Stack screenOptions={screenOptions} />;
 * ```
 *
 * ⚠️ **`ThemeProvider` の内側でしか使えない。** 起点は `app/[locale]/_layout.tsx` である。
 *    その外側（`app/_layout.tsx`）で呼ぶと既定のライトが返るだけなので、意味が無い。
 */
export function useThemedStackScreenOptions<T extends object>(options?: T): T & { contentStyle: { backgroundColor: string } } {
	const { colors } = useAppTheme();
	return useMemo(
		() => ({ ...(options ?? ({} as T)), contentStyle: { backgroundColor: colors.background } }),
		// options はインラインのオブジェクトリテラルで渡されることが多く、そのまま依存に置くと
		// 毎レンダーで新しい値になる。中身は静的なので JSON で畳んで比べる
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[colors.background, JSON.stringify(options ?? {})],
	) as T & { contentStyle: { backgroundColor: string } };
}
