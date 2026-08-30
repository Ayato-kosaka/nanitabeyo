import React from "react";
import { Pressable, View, Text, StyleSheet, type ImageSourcePropType } from "react-native";
import { Image } from "expo-image";
import { Check } from "lucide-react-native";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";

interface SelectableGridItemProps {
	/** 表示ラベル(i18n 済み文字列) */
	label: string;
	/** グリッド画像 */
	image: ImageSourcePropType;
	/** 選択中かどうか */
	selected: boolean;
	/** 押下時のハンドラ */
	onPress: () => void;
	/** 画像/アイテムの一辺のサイズ(呼び出し元の画面幅計算に合わせる) */
	itemWidth: number;
	/** E2E テスト用: Web では data-testid として出力される */
	testID?: string;
}

// #934 【設計】時間帯・同行者など「画像+ラベルの単一選択グリッド」で共通利用するアイテム。
// accessibilityRole="radio" + aria-checked でネイティブなセマンティクスを持たせ、
// 選択状態は枠線色だけでなくチェックマークバッジでも表現する(色のみに依存しない)。
// [注意] react-native-web は accessibilityState.checked を DOM の aria-checked へ変換しない
// (#930 の PrimaryButton disabled と同種の既知の非対応)。native/web 両対応の aria-checked を
// 直接指定することで、RN(iOS/Android) と RNW(Web) の両方で同じ挙動にする。
export function SelectableGridItem({ label, image, selected, onPress, itemWidth, testID }: SelectableGridItemProps) {
	const styles = useThemedStyles(createStyles);
	return (
		<Pressable
			testID={testID}
			style={[styles.item, { width: itemWidth + 2 * ITEM_PADDING + 2 * BORDER_WIDTH }, selected && styles.selectedItem]}
			onPress={onPress}
			accessibilityRole="radio"
			aria-checked={selected}
			accessibilityLabel={label}>
			<View style={styles.imageWrapper}>
				<Image
					source={image}
					style={[{ width: itemWidth, height: itemWidth }, styles.image]}
					contentFit="cover"
					transition={0}
					priority="high"
					cachePolicy="memory"
					// #934 【修正】画像はラベル(親のPressableのaccessibilityLabel)と重複する装飾のため
					// accessibilityLabel="" で読み上げ対象から除外する(axe: image-alt 違反の解消)。
					// expo-image の web 実装(ExpoImage.web.tsx)は img の alt 属性を
					// alt prop ではなく accessibilityLabel prop から生成するため注意
					accessibilityLabel=""
				/>
				{selected && (
					<View style={styles.checkBadge}>
						{/* #1509 バッジは «黒地・白縁・白チェック» で 1 セット。テーマ非追従（写真の上に載るため） */}
						<Check size={12} color={FixedColors.checkMark} strokeWidth={3} />
					</View>
				)}
			</View>
			<Text style={[styles.label, selected && styles.selectedLabel]}>{label}</Text>
		</Pressable>
	);
}

const ITEM_PADDING = 3;
const BORDER_WIDTH = 2;

// #1509 【設計】テーマ依存のスタイルはファクトリで組む（`contexts/ThemeProvider.tsx` の useThemedStyles）。
// 値はすべて main のリテラルをそのまま `constants/Palette.ts` の light へ写したもので、ライトの見た目は変わらない。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		item: {
			maxWidth: 256,
			alignItems: "center",
			overflow: "visible",
			padding: ITEM_PADDING,
			borderRadius: 16,
			borderWidth: BORDER_WIDTH,
			borderColor: "transparent",
		},
		selectedItem: {
			borderColor: c.borderContrast,
			backgroundColor: c.surfaceSelected,
		},
		imageWrapper: {
			position: "relative",
		},
		image: {
			borderRadius: 16,
			maxWidth: 256,
			maxHeight: 256,
		},
		checkBadge: {
			position: "absolute",
			top: -4,
			right: -4,
			width: 20,
			height: 20,
			borderRadius: 10,
			backgroundColor: FixedColors.badgeBackground,
			alignItems: "center",
			justifyContent: "center",
			borderWidth: 1.5,
			borderColor: FixedColors.badgeBorder,
		},
		label: {
			marginTop: 4,
			fontSize: 11,
			color: c.textStrong,
			fontWeight: "600",
			textAlign: "center",
		},
		selectedLabel: {
			fontWeight: "800",
		},
	});
