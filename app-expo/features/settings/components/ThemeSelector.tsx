import React, { useCallback } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Check, Moon, Smartphone, Sun } from "lucide-react-native";

import type { Palette } from "@/constants/Palette";
import { THEME_PREFERENCES, useAppTheme, useThemedStyles, type ThemePreference } from "@/contexts/ThemeProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";

const THEME_OPTION_ICONS = {
	system: Smartphone,
	light: Sun,
	dark: Moon,
} as const satisfies Record<ThemePreference, unknown>;

/**
 * #1509 SET-05 テーマ（表示モード）の 3 択セレクタ。
 *
 * #1583 で置き場所が «設定画面の最上段» から «端末設定» ページへ移った。
 * #1509 がこれを最上段へ置いた理由は «切替の効果がその場で見えるよう» であって
 * 初回起動での発見性ではない。移設先の `device-settings.tsx` もテーマ追従なので、
 * 切り替えた瞬間にその画面の色が変わるという性質はそのまま保たれている。
 *
 * 保存先の `theme_preference_v1` は端末に閉じており、サーバーへ同期しない。
 * «端末設定» の定義と一致するのが移設先の根拠である。
 */
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

const createStyles = (c: Palette) =>
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
			color: c.textPrimary,
			fontWeight: "500",
		},
		themeOptionTextSelected: {
			color: c.brand,
			fontWeight: "700",
		},
		separator: {
			height: 1,
			backgroundColor: c.divider,
			marginHorizontal: 16,
		},
	});
