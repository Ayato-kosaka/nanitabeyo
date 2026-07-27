import React from "react";
import { TouchableOpacity, Text, StyleSheet } from "react-native";
import { Check } from "lucide-react-native";

interface SelectableChipProps {
	/** 表示ラベル(i18n 済み文字列) */
	label: string;
	/** ラベル前に表示する絵文字(任意) */
	icon?: string;
	/** 選択中かどうか */
	selected: boolean;
	/** 押下時のハンドラ */
	onPress: () => void;
	/** 単一選択なら "radio"、複数選択なら "checkbox" */
	role: "radio" | "checkbox";
	/** E2E テスト用: Web では data-testid として出力される */
	testID?: string;
}

// #934 【設計】食事時間・系統・価格帯など「チップの単一/複数選択」で共通利用するコンポーネント。
// role で radio(単一選択)/checkbox(複数選択)を切り替え、選択状態は枠線色だけでなく
// チェックマークでも表現する(色のみに依存しない)。
// [注意] react-native-web は accessibilityState.checked を DOM の aria-checked へ変換しない
// (#930 の PrimaryButton disabled と同種の既知の非対応)。native/web 両対応の aria-checked を
// 直接指定することで、RN(iOS/Android) と RNW(Web) の両方で同じ挙動にする。
export function SelectableChip({ label, icon, selected, onPress, role, testID }: SelectableChipProps) {
	return (
		<TouchableOpacity
			testID={testID}
			style={[styles.chip, selected && styles.selectedChip]}
			onPress={onPress}
			accessibilityRole={role}
			aria-checked={selected}
			accessibilityLabel={label}>
			{selected && <Check size={12} color="#000000" strokeWidth={3} style={styles.checkIcon} />}
			{icon && <Text style={styles.emoji}>{icon}</Text>}
			<Text style={[styles.text, selected && styles.selectedText]}>{label}</Text>
		</TouchableOpacity>
	);
}

const styles = StyleSheet.create({
	chip: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#F8F9FA",
		paddingHorizontal: 12,
		paddingVertical: 6,
		borderRadius: 24,
		borderWidth: 2,
		borderColor: "#C9C9C9",
		marginBottom: 6,
	},
	selectedChip: {
		backgroundColor: "#E5E5E5",
		borderColor: "#000000",
	},
	checkIcon: {
		marginRight: 4,
	},
	emoji: {
		fontSize: 14,
		marginRight: 4,
	},
	text: {
		fontSize: 13,
		color: "#000000",
		fontWeight: "600",
	},
	selectedText: {
		fontWeight: "800",
	},
});
