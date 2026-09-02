import React from "react";
import { TouchableOpacity, Text, StyleSheet, View } from "react-native";
import { Check } from "lucide-react-native";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";

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
	const styles = useThemedStyles(createStyles);
	return (
		<TouchableOpacity
			testID={testID}
			style={[styles.chip, selected && styles.selectedChip]}
			onPress={onPress}
			accessibilityRole={role}
			aria-checked={selected}
			accessibilityLabel={label}>
			{icon && <Text style={styles.emoji}>{icon}</Text>}
			<Text style={[styles.text, selected && styles.selectedText]}>{label}</Text>
			{/* #934 【修正】チェックをラベルと同じ行に入れるとチップの横幅が変わり選択のたびに
			    レイアウトが動くため(レビュー指摘)、SelectableGridItem(時間帯グリッド)と同じ
			    右上の絶対配置バッジに変更して幅を不変にする */}
			{selected && (
				<View style={styles.checkBadge}>
					{/* #1509 バッジは «黒地・白縁・白チェック» で 1 セット。テーマ非追従にして暗面でも同じ形で読める */}
					<Check size={10} color={FixedColors.checkMark} strokeWidth={3} />
				</View>
			)}
		</TouchableOpacity>
	);
}

// #1509 【設計】テーマ依存のスタイルはファクトリで組む（`contexts/ThemeProvider.tsx` の useThemedStyles）。
// 値はすべて main のリテラルをそのまま `constants/Palette.ts` の light へ写したもので、ライトの見た目は変わらない。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		chip: {
			flexDirection: "row",
			alignItems: "center",
			backgroundColor: c.surfaceMuted,
			paddingHorizontal: 12,
			paddingVertical: 6,
			borderRadius: 24,
			borderWidth: 2,
			borderColor: c.border,
			marginBottom: 6,
			// #934 【設計】右上バッジをチップの角に少しはみ出して重ねるため
			position: "relative",
			overflow: "visible",
		},
		selectedChip: {
			backgroundColor: c.surfaceSelected,
			borderColor: c.borderContrast,
		},
		// #934 【設計】SelectableGridItem の checkBadge と同じ見た目(黒地・白縁・白チェック)
		checkBadge: {
			position: "absolute",
			top: -6,
			right: -6,
			width: 16,
			height: 16,
			borderRadius: 8,
			backgroundColor: FixedColors.badgeBackground,
			alignItems: "center",
			justifyContent: "center",
			borderWidth: 1.5,
			borderColor: FixedColors.badgeBorder,
		},
		emoji: {
			fontSize: 14,
			marginRight: 4,
		},
		text: {
			fontSize: 13,
			color: c.textStrong,
			fontWeight: "600",
		},
		selectedText: {
			fontWeight: "800",
		},
	});
