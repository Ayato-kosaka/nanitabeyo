import React from "react";
import type { ReactNode } from "react";
import { View, Text, TouchableOpacity, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import i18n from "@/lib/i18n";

// #949 【設計】SearchHeader / ReviewHeader は実装が完全に重複していたため本コンポーネントへ統合。
// 「戻る」導線を持つ画面（検索・口コミ・設定・ブロック一覧など）はこれ経由で統一する。
export type ScreenHeaderProps = {
	/** 表示するタイトル（i18n 済み文字列） */
	title: string;
	/** 戻るボタン押下時のハンドラ（画面側で router.back() や haptics を制御） */
	onPressBack: () => void;
	/** 右側に任意のコンテンツ（例: スキップボタン、閉じるアイコン）を挿入したい場合 */
	rightContent?: ReactNode;
	/** ヘッダー全体の追加スタイル（absolute で重ねたい画面などで使用） */
	containerStyle?: StyleProp<ViewStyle>;
	/** タイトルの追加スタイル（必要であれば） */
	titleStyle?: StyleProp<TextStyle>;
};

export function ScreenHeader({ title, onPressBack, rightContent, containerStyle, titleStyle }: ScreenHeaderProps) {
	const insets = useSafeAreaInsets();
	return (
		<View style={[{ paddingTop: insets.top + 8 }, styles.container, containerStyle]}>
			<TouchableOpacity
				style={styles.backButton}
				onPress={onPressBack}
				accessibilityRole="button"
				accessibilityLabel={i18n.t("Common.back")}
				hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
				testID="screen-header-back">
				<ChevronLeft size={24} color="#1A1A1A" />
			</TouchableOpacity>

			<Text style={[styles.title, titleStyle]} numberOfLines={1} ellipsizeMode="tail">
				{title}
			</Text>

			<View style={styles.rightContainer}>{rightContent ?? <View style={styles.rightSpacer} />}</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		backgroundColor: "#FFFFFF",
		paddingBottom: 8,
		paddingHorizontal: 16,
		borderBottomWidth: 1,
		borderBottomColor: "#C9C9C9",
		zIndex: 100,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	backButton: {
		padding: 4,
		marginRight: 8,
	},
	title: {
		fontSize: 18,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
		flex: 1,
	},
	rightContainer: {
		minWidth: 32,
		alignItems: "flex-end",
		justifyContent: "center",
	},
	rightSpacer: {
		width: 32,
	},
});
