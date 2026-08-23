import React, { useCallback } from "react";
import { View, Text, Switch, TouchableOpacity, StyleSheet, StyleProp, TextStyle } from "react-native";

interface SettingsToggleItemProps {
	label: string;
	value: boolean;
	onValueChange: (next: boolean) => void;
	isLast?: boolean;
	textStyle?: StyleProp<TextStyle>;
	/** E2E テスト用: Web では data-testid として出力される。Switch 本体には `${testID}-switch` を付与する */
	testID?: string;
}

/**
 * #1504 【設計】設定のトグル行。`app/[locale]/(tabs)/profile/index.tsx` の
 * `ProfileMenuItem`(遷移用の行) と見た目・アクセシビリティ・区切り線の作法を揃えた、
 * オン/オフ設定用の再利用部品。現在の唯一の置き場は端末設定画面
 * (`app/[locale]/(tabs)/profile/device-settings.tsx`)で、SET-02(通知) / SET-05(ダークモード) /
 * SET-06(言語切替) も同じ画面にこのコンポーネントで並ぶ想定のため、
 * `features/settings` 配下の独立コンポーネントとして置く。
 *
 * 行全体をタップ対象にし、Switch 自体は `pointerEvents="none"` でタッチを親へ透過させる。
 * こうすることで「ラベルをタップしても切り替わる」という一般的な設定画面の挙動になる。
 */
export function SettingsToggleItem({
	label,
	value,
	onValueChange,
	isLast,
	textStyle,
	testID,
}: SettingsToggleItemProps) {
	const handlePress = useCallback(() => {
		onValueChange(!value);
	}, [onValueChange, value]);

	return (
		<>
			<TouchableOpacity
				style={styles.menuItem}
				onPress={handlePress}
				testID={testID}
				accessibilityRole="switch"
				accessibilityLabel={label}
				accessibilityState={{ checked: value }}>
				<Text style={[styles.menuItemText, textStyle]}>{label}</Text>
				<View pointerEvents="none">
					<Switch value={value} onValueChange={onValueChange} testID={testID ? `${testID}-switch` : undefined} />
				</View>
			</TouchableOpacity>
			{!isLast && <View style={styles.separator} />}
		</>
	);
}

const styles = StyleSheet.create({
	menuItem: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 16,
		paddingVertical: 16,
	},
	menuItemText: {
		fontSize: 16,
		color: "#1A1A1A",
		fontWeight: "500",
	},
	separator: {
		height: 1,
		backgroundColor: "#F3F4F6",
		marginHorizontal: 16,
	},
});
