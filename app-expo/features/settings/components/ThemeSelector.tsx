import React, { useCallback } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Check, Moon, Smartphone, Sun } from "lucide-react-native";

import type { Palette } from "@/constants/Palette";
import { THEME_PREFERENCES, useAppTheme, useThemedStyles, type ThemePreference } from "@/contexts/ThemeProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";

/**
 * #1509 SET-05 テーマ（表示モード）の 3 択セレクタ。
 *
 * ## なぜラジオ相当の «行» にしたか
 * iOS / Android の設定アプリと同型にするため。切替は即時反映で、確定ボタンを持たない
 * （その場でアプリ全体の色が変わるので、結果がそのまま確認になる）。
 *
 * ## 置き場所の変遷
 * 元は独立した設定画面（profile/settings.tsx）にあり、#1402 でその画面が廃止されて
 * マイページ本体（profile/index.tsx）の最上段へ移った。
 *
 * #1583 でさらに «端末設定» ページ（#1504）の中へ移した。#1504 の設計コメントが
 * «今後 SET-02(通知) / SET-05(ダークモード) / SET-06(言語切替) と増える予定» として
 * 最初から居場所を用意していた場所である。オーナー指示（2026-08-25
 * 「ライトモードダークモードも、端末設定ページにグルーピングするべきなきもする」）。
 *
 * #1509 が最上段へ置いた理由は «切替の効果がその場で見えるよう» であって初回起動での
 * 発見性ではない。移設先の device-settings.tsx もテーマ追従なので、その性質は保たれる。
 * 保存先の `theme_preference_v1` は端末に閉じており、«端末設定» の定義とも一致する。
 *
 * testID（settings-theme-*）は E2E から名指しされているので据え置く。
 *
 * ## アクセシビリティ
 * `accessibilityRole="radio"` + `accessibilityState.selected` で選択状態を支援技術へ伝える。
 * チェックアイコンは視覚的な冗長表現なので読み上げからは外す。
 */
const THEME_OPTION_ICONS: Record<ThemePreference, typeof Smartphone> = {
	system: Smartphone,
	light: Sun,
	dark: Moon,
};

export function ThemeSelector() {
	const { preference, setPreference, colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

	const handleSelect = useCallback(
		(next: ThemePreference) => {
			lightImpact();
			logFrontendEvent({
				event_name: "settings_theme_preference_changed",
				error_level: "log",
				payload: { from: preference, to: next },
			});
			setPreference(next);
		},
		[lightImpact, logFrontendEvent, preference, setPreference],
	);

	return (
		<View testID="settings-theme-selector" accessibilityRole="radiogroup">
			{THEME_PREFERENCES.map((option, index) => {
				const Icon = THEME_OPTION_ICONS[option];
				const isSelected = preference === option;
				const isLast = index === THEME_PREFERENCES.length - 1;
				const label = i18n.t(`Settings.theme.options.${option}`);
				return (
					<React.Fragment key={option}>
						<TouchableOpacity
							style={styles.themeOption}
							onPress={() => handleSelect(option)}
							testID={`settings-theme-${option}`}
							accessibilityRole="radio"
							accessibilityState={{ selected: isSelected, checked: isSelected }}
							// #934 と同じ理由: react-native-web は accessibilityState.checked を DOM の
							// aria-checked へ変換しないため、native/web 両対応の aria-checked を直接指定する
							aria-checked={isSelected}
							accessibilityLabel={label}>
							<Icon
								size={20}
								color={isSelected ? colors.brand : colors.textSecondary}
								accessibilityElementsHidden
								importantForAccessibility="no"
							/>
							<Text style={[styles.themeOptionText, isSelected && styles.themeOptionTextSelected]}>{label}</Text>
							{isSelected && (
								// #1509 【E2E】チェックは lucide の SVG なので testID を直接載せると
								// Detox / react-native-web のどちらで拾えるかが実装依存になる。
								// 素の View で包んで testID を持たせ、両方から確実に見えるようにする
								<View testID={`settings-theme-${option}-check`}>
									<Check size={20} color={colors.brand} accessibilityElementsHidden importantForAccessibility="no" />
								</View>
							)}
						</TouchableOpacity>
						{!isLast && <View style={styles.separator} />}
					</React.Fragment>
				);
			})}
		</View>
	);
}

/*
#1583 スタイルはこのコンポーネントに閉じる。元は profile/index.tsx の createStyles から
借りていたが、#1504 の端末設定ページへ移したことで «借り先» が 2 つになった。
値は profile/index.tsx にあったものをそのまま写しただけで、見た目は変わっていない。
*/
const createStyles = (colors: Palette) =>
	StyleSheet.create({
		// #1509 テーマ 3 択の行。アイコン + ラベル + 選択チェックの 3 カラム
		themeOption: {
			flexDirection: "row",
			alignItems: "center",
			gap: 12,
			paddingHorizontal: 16,
			paddingVertical: 16,
		},
		themeOptionText: {
			flex: 1,
			fontSize: 16,
			color: colors.textPrimary,
			fontWeight: "500",
		},
		themeOptionTextSelected: {
			color: colors.brand,
			fontWeight: "700",
		},
		separator: {
			height: 1,
			backgroundColor: colors.divider,
			marginHorizontal: 16,
		},
	});
