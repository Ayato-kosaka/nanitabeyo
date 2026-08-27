import React from "react";
import { StyleSheet, StyleProp, Text, TextStyle, TouchableOpacity, View } from "react-native";
import { ChevronRight } from "lucide-react-native";

import type { Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

/*
#1583 «押すと次へ行く» 行。元は profile/index.tsx の中の ProfileMenuItem。
«なに食べよについて» ページ（about.tsx）を切り出したことで 2 画面から使うようになったため
ここへ出した。余白・区切り線・読み上げ規約（#950）を 2 画面で共有するのが目的で、
値は profile/index.tsx にあったものをそのまま写しただけ。見た目は 1px も変えていない。
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
				{/*
				  #950 【仕様】装飾アイコンのため読み上げ対象から除外し、行のラベルと二重に読み上げさせない。

				  #1629 【仕様】**その場で実行する行（`accessibilityRole="button"`）には «>» を出さない。**
				  «>» は「押すと次の画面へ行く」という約束の記号である。ログアウトやアカウント削除のような
				  «押すとその場で確認ダイアログが出る» 行に付けると、行き先があるように読める。
				*/}
				{accessibilityRole === "link" && (
					<ChevronRight
						size={20}
						color={colors.textTertiary}
						accessibilityElementsHidden
						importantForAccessibility="no"
					/>
				)}
			</TouchableOpacity>
			{!isLast && <View style={styles.separator} />}
		</>
	);
}

const createStyles = (colors: Palette) =>
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
			color: colors.textPrimary,
			fontWeight: "500",
		},
		separator: {
			height: 1,
			backgroundColor: colors.divider,
			marginHorizontal: 16,
		},
	});
