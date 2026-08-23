import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { Image } from "expo-image";
import { Search, X } from "lucide-react-native";
import type { Region } from "@/components/MapView";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { useHaptics } from "@/hooks/useHaptics";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { getCacheKeyForImage } from "@/lib/image";
import i18n from "@/lib/i18n";
import type { QueryRestaurantsDto } from "@shared/api/v1/dto";
import type { QueryRestaurantsResponse } from "@shared/api/v1/res";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

type RestaurantSearchResult = QueryRestaurantsResponse[number];

type SearchStatus = "idle" | "debouncing" | "searching" | "success" | "empty" | "error";

const DEBOUNCE_DELAY_MS = 300;
const RESULT_LIMIT = 20;

export type RestaurantNameSearchProps = {
	/**
	 * #1398 (PR6) 現在の地図表示領域。`select-restaurant.tsx` は `currentRegion` を
	 * useRef で持つ既存の形（本家）を壊さないため、ref をそのまま受け取り
	 * 検索実行時（デバウンス確定時）に `.current` を読む。呼び出し毎の再生成は起きない。
	 */
	regionRef: React.RefObject<Region>;
	/** 検索結果の1件が押されたときのハンドラ（店舗詳細への遷移は呼び出し元が担う） */
	onSelectRestaurant: (result: RestaurantSearchResult) => void;
	/**
	 * #1375 実機確認: 0 件だったときの逃げ道。文言（`nameSearch.noResults`）は
	 * 「地図の店舗をタップしてお店を登録してください」と言っているのに、呼び出し元によっては
	 * **その地図がどこにも無かった**。案内だけ置いて導線が無い状態を作らないよう、
	 * 0 件・失敗のときに押せるボタンをここへ差せるようにする。
	 */
	emptyAction?: { label: string; onPress: () => void; testID?: string };
	testID?: string;
};

/**
 * #1398 (PR6) 店名検索（自前 `restaurants` テーブルのみ。Google Places Text Search /
 * Autocomplete は呼ばない）。`GET /v1/restaurants/search?q=&lat&lng&radius` は #1416 で
 * 新設済みのため、ここでは既存 endpoint を叩くだけ。
 *
 * `LocationAutocomplete`（場所検索）とは別の入力欄として独立させている。混同・置き換えはしない。
 */
export function RestaurantNameSearch({
	regionRef,
	onSelectRestaurant,
	emptyAction,
	testID = "restaurant-name-search",
}: RestaurantNameSearchProps) {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<RestaurantSearchResult[]>([]);
	const [status, setStatus] = useState<SearchStatus>("idle");
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();

	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// #1398 デバウンス+ネットワーク遅延で古い入力の応答が後から届くレースを弾くための単調増加ID
	const latestRequestIdRef = useRef(0);

	const runSearch = useCallback(
		async (q: string) => {
			const requestId = ++latestRequestIdRef.current;
			setStatus("searching");

			const region = regionRef.current;
			try {
				const response = await callBackend<QueryRestaurantsDto, QueryRestaurantsResponse>("v1/restaurants/search", {
					method: "GET",
					requestPayload: {
						q,
						lat: region.latitude,
						lng: region.longitude,
						// #644 の searchSavedRestaurants / map.tsx の searchNearbyRestaurants と同じ近似式
						radius: Math.max(region.latitudeDelta, region.longitudeDelta) * 50000,
						limit: RESULT_LIMIT,
					},
				});

				if (latestRequestIdRef.current !== requestId) return;
				setResults(response);
				setStatus(response.length > 0 ? "success" : "empty");
			} catch (error) {
				if (latestRequestIdRef.current !== requestId) return;
				setResults([]);
				setStatus("error");
				logFrontendEvent({
					event_name: "restaurant_name_search_failed",
					error_level: "error",
					payload: { q, error },
				});
			}
		},
		[callBackend, logFrontendEvent, regionRef],
	);

	const handleChangeText = useCallback(
		(text: string) => {
			setQuery(text);

			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
				debounceRef.current = null;
			}

			const trimmed = text.trim();
			if (trimmed.length === 0) {
				// 入力が空になった時点で直前の in-flight 応答も無効化する
				latestRequestIdRef.current += 1;
				setResults([]);
				setStatus("idle");
				return;
			}

			setStatus("debouncing");
			// ⚠️ 入力のたびに叩かない。確定は「入力が DEBOUNCE_DELAY_MS 止まったとき」のみ
			debounceRef.current = setTimeout(() => {
				debounceRef.current = null;
				void runSearch(trimmed);
			}, DEBOUNCE_DELAY_MS);
		},
		[runSearch],
	);

	const handleClear = useCallback(() => {
		lightImpact();
		if (debounceRef.current) {
			clearTimeout(debounceRef.current);
			debounceRef.current = null;
		}
		latestRequestIdRef.current += 1;
		setQuery("");
		setResults([]);
		setStatus("idle");
	}, [lightImpact]);

	const handleResultPress = useCallback(
		(result: RestaurantSearchResult) => {
			lightImpact();
			onSelectRestaurant(result);
			// 選択後は検索状態を畳んで地図・シートの通常操作へ戻す
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
				debounceRef.current = null;
			}
			latestRequestIdRef.current += 1;
			setQuery("");
			setResults([]);
			setStatus("idle");
		},
		[lightImpact, onSelectRestaurant],
	);

	useEffect(() => {
		return () => {
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}
		};
	}, []);

	const showResultsPanel = status !== "idle";

	return (
		<View style={styles.container}>
			<View style={styles.inputContainer}>
				<Search size={18} color={colors.textSecondary} style={styles.searchIcon} />
				<TextInput
					style={styles.input}
					value={query}
					onChangeText={handleChangeText}
					placeholder={i18n.t("SelectRestaurant.nameSearch.placeholder")}
					placeholderTextColor={colors.textSecondary}
					autoComplete="off"
					autoCorrect={false}
					returnKeyType="search"
					accessibilityLabel={i18n.t("SelectRestaurant.nameSearch.placeholder")}
					testID={`${testID}-input`}
				/>
				{query.length > 0 && (
					<TouchableOpacity
						style={styles.clearButton}
						onPress={handleClear}
						hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("SelectRestaurant.accessibility.clearNameSearch")}
						testID={`${testID}-clear`}>
						<X size={16} color={colors.textSecondary} />
					</TouchableOpacity>
				)}
			</View>

			{showResultsPanel && (
				<View style={styles.resultsPanel}>
					{(status === "debouncing" || status === "searching") && (
						<View style={styles.centerRow}>
							<LoadingIndicator size="small" />
							<Text style={styles.loadingText}>{i18n.t("SelectRestaurant.nameSearch.searching")}</Text>
						</View>
					)}

					{status === "success" && (
						<ScrollView
							keyboardShouldPersistTaps="handled"
							showsVerticalScrollIndicator={false}
							style={styles.resultsList}
							testID={`${testID}-results`}>
							{results.map((result, index) => (
								<TouchableOpacity
									key={result.restaurant.id}
									style={[styles.resultItem, index === results.length - 1 && styles.lastResultItem]}
									onPress={() => handleResultPress(result)}
									accessibilityRole="button"
									accessibilityLabel={result.restaurant.name}
									testID={`${testID}-result-${index}`}>
									<Image
										source={{
											uri: result.restaurant.imageUrls?.sm,
											cacheKey: getCacheKeyForImage(result.restaurant.imageUrls?.sm),
										}}
										style={styles.resultImage}
									/>
									<Text style={styles.resultName} numberOfLines={1} ellipsizeMode="tail">
										{result.restaurant.name}
									</Text>
								</TouchableOpacity>
							))}
						</ScrollView>
					)}

					{status === "empty" && (
						<View style={styles.centerColumn}>
							<Text style={styles.emptyText}>{i18n.t("SelectRestaurant.nameSearch.noResults")}</Text>
							{emptyAction ? (
								<TouchableOpacity
									onPress={emptyAction.onPress}
									accessibilityRole="button"
									style={styles.emptyActionButton}
									testID={emptyAction.testID ?? `${testID}-empty-action`}>
									<Text style={styles.emptyActionLabel}>{emptyAction.label}</Text>
								</TouchableOpacity>
							) : null}
						</View>
					)}

					{status === "error" && (
						<View style={styles.centerColumn}>
							<Text style={styles.emptyText}>{i18n.t("SelectRestaurant.nameSearch.error")}</Text>
							{emptyAction ? (
								<TouchableOpacity
									onPress={emptyAction.onPress}
									accessibilityRole="button"
									style={styles.emptyActionButton}
									testID={`${emptyAction.testID ?? `${testID}-empty-action`}-error`}>
									<Text style={styles.emptyActionLabel}>{emptyAction.label}</Text>
								</TouchableOpacity>
							) : null}
						</View>
					)}
				</View>
			)}
		</View>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
	container: { flex: 1 },
	inputContainer: {
		flexDirection: "row",
		alignItems: "center",
		borderRadius: 16,
		backgroundColor: c.surface,
		borderWidth: 1,
		borderColor: c.border,
	},
	searchIcon: {
		marginLeft: 16,
	},
	input: {
		flex: 1,
		paddingHorizontal: 12,
		paddingVertical: 16,
		fontSize: 16,
		color: c.textPrimary,
	},
	clearButton: {
		padding: 12,
		marginRight: 4,
	},
	resultsPanel: {
		marginTop: 12,
		backgroundColor: c.surface,
		borderRadius: 16,
		shadowColor: FixedColors.shadow,
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.1,
		shadowRadius: 24,
		elevation: 4,
	},
	resultsList: {
		maxHeight: 280,
	},
	resultItem: {
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 16,
		paddingVertical: 12,
		borderBottomWidth: 0.5,
		borderBottomColor: c.divider,
	},
	lastResultItem: {
		borderBottomWidth: 0,
	},
	resultImage: {
		width: 40,
		height: 40,
		borderRadius: 8,
		marginRight: 12,
		backgroundColor: c.surfaceSubtle,
	},
	resultName: {
		flex: 1,
		fontSize: 16,
		color: c.textPrimary,
		fontWeight: "600",
	},
	// 0 件・失敗のときは «説明 + 逃げ道のボタン» を縦に積むので、行ではなく列にする
	centerColumn: {
		alignItems: "center",
		justifyContent: "center",
		gap: 12,
		paddingVertical: 20,
		paddingHorizontal: 16,
	},
	emptyActionButton: {
		paddingHorizontal: 16,
		paddingVertical: 10,
		borderRadius: 16,
		backgroundColor: c.brandTintAlt,
	},
	emptyActionLabel: {
		fontSize: 13,
		fontWeight: "700",
		color: c.brand,
	},
	centerRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: 20,
		paddingHorizontal: 16,
	},
	loadingText: {
		marginLeft: 8,
		fontSize: 14,
		color: c.textSecondary,
	},
	emptyText: {
		fontSize: 14,
		color: c.textSecondary,
		textAlign: "center",
	},
});
