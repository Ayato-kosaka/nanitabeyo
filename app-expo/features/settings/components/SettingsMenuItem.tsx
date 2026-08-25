import React from "react";
import { StyleSheet, StyleProp, Text, TextStyle, TouchableOpacity, View } from "react-native";
import { ChevronRight } from "lucide-react-native";

import type { Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

/**
 * 設定系の画面で使う「押すと次へ行く」行。
 *
 * #1583 で設定を «設定 / 端末設定 / なに食べよについて» の 3 画面へ割ったため、
 * `profile/settings.tsx` の中に閉じていたものをここへ出した。3 画面で同じ行の
 * 見た目・余白・区切り線・読み上げ規約を共有するのが目的で、見た目は変えていない。
 */
export interface SettingsMenuItemProps {
	label: string;
	onPress: () => void;
	isLast?: boolean;
	textStyle?: StyleProp<TextStyle>;
	/** E2E テスト用: Web では data-testid として出力される */
	testID?: string;
	/**
	 * #950 【仕様】画面遷移(router.push)は "link"、モーダル起動・破壊的操作等は "button" として
	 * 支援技術に役割を伝える。Web では role="link"/"button" に対応する。
	 */
	accessibilityRole?: "link" | "button";
}

export function SettingsMenuItem({
	label,
	onPress,
	isLast,
	textStyle,
	testID,
	accessibilityRole = "button",
}: SettingsMenuItemProps) {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	return (
		<>
			<TouchableOpacity
				style={styles.menuItem}
				onPress={onPress}
				testID={testID}
				accessibilityRole={accessibilityRole}
				accessibilityLabel={label}>
				<Text style={[styles.menuItemText, textStyle]}>{label}</Text>
				{/* #950 【仕様】装飾アイコンのため読み上げ対象から除外し、行のラベルと二重に読み上げさせない */}
				<ChevronRight
					size={20}
					color={colors.textTertiary}
					accessibilityElementsHidden
					importantForAccessibility="no"
				/>
			</TouchableOpacity>
			{!isLast && <View style={styles.separator} />}
		</>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		menuItem: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			paddingHorizontal: 16,
			paddingVertical: 16,
		},
		menuItemText: {
			fontSize: 16,
			color: c.textPrimary,
			fontWeight: "500",
		},
		separator: {
			height: 1,
			backgroundColor: c.divider,
			marginHorizontal: 16,
		},
	});
