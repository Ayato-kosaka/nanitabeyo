import React, { useCallback, useEffect, useRef, useState } from "react";
import { radiusForRegion } from "@/features/restaurantPicker/mapPins";
import { asApiList } from "@/lib/apiList";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { Image } from "expo-image";
// #1375（6 巡目・オーナー指示）右のボタンは «地図から探す» なので、
// 1 地点を指す MapPin ではなく «折り畳んだ地図» の Map を使う（ピンだと «現在地» に見える）
import { Map as MapIcon, Search, X } from "lucide-react-native";
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
	/**
	 * #1375 実機確認（5 巡目）「決まったお店の名前が検索ボックスに入ってほしい」。
	 *
	 * 選び終えた店名。渡すと、入力していない間はこの名前が **入力欄の値**として出る
	 * （下に «選択中: ◯◯» の行を別で置かない ＝ 同じことを 2 箇所へ書かない）。
	 * X を押すと `onClearSelection` が呼ばれ、選び直しに戻る。
	 */
	selectedName?: string | null;
	onClearSelection?: () => void;
	/**
	 * #1375 実機確認（5 巡目）「検索ボックスの右に地図アイコン」。
	 * «地図から探す» を独立したボタンとして下へ置くと、幅が中途半端に余って
	 * 画面の中で浮く（実機指摘「幅が不揃い」）。入力欄の中の右端へ入れる。
	 */
	mapAction?: { onPress: () => void; testID?: string; accessibilityLabel?: string };
	/**
	 * #1375 読み取り結果などの «候補»。入力欄の **下に小さく** 並べる（実機指摘）。
	 * 呼び出し元がチップを自前で組むと画面ごとに寸法がずれるため、ここで描く。
	 */
	candidates?: { id: string; label: string; testID?: string }[];
	/** 選択済み候補の id（候補チップの強調に使う） */
	selectedCandidateId?: string | null;
	onSelectCandidate?: (id: string) => void;
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
	selectedName,
	onClearSelection,
	mapAction,
	candidates,
	selectedCandidateId,
	onSelectCandidate,
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
						/*
						  #1629 【修正】半径は «いま見えている範囲の外接円»（`radiusForRegion`）にする。
						  独自の近似式（delta * 50000）を持っていたため、上限も下限も無いまま
						  «画面より狭い円» を送っていた。店名検索の経路はサーバ側で距離順（KNN）に
						  なるので、半径が大きくても走る行数は limit 件で一定である。
						*/
						radius: radiusForRegion(region),
						limit: RESULT_LIMIT,
					},
				});

				if (latestRequestIdRef.current !== requestId) return;
				// #1375 API を信じない。**state へ入れる前に**配列へ落とす（#1561 と同型）
				const rows = asApiList(response);
				setResults(rows);
				setStatus(rows.length > 0 ? "success" : "empty");
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

	// 選び終えていて、かつ自分で打ち直していない間だけ «確定名» を出す。
	// 打ち始めたら（query が入ったら）検索の入力欄として振る舞う
	const showsSelectedName = !!selectedName && query.length === 0;

	const handleClearSelection = useCallback(() => {
		lightImpact();
		onClearSelection?.();
	}, [lightImpact, onClearSelection]);

	// 確定名が出ている間は結果パネルを出さない（選び終えた欄の下に候補一覧が残らないように）
	const showResultsPanel = status !== "idle" && !showsSelectedName;

	return (
		<View style={styles.container}>
			<View style={styles.inputContainer}>
				<Search size={18} color={colors.textSecondary} style={styles.searchIcon} />
				<TextInput
					style={[styles.input, showsSelectedName && styles.inputSelected]}
					value={showsSelectedName ? selectedName! : query}
					onChangeText={handleChangeText}
					placeholder={i18n.t("SelectRestaurant.nameSearch.placeholder")}
					placeholderTextColor={colors.textSecondary}
					autoComplete="off"
					autoCorrect={false}
					returnKeyType="search"
					accessibilityLabel={i18n.t("SelectRestaurant.nameSearch.placeholder")}
					testID={`${testID}-input`}
				/>
				{(query.length > 0 || showsSelectedName) && (
					<TouchableOpacity
						style={styles.clearButton}
						onPress={showsSelectedName ? handleClearSelection : handleClear}
						hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("SelectRestaurant.accessibility.clearNameSearch")}
						testID={`${testID}-clear`}>
						<X size={16} color={colors.textSecondary} />
					</TouchableOpacity>
				)}
				{mapAction && (
					<TouchableOpacity
						style={styles.mapButton}
						onPress={mapAction.onPress}
						hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
						accessibilityRole="button"
						accessibilityLabel={mapAction.accessibilityLabel ?? i18n.t("SelectRestaurant.pickOnMap")}
						testID={mapAction.testID ?? `${testID}-map`}>
						<MapIcon size={20} color={colors.textSecondaryStrong} />
					</TouchableOpacity>
				)}
			</View>

			{/* #1375 候補は入力欄の «下に小さく»。選び終えたら畳む（もう選ぶものが無いため） */}
			{!showsSelectedName && candidates && candidates.length > 0 && (
				<View style={styles.candidateRow}>
					{candidates.map((candidate) => (
						<TouchableOpacity
							key={candidate.id}
							testID={candidate.testID}
							onPress={() => {
								lightImpact();
								onSelectCandidate?.(candidate.id);
							}}
							accessibilityRole="button"
							accessibilityState={{ selected: selectedCandidateId === candidate.id }}
							style={[styles.candidateChip, selectedCandidateId === candidate.id && styles.candidateChipSelected]}>
							<Text
								style={[styles.candidateLabel, selectedCandidateId === candidate.id && styles.candidateLabelSelected]}>
								{candidate.label}
							</Text>
						</TouchableOpacity>
					))}
				</View>
			)}

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
		/*
		#1375（6 巡目・実機で 2 回指摘）**`flex: 1` を置かない。**

		以前はここが `flex: 1` だった。呼び出し元（「食べたを記録」タブ・SNS 取り込みタブ）は
		どちらも高さを決めない普通の縦並びの中にこの部品を置くので、ネイティブでは
		**この器の高さが 0 に潰れ、入力欄ごと見えなくなる**。

		⚠️ web（react-native-web）はこの状況で高さが潰れないため、**web のスクリーンショットでは
		正常に見える**。実機だけで再現する。この差のせいで «直した» と誤って報告した。
		結果パネルは自前の maxHeight を持っているので、器は中身なりの高さでよい。
		*/
		container: {},
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
			// #1375（6 巡目・オーナー指示）**アイコンを潰さない。**
			// 横並びの既定 flexShrink は 1 なので、店名が長いと «決まった値» のテキストに
			// 押されてこの虫眼鏡が数 px まで縮んでいた（スクショで確認）。
			// アイコンは縮まない側、伸縮するのは入力欄だけ、と決める
			flexShrink: 0,
		},
		input: {
			flex: 1,
			// web は flex アイテムの最小幅が «中身の幅» なので、長い店名だと縮まず
			// 隣のアイコンを押し出す。0 を明示して «縮むのはここ» を成立させる
			minWidth: 0,
			paddingHorizontal: 12,
			paddingVertical: 16,
			fontSize: 16,
			color: c.textPrimary,
		},
		clearButton: {
			padding: 12,
			flexShrink: 0,
		},
		// 確定した店名は «入力の続き» ではなく «決まった値» なので、少し強く見せる
		inputSelected: {
			fontWeight: "700",
		},
		// #1375 «地図から探す» は入力欄の中の右端。赤くしない（副次的な導線で、CTA ではない）
		mapButton: {
			flexShrink: 0,
			paddingHorizontal: 14,
			paddingVertical: 12,
			marginRight: 2,
			borderLeftWidth: StyleSheet.hairlineWidth,
			borderLeftColor: c.borderMuted,
		},
		candidateRow: {
			marginTop: 8,
			flexDirection: "row",
			flexWrap: "wrap",
			gap: 6,
		},
		// 候補は «小さく»（実機指摘）。本文のチップ（13pt）より一回り下げる
		candidateChip: {
			paddingHorizontal: 10,
			paddingVertical: 5,
			borderRadius: 14,
			backgroundColor: c.surfaceSubtle,
		},
		candidateChipSelected: {
			backgroundColor: c.brandTintAlt,
		},
		candidateLabel: {
			fontSize: 12,
			color: c.textSecondaryStrong,
		},
		candidateLabelSelected: {
			color: c.brand,
			fontWeight: "700",
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
