import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Navigation } from "lucide-react-native";
import { Card } from "@/components/Card";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import i18n from "@/lib/i18n";
import { useLocationField, type SelectedLocation } from "@/features/search/hooks/useLocationField";
import { type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

interface LocationSearchFormProps {
	/** Initial location text value */
	initialLocationText?: string;
	/**
	 * #1133 【設計】確定した地点を親へ渡す。
	 * 現在地・最近使った場所は `place_id` を持たず緯度経度が確定済み、サジェストはその逆なので、
	 * 判別可能 union で渡して親に分岐を強制する。`AutocompleteLocation` のままだと前者が乗らない。
	 */
	onSubmit: (selected: SelectedLocation) => void;
	/**
	 * Called when user cancels.
	 * ⚠️ 現状この JSX にキャンセル操作の要素が無く、呼ばれることはない。#1369 でモーダルを
	 * やめた後は、キャンセル（＝離脱）の導線も画面側の ScreenHeader が持つ。
	 * 導入時からの未参照 props で、削除の可否は判断待ちのため optional に留める。
	 */
	onCancel?: () => void;
	/** Placeholder text for the location input */
	placeholder?: string;
	/**
	 * フォーム上部の見出し。
	 *
	 * #1369 `null` を渡すと描画しない。ルート化した保存料理カテゴリの地点検索
	 * （app/[locale]/(tabs)/profile/saved-dish-category-location.tsx）は同じ文言を ScreenHeader が
	 * 持つため、二重に出さないための逃げ道。既定（未指定）は従来どおり見出しを描く。
	 */
	title?: string | null;
	/** Test ID for the autocomplete input */
	testID?: string;
}

/**
 * Location search form component that manages its own internal state to prevent
 * Japanese IME composition issues. Only communicates final values back to parent.
 *
 * #1133 【設計】入力欄の振る舞い（現在地取得・最近使った場所・クリア）は `useLocationField` が持つ。
 * ホーム（検索タブ）と同じ体験にするため、`LocationAutocomplete` へ渡す props も
 * `app/[locale]/(tabs)/search/index.tsx` と同じ形に揃えてある。差分があれば片方だけの不具合になる。
 */
export function LocationSearchForm({
	initialLocationText = "",
	onSubmit,
	placeholder = i18n.t("Search.placeholders.enterLocation"),
	title = i18n.t("Search.locationModal.title"),
	testID,
}: LocationSearchFormProps) {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const {
		locationQuery,
		setLocationQuery,
		inputRef,
		recentLocations,
		clearRecentLocations,
		handleSelectSuggestion,
		handleSelectRecentLocation,
		handleUseCurrentLocation,
		handleClear,
	} = useLocationField({ screen: "profile_saved_topics", onSelected: onSubmit });

	// 初期値の反映はマウント時の 1 回だけ。以降は利用者の入力が正なので上書きしない
	// （`initialLocationText` が変わるたび入力を奪うと IME 入力中に文字が消える）
	const didSeedInitialText = useRef(false);
	useEffect(() => {
		if (didSeedInitialText.current) return;
		didSeedInitialText.current = true;
		if (initialLocationText) setLocationQuery(initialLocationText);
	}, [initialLocationText, setLocationQuery]);

	return (
		<Card>
			{title ? <Text style={styles.modalTitle}>{title}</Text> : null}
			<View style={styles.locationSection}>
				<LocationAutocomplete
					ref={inputRef}
					value={locationQuery}
					onChangeText={setLocationQuery}
					onSelectSuggestion={handleSelectSuggestion}
					onClear={handleClear}
					placeholder={placeholder}
					// #1133 ホームと同じく、「現在地」表示のまま再フォーカスしたら手入力に切り替えられるようにする
					autoClearOnFocus={locationQuery === i18n.t("Search.currentLocation")}
					recentLocations={recentLocations}
					onSelectRecentLocation={handleSelectRecentLocation}
					onClearRecentLocations={recentLocations.length > 0 ? clearRecentLocations : undefined}
					renderInputRight={
						<TouchableOpacity
							style={styles.currentLocationButton}
							onPress={handleUseCurrentLocation}
							hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
							accessibilityRole="button"
							accessibilityLabel={i18n.t("Search.accessibility.useCurrentLocation")}
							testID="saved-dishCategory-current-location-button">
							<Navigation size={20} color={colors.textStrong} />
						</TouchableOpacity>
					}
					autofocus={true}
					testID={testID}
				/>
			</View>
		</Card>
	);
}

// #1509 【設計】`StyleSheet.create` はモジュール評価時に 1 度だけ走るためテーマを追従できない。
// パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		modalTitle: {
			fontSize: 18,
			fontWeight: "700",
			color: c.textPrimary,
			marginBottom: 16,
			textAlign: "center",
			letterSpacing: -0.3,
		},
		locationSection: {
			flexDirection: "row",
			alignItems: "flex-start",
			gap: 12,
		},
		// #1133 ホーム(`search/index.tsx` の currentLocationButton)と同一の見た目にする
		currentLocationButton: {
			padding: 16,
			borderLeftWidth: 0.5,
			borderLeftColor: c.border,
		},
	});
