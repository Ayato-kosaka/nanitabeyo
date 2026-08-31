import React from "react";
import type { ReactNode } from "react";
import { View, Text, TouchableOpacity, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import i18n from "@/lib/i18n";
import type { Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

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
	// #1031 【設計】画面ごとにタイトル表示を検証できるよう testID を付与できるようにする
	//（`${testID}-title` をタイトル Text、`${testID}-back` を戻るボタンに付与）
	testID?: string;
};

export function ScreenHeader({
	title,
	onPressBack,
	rightContent,
	containerStyle,
	titleStyle,
	testID,
}: ScreenHeaderProps) {
	const insets = useSafeAreaInsets();
	// #1509 【設計】ヘッダーは戻る導線を持つ全画面の下地なので、基盤と同じ PR でテーマ対応する
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	/**
	 * #1404 【バグ】戻るボタンの testID を画面ごとに分ける。
	 *
	 * 以前は全画面が固定の `screen-header-back` を持っていた。オーバーレイ時代は「背面の画面は
	 * 覆われている」前提で済んでいたが、#1350 でモーダルをルートへ移した結果、
	 * **push した画面と背面の画面が同時に DOM に居る**（Stack は下の画面を unmount しない）。
	 * その状態で `getByTestId("screen-header-back")` を引くと 2 件に当たり、
	 * Playwright は strict mode violation で落ちる（E2E Web run 32243079269 で 4 件が実際に落ちた）。
	 *
	 * `${testID}-title` と同じ規約に揃え、testID を渡している画面は自分専用の id を持つ。
	 * 渡していない画面は従来どおり `screen-header-back` のまま（後方互換）。
	 */
	const backTestID = testID ? `${testID}-back` : "screen-header-back";
	return (
		<View style={[{ paddingTop: insets.top + 8 }, styles.container, containerStyle]}>
			<TouchableOpacity
				style={styles.backButton}
				onPress={onPressBack}
				accessibilityRole="button"
				accessibilityLabel={i18n.t("Common.back")}
				hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
				testID={backTestID}>
				<ChevronLeft size={24} color={colors.textPrimary} />
			</TouchableOpacity>

			<Text
				testID={testID ? `${testID}-title` : undefined}
				style={[styles.title, titleStyle]}
				numberOfLines={1}
				ellipsizeMode="tail">
				{title}
			</Text>

			<View style={styles.rightContainer}>{rightContent ?? <View style={styles.rightSpacer} />}</View>
		</View>
	);
}

// #1509 【設計】`StyleSheet.create` はモジュール評価時に 1 度だけ走るためテーマを追従できない。
// パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
// ファクトリはモジュールスコープに置くこと（参照が毎レンダー変わると useMemo が効かない）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			backgroundColor: c.surface,
			paddingBottom: 8,
			paddingHorizontal: 16,
			borderBottomWidth: 1,
			borderBottomColor: c.border,
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
			color: c.textPrimary,
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
