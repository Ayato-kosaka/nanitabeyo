import React, { useCallback } from "react";
import { View, Text, Switch, TouchableOpacity, StyleSheet, StyleProp, TextStyle } from "react-native";

import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

interface SettingsToggleItemProps {
	label: string;
	value: boolean;
	onValueChange: (next: boolean) => void;
	isLast?: boolean;
	textStyle?: StyleProp<TextStyle>;
	/** E2E テスト用: Web では data-testid として出力される。Switch 本体には `${testID}-switch` を付与する */
	testID?: string;
	/**
	 * #1510 【設計】ラベルの下に置く補足文（任意）。
	 * 「いいね」だけでは何が届かなくなるのか分からない通知カテゴリのように、
	 * 一語のラベルで説明しきれない設定のために足した。
	 * 省略時のレイアウトは #1504 時点と 1px も変わらない（この View ごと描画しない）。
	 */
	description?: string;
	/**
	 * #1510 【設計】操作を受け付けない状態（読み込み中・保存中など）。
	 * OS 側の通知許可とは無関係であることに注意。
	 * 設定はアカウント単位で他の端末にも効くため、**OS が拒否中でも無効化しない**
	 *（リーダー判断 §4）。無効化ではなく画面上部の案内で状況を伝える。
	 */
	disabled?: boolean;
}

/**
 * #1504 【設計】設定画面のトグル行。かつての `profile/settings.tsx`（#1583 で削除）の
 * `SettingsMenuItem`(遷移用の行) と見た目・アクセシビリティ・区切り線の作法を揃えた、
 * オン/オフ設定用の再利用部品。SET-02(通知) / SET-05(ダークモード) / SET-06(言語切替) も
 * このコンポーネントを使う想定のため、`features/settings` 配下の独立コンポーネントとして置く。
 *
 * 行全体をタップ対象にし、Switch 自体は `pointerEvents="none"` でタッチを親へ透過させる。
 * こうすることで「ラベルをタップしても切り替わる」という一般的な設定画面の挙動になる。
 *
 * ⚠️ このファイルは PR #1515(#1504 SET-01) でも同じパスに追加される。
 * こちら(#1510)の版は `description` / `disabled` を **任意 prop として足しただけ**の上位互換で、
 * #1504 側の props・見た目・挙動は変えていない。衝突したらこちらを採用してよい。
 */
export function SettingsToggleItem({
	label,
	value,
	onValueChange,
	isLast,
	textStyle,
	testID,
	description,
	disabled,
}: SettingsToggleItemProps) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	const handlePress = useCallback(() => {
		onValueChange(!value);
	}, [onValueChange, value]);

	return (
		<>
			<TouchableOpacity
				style={styles.menuItem}
				onPress={handlePress}
				disabled={disabled}
				testID={testID}
				accessibilityRole="switch"
				accessibilityLabel={label}
				// #1510 補足文は支援技術にも読ませる。行のラベルとは別の情報なので hint に載せる
				accessibilityHint={description}
				accessibilityState={{ checked: value, disabled: !!disabled }}
				/*
				#1629 【修正】react-native-web は `accessibilityState.checked` を DOM の
				`aria-checked` へ変換しない（`SelectableChip` / `ThemeSelector` と同じ既知の非対応）。
				その結果 web では **`role="switch"` なのに `aria-checked` を持たない行**になり、
				スクリーンリーダーから «オンかオフか» が読めない。axe も
				`aria-required-attr`（critical）として検出する。
				repo の他の箇所と同じく、両対応の `aria-checked` を直接指定して埋める。
				*/
				aria-checked={value}>
				<View style={styles.labelColumn}>
					<Text style={[styles.menuItemText, textStyle]}>{label}</Text>
					{!!description && (
						// #1510 補足文は accessibilityHint で読み上げ済みなので、二重読み上げを避ける
						<Text style={styles.descriptionText} accessibilityElementsHidden importantForAccessibility="no">
							{description}
						</Text>
					)}
				</View>
				<View pointerEvents="none">
					{/*
					#1629 【設計】色を渡さない `Switch` は OS 既定色で描かれ、アプリのテーマに
					追従しない（ダークの面の上に OS ライトの淡いレールが残る）。
					オン = ブランド色 / オフ = `trackMuted` のレールに、つまみは常に白の
					1 組で渡す（つまみの白は iOS の既定と同じなので、ライトの見た目は変わらない）。
					`ios_backgroundColor` はオフのときレールの下に見える色で、これも合わせる。
					*/}
					<Switch
						value={value}
						onValueChange={onValueChange}
						disabled={disabled}
						trackColor={{ false: colors.trackMuted, true: colors.brand }}
						thumbColor={FixedColors.onFilled}
						ios_backgroundColor={colors.trackMuted}
						testID={testID ? `${testID}-switch` : undefined}
					/>
				</View>
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
		// #1510 補足文があるときにラベルが Switch へ回り込まないよう、ラベル側だけを伸縮させる
		labelColumn: {
			flex: 1,
			paddingRight: 12,
		},
		menuItemText: {
			fontSize: 16,
			color: colors.textPrimary,
			fontWeight: "500",
		},
		descriptionText: {
			marginTop: 2,
			fontSize: 13,
			color: colors.textSecondary,
			fontWeight: "400",
		},
		separator: {
			height: 1,
			backgroundColor: colors.divider,
			marginHorizontal: 16,
		},
	});
