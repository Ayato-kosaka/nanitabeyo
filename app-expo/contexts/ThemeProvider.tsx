import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "@/hooks/useColorScheme";
import { getPalette, type ColorScheme, type Palette } from "@/constants/Palette";

/**
 * 🌗 #1509 SET-05 テーマ（ダークモード）の設定と解決。
 *
 * ## 何を持つか
 * - `preference`: ユーザーが設定画面で選んだ値。**3 択（システム追従 / ライト / ダーク）**。既定は `"system"`
 * - `scheme`: 上を OS のスキームで解決した結果。実際に描画へ使うのはこちら
 * - `colors`: `scheme` に対応する `constants/Palette.ts` のパレット
 *
 * ## なぜ Context なのか
 * `hooks/useColorScheme.ts` を各画面から直接呼ぶと「OS 追従」しか表現できず、
 * アプリ内の 3 択を反映できない。解決は 1 箇所で行い、画面はその結果だけを見る。
 *
 * ## 永続化
 * AsyncStorage にバージョン付きキーで保存する（`features/search/hooks/useRecentLocations.ts` の
 * `recent_locations_v1` と同じ作法）。端末ローカルの設定なので DB もサーバ同期も持たない。
 * 読めない値・未知の値は `"system"` へ倒す（壊れた値は読み出し時に捨てる方針を踏襲）。
 *
 * ## 起動直後の 1 フレーム
 * AsyncStorage の読み出しは非同期なので、解決前は `"system"`（= OS 追従）で描画される。
 * ネイティブは `components/SplashHandler.tsx` がスプラッシュを保持している間に読み終わる。
 * web は prerender された HTML が先に出るため、「OS はライト・アプリ設定はダーク」の組み合わせでは
 * 初回に一瞬ライトが見えうる（#1509 でオーナー了承済みの既知の制約）。
 *
 * ## Provider の外で使われたとき
 * `useAppTheme()` は throw せず **ライト固定の既定値**を返す。
 * 単体テスト（`__tests__/`）やカタログのスナップショットは Provider を張らずに
 * コンポーネントを描画するため、ここで例外を投げると既存のテストが軒並み落ちる。
 * ライトへ倒しておけば、Provider が無い環境の見た目は main と完全に一致する。
 */
export type ThemePreference = "system" | "light" | "dark";

/** 設定画面のセレクタが並べる順。UI と `isThemePreference` の両方がこの配列を正本にする */
export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"] as const;

/** AsyncStorage のキー。値の意味を変えるときは v2 へ上げる */
export const THEME_PREFERENCE_STORAGE_KEY = "theme_preference_v1";

export function isThemePreference(value: unknown): value is ThemePreference {
	return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/**
 * 設定値と OS のスキームから、実際に描画へ使うスキームを決める。
 *
 * OS 側が `null`（web の hydration 前や、スキームを報告しない環境）のときはライトへ倒す。
 * これは `hooks/useColorScheme.web.ts` が hydration 前に `"light"` を返すのと同じ考え方で、
 * 「分からないときは main と同じ見た目」に揃えるための既定である。
 */
export function resolveScheme(preference: ThemePreference, systemScheme: ColorScheme | null | undefined): ColorScheme {
	if (preference === "light" || preference === "dark") return preference;
	return systemScheme === "dark" ? "dark" : "light";
}

export interface ThemeContextValue {
	/** 設定画面で選ばれている値（"system" を含む） */
	preference: ThemePreference;
	/** 解決済みスキーム。描画はこちらを見る */
	scheme: ColorScheme;
	/** `scheme` に対応するパレット */
	colors: Palette;
	/** 設定を変更して永続化する */
	setPreference: (preference: ThemePreference) => void;
	/** AsyncStorage からの読み出しが完了したか（起動直後の判定用） */
	isPreferenceLoaded: boolean;
}

const DEFAULT_CONTEXT: ThemeContextValue = {
	preference: "system",
	scheme: "light",
	colors: getPalette("light"),
	setPreference: () => {},
	isPreferenceLoaded: false,
};

const ThemeContext = createContext<ThemeContextValue>(DEFAULT_CONTEXT);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const systemScheme = useColorScheme();
	const [preference, setPreferenceState] = useState<ThemePreference>("system");
	const [isPreferenceLoaded, setIsPreferenceLoaded] = useState(false);

	useEffect(() => {
		let cancelled = false;
		AsyncStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)
			.then((stored) => {
				if (cancelled) return;
				// 未知の値・壊れた値は "system" のまま（= 既定）にする
				if (isThemePreference(stored)) setPreferenceState(stored);
			})
			.catch((error) => {
				console.error("Failed to load theme preference:", error);
			})
			.finally(() => {
				if (!cancelled) setIsPreferenceLoaded(true);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const setPreference = useCallback((next: ThemePreference) => {
		// 保存の完了を待たずに即座に反映する（切替の体感を落とさない）。
		// 保存に失敗しても画面は切り替わり、次回起動時に前の値へ戻るだけで済む。
		setPreferenceState(next);
		AsyncStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, next).catch((error) => {
			console.error("Failed to save theme preference:", error);
		});
	}, []);

	const scheme = resolveScheme(preference, systemScheme as ColorScheme | null | undefined);

	const value = useMemo<ThemeContextValue>(
		() => ({
			preference,
			scheme,
			colors: getPalette(scheme),
			setPreference,
			isPreferenceLoaded,
		}),
		[preference, scheme, setPreference, isPreferenceLoaded],
	);

	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** テーマの設定値・解決結果・パレットを読む。Provider の外ではライト固定の既定値を返す */
export function useAppTheme(): ThemeContextValue {
	return useContext(ThemeContext);
}

/**
 * テーマ依存のスタイルを組む。
 *
 * `StyleSheet.create` はモジュール評価時に 1 度だけ走るためテーマを追従できない。
 * **ファクトリはモジュールスコープに置く**こと（コンポーネント内で無名関数を渡すと
 * 毎レンダーで参照が変わり `useMemo` が効かない）。
 *
 * ```ts
 * const createStyles = (c: Palette) => StyleSheet.create({ root: { backgroundColor: c.background } });
 * // コンポーネント内
 * const styles = useThemedStyles(createStyles);
 * ```
 */
export function useThemedStyles<T>(factory: (colors: Palette) => T): T {
	const { colors } = useAppTheme();
	return useMemo(() => factory(colors), [factory, colors]);
}
