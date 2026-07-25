import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Pressable } from "react-native";
import {
	MapPin,
	Search,
	SunMoon,
	Users,
	Navigation,
	Ruler,
	DollarSign,
	Plus,
	ChevronUp,
	ChefHat,
	HelpCircle,
	Timer,
} from "lucide-react-native";
import { router } from "expo-router";
import { SearchParams } from "@/types/search";
import type { AutocompleteLocation, LocationDetailsResponse } from "@shared/api/v1/res";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import {
	timeSlots,
	sceneOptions,
	foodStyleOptions,
	diningPaceOptions,
	distanceOptions,
	priceLevelOptions,
	TUTORIAL_PAGES,
	PRELOAD_IMAGES,
} from "@/features/search/constants";
import { DistanceSlider } from "@/features/search/components/DistanceSlider";
import { PriceLevelsMultiSelect } from "@/features/search/components/PriceLevelsMultiSelect";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { SafeAreaView } from "react-native-safe-area-context";
import { DEFAULT_SEARCH_RADIUS } from "@/features/topics/constants";
import { TutorialBottomSheet } from "@/features/search/components/TutorialBottomSheet";
import { useSearchTutorial } from "@/features/search/hooks/useSearchTutorial";
import { Image } from "expo-image";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useIsFocused } from "@react-navigation/native";

// #667 【設計】画面幅ベースでアイテムサイズを計算（4列グリッド）
const SCREEN_WIDTH = Dimensions.get("window").width;
const HORIZONTAL_PADDING = 16;
const ITEM_PADDING = 3;
const BORDER_WIDTH = 2;
const ITEM_GAP = 2;
const NUM_COLUMNS = 4;
const ITEM_WIDTH =
	(SCREEN_WIDTH -
		HORIZONTAL_PADDING * 2 -
		ITEM_GAP * (NUM_COLUMNS - 1) -
		(ITEM_PADDING * 2 + BORDER_WIDTH * 2) * NUM_COLUMNS) /
	NUM_COLUMNS;

export default function SearchScreen() {
	const { locale, isJapanese } = useLocale();
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const [location, setLocation] = useState<Omit<LocationDetailsResponse, "viewport"> | null>(null);
	const [locationQuery, setLocationQuery] = useState("");
	const [timeSlot, setTimeSlot] = useState<SearchParams["timeSlot"]>("lunch");
	const [scene, setScene] = useState<SearchParams["scene"]>("solo"); // #533 【仕様】scene 初期値を solo に変更（レコメンドAPI必須化対応）
	const [taste, setTaste] = useState<SearchParams["taste"] | undefined>(undefined);
	const [coreIngredient, setCoreIngredient] = useState<SearchParams["coreIngredient"] | undefined>(undefined);
	const [diningPace, setDiningPace] = useState<SearchParams["diningPace"] | undefined>(undefined);
	const isSearchingRef = useRef(false);
	const [distance, setDistance] = useState<number>(DEFAULT_SEARCH_RADIUS);
	const [priceLevels, setPriceLevels] = useState<(typeof priceLevelOptions)[number]["value"][]>([]);
	const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

	const { getCurrentLocation, getLocationDetails } = useLocationSearch();
	const { showSnackbar } = useSnackbar();

	useEffect(() => {
		// Screen view logging
		logFrontendEvent({
			event_name: "screen_view",
			error_level: "log",
			payload: { screen: "search" },
		});

		// 端末時間帯に基づき timeSlot を自動設定
		const hour = new Date().getHours();
		const TIME_SLOTS: { until: number; slot: SearchParams["timeSlot"] }[] = [
			{ until: 5, slot: "late_night" },
			{ until: 10, slot: "morning" },
			{ until: 15, slot: "lunch" },
			{ until: 22, slot: "dinner" },
			{ until: 24, slot: "late_night" },
		];
		const slot = TIME_SLOTS.find((s) => hour < s.until)!.slot;
		setTimeSlot(slot);
	}, [logFrontendEvent]);

	const handleLocationClear = () => {
		lightImpact();
		setLocation(null);
		setLocationQuery("");
		logFrontendEvent({
			event_name: "location_cleared",
			error_level: "log",
			payload: {},
		});
	};

	const handleLocationSelect = async (prediction: AutocompleteLocation) => {
		logFrontendEvent({
			event_name: "location_selected",
			error_level: "log",
			payload: { placeId: prediction.place_id, mainText: prediction.mainText },
		});
		setLocationQuery(prediction.mainText);
		try {
			const locationDetails = await getLocationDetails(prediction);
			setLocation(locationDetails);
		} catch (error) {
			logFrontendEvent({
				event_name: "location_selection_failed",
				error_level: "error",
				payload: { placeId: prediction.place_id, error: String(error) },
			});
			showSnackbar(i18n.t("Search.errors.fetchLocation"));
		}
	};

	const handleUseCurrentLocation = async () => {
		lightImpact();
		logFrontendEvent({
			event_name: "current_location_requested",
			error_level: "log",
			payload: {},
		});
		try {
			const currentLocation = await getCurrentLocation();
			setLocation(currentLocation);
			setLocationQuery(i18n.t("Search.currentLocation"));
			logFrontendEvent({
				event_name: "current_location_success",
				error_level: "log",
				payload: { hasLocation: !!currentLocation },
			});
		} catch (error) {
			logFrontendEvent({
				event_name: "current_location_failed",
				error_level: "error",
				payload: { error: String(error) },
			});
			showSnackbar(i18n.t("Search.errors.getCurrentLocation"));
		}
	};

	const handleSearch = useCallback(() => {
		// #533 【仕様】location, timeSlot, scene を必須化（レコメンドAPI必須化対応）
		if (!location) {
			showSnackbar(i18n.t("Search.errors.noLocationSelected"));
			return;
		}
		if (!timeSlot) {
			showSnackbar(i18n.t("Search.errors.noTimeSlotSelected"));
			return;
		}
		if (!scene) {
			showSnackbar(i18n.t("Search.errors.noSceneSelected"));
			return;
		}

		if (isSearchingRef.current) return; // 多重検索防止

		mediumImpact();
		isSearchingRef.current = true;

		const searchParams: SearchParams = {
			...location,
			timeSlot,
			scene,
			taste,
			coreIngredient,
			diningPace,
			distance,
			priceLevels,
			locationQuery, // #674 【仕様】検索画面で入力されたロケーション表示用文字列を渡す
		};

		logFrontendEvent({
			event_name: "search_started",
			error_level: "log",
			payload: searchParams,
		});

		// Navigate to cards screen with search parameters
		router.push({
			pathname: "/[locale]/(tabs)/search/topics",
			params: {
				locale,
				searchParams: JSON.stringify(searchParams),
			},
		});

		setTimeout(() => {
			isSearchingRef.current = false;
		}, 1000);
	}, [
		location,
		timeSlot,
		scene,
		taste,
		coreIngredient,
		diningPace,
		distance,
		priceLevels,
		locationQuery,
		mediumImpact,
		logFrontendEvent,
		showSnackbar,
		locale,
	]);
	// Wrapper functions for haptic feedback
	const handleTimeSlotSelect = (slotId: SearchParams["timeSlot"]) => {
		lightImpact();
		setTimeSlot(slotId);
	};

	// #533 【仕様】scene を必須化（解除不可、レコメンドAPI必須化対応）
	const handleSceneSelect = (sceneId: SearchParams["scene"]) => {
		lightImpact();
		setScene(sceneId);
	};

	const handleFoodStyleSelect = (option: (typeof foodStyleOptions)[number]) => {
		lightImpact();
		if (option.featureType === "taste") {
			setTaste(taste === option.id ? undefined : option.id);
			setCoreIngredient(undefined);
			return;
		}
		setCoreIngredient(coreIngredient === option.id ? undefined : option.id);
		setTaste(undefined);
	};

	const handleDiningPaceSelect = (diningPaceId: SearchParams["diningPace"]) => {
		lightImpact();
		setDiningPace(diningPace === diningPaceId ? undefined : diningPaceId);
	};

	const handleAdvancedToggle = () => {
		lightImpact();
		setShowAdvancedFilters(!showAdvancedFilters);
	};

	// #973【設計】検索ボタンをdisabledにすると handleSearch 内のバリデーションスナックバーが
	// 発火しなくなるため、常にタップ可能にしたうえで見た目だけ「未充足」を伝える
	const isSearchReady = !!location && !!timeSlot && !!scene;

	// ========== チュートリアル表示制御 ==========
	const [showTutorial, setShowTutorial] = useState(false);
	const { hasSeenTutorial, isLoading: isTutorialLoading, markTutorialAsSeen } = useSearchTutorial();
	// チュートリアル初期処理実行済みフラグ
	const didInitTutorialState = useRef(false);
	// チュートリアル表示制御のため、画面がフォーカスされているかを判定
	const isFocused = useIsFocused();

	useEffect(() => {
		if (!isFocused) return;
		if (isTutorialLoading) return;
		if (hasSeenTutorial === null) return;
		if (didInitTutorialState.current) return;

		didInitTutorialState.current = true;

		if (!isJapanese) {
			// #642 【設計】対応言語以外ではチュートリアルを表示しない
			getCurrentLocation()
				.then((currentLocation) => {
					setLocation(currentLocation);
					setLocationQuery(i18n.t("Search.currentLocation"));
				})
				.catch(console.error);
			return;
		}

		if (hasSeenTutorial === false) {
			// #642 【設計】チュートリアル未表示の場合、自動表示する（getCurrentLocation は呼ばない）
			setShowTutorial(true);
			logFrontendEvent({
				event_name: "search_tutorial_auto_opened",
				error_level: "log",
				payload: { opened_reason: "auto" },
			});
		} else if (hasSeenTutorial === true) {
			// #642 【設計】チュートリアル既表示の場合、現在地取得してセットする
			getCurrentLocation()
				.then((currentLocation) => {
					setLocation(currentLocation);
					setLocationQuery(i18n.t("Search.currentLocation"));
				})
				.catch(console.error);
		}
	}, [isFocused, isTutorialLoading, hasSeenTutorial, logFrontendEvent, getCurrentLocation, isJapanese]);

	// #642 【設計】ヘルプアイコンからチュートリアルを手動で開く
	const handleOpenTutorial = () => {
		lightImpact();
		setShowTutorial(true);
		logFrontendEvent({
			event_name: "search_tutorial_opened",
			error_level: "log",
			payload: { opened_reason: "manual" },
		});
	};

	// #642 【設計】チュートリアル完了時の処理
	const handleTutorialCompleted = () => {
		markTutorialAsSeen();
		logFrontendEvent({
			event_name: "search_tutorial_completed",
			error_level: "log",
			payload: { completed: true },
		});
	};

	// #642 【設計】チュートリアルから位置情報取得を要求
	const handleTutorialRequestLocation = async () => {
		await handleUseCurrentLocation();
		logFrontendEvent({
			event_name: "search_tutorial_location_requested",
			error_level: "log",
			payload: { from_tutorial: true },
		});
	};

	return (
		<SafeAreaView style={styles.container} edges={["top"]}>
			{/* Header */}
			<View style={styles.header}>
				<Text style={styles.headerTitle}>{i18n.t("Search.headerTitle")}</Text>
				{/* #642 【設計】ヘルプアイコンからチュートリアルを再表示 */}
				{isJapanese && (
					<TouchableOpacity style={styles.helpButton} onPress={handleOpenTutorial}>
						<HelpCircle size={24} color="#6B7280" />
					</TouchableOpacity>
				)}
			</View>

			<ScrollView
				style={styles.scrollView}
				contentContainerStyle={styles.scrollContent}
				keyboardShouldPersistTaps="always"
				showsVerticalScrollIndicator={false}>
				{/* Location Input */}
				<View style={styles.section}>
					<View style={styles.sectionHeader}>
						<MapPin size={20} color="#F05537" />
						<Text style={styles.sectionTitle}>{i18n.t("Search.sections.location")}</Text>
						<View style={styles.requiredBadge}>
							<Text style={styles.requiredText}>{i18n.t("Search.required")}</Text>
						</View>
					</View>
					<View style={styles.locationSection}>
						<LocationAutocomplete
							value={locationQuery}
							onChangeText={setLocationQuery}
							onSelectSuggestion={handleLocationSelect}
							onClear={handleLocationClear}
							placeholder={i18n.t("Search.placeholders.enterLocation")}
							autoClearOnFocus={locationQuery === i18n.t("Search.currentLocation")}
							renderInputRight={
								<TouchableOpacity style={styles.currentLocationButton} onPress={handleUseCurrentLocation}>
									<Navigation size={20} color="#000000" />
								</TouchableOpacity>
							}
							testID="search-location-autocomplete"
						/>
					</View>
				</View>

				{/* #667 【設計】Time of Day - カード無し、画像グリッド表示（4列1行） */}
				<View style={styles.section}>
					<View style={styles.sectionHeader}>
						<SunMoon size={20} color="#F05537" />
						<Text style={styles.sectionTitle}>{i18n.t("Search.sections.time")}</Text>
						<View style={styles.requiredBadge}>
							<Text style={styles.requiredText}>{i18n.t("Search.required")}</Text>
						</View>
					</View>
					<View style={styles.gridContainer}>
						{timeSlots.map((slot) => (
							<Pressable
								key={slot.id}
								testID={`search-time-slot-${slot.id}`}
								style={[styles.gridItem, timeSlot === slot.id && styles.selectedGridItem]}
								onPress={() => handleTimeSlotSelect(slot.id)}>
								<Image
									source={slot.image}
									style={[{ width: ITEM_WIDTH, height: ITEM_WIDTH }, styles.gridItemImage]}
									contentFit="cover"
									transition={0}
									priority="high"
									cachePolicy="memory"
								/>
								<Text style={[styles.gridItemLabel, timeSlot === slot.id && styles.selectedGridItemLabel]}>
									{i18n.t(slot.label)}
								</Text>
							</Pressable>
						))}
					</View>
				</View>

				{/* #667 【設計】Scene - カード無し、画像グリッド表示（4列2行） */}
				<View style={styles.section}>
					<View style={styles.sectionHeader}>
						<Users size={20} color="#F05537" />
						<Text style={styles.sectionTitle}>{i18n.t("Search.sections.scene")}</Text>
						<View style={styles.requiredBadge}>
							<Text style={styles.requiredText}>{i18n.t("Search.required")}</Text>
						</View>
					</View>
					<View style={styles.gridContainer}>
						{sceneOptions.map((option) => (
							<Pressable
								key={option.id}
								testID={`search-scene-${option.id}`}
								style={[styles.gridItem, scene === option.id && styles.selectedGridItem]}
								onPress={() => handleSceneSelect(option.id)}>
								<Image
									source={option.image}
									style={[{ width: ITEM_WIDTH, height: ITEM_WIDTH }, styles.gridItemImage]}
									contentFit="cover"
									transition={0}
									priority="high"
									cachePolicy="memory"
								/>
								<Text style={[styles.gridItemLabel, scene === option.id && styles.selectedGridItemLabel]}>
									{i18n.t(option.label)}
								</Text>
							</Pressable>
						))}
					</View>
				</View>

				{/* Price Levels */}
				<View style={styles.section}>
					<View style={styles.sectionHeader}>
						<DollarSign size={20} color="#F05537" />
						<Text style={styles.sectionTitle}>{i18n.t("Search.sections.budget")}</Text>
					</View>
					<View style={styles.sliderSection}>
						<PriceLevelsMultiSelect
							selectedPriceLevels={priceLevels}
							onPriceLevelsChange={setPriceLevels}
							customStyles={{
								chipGrid: styles.chipGrid,
								chip: styles.chip,
								selectedChip: styles.selectedChip,
								chipText: styles.chipText,
								selectedChipText: styles.selectedChipText,
							}}
						/>
					</View>
				</View>

				{/* Dining Pace */}
				<View style={styles.section}>
					<View style={styles.sectionHeader}>
						<Timer size={20} color="#F05537" />
						<Text style={styles.sectionTitle}>{i18n.t("Search.sections.diningPace")}</Text>
					</View>
					<View style={styles.chipGrid}>
						{diningPaceOptions.map((option) => (
							<TouchableOpacity
								key={option.id}
								style={[styles.chip, diningPace === option.id && styles.selectedChip]}
								onPress={() => handleDiningPaceSelect(option.id)}>
								<Text style={styles.chipEmoji}>{option.icon}</Text>
								<Text style={[styles.chipText, diningPace === option.id && styles.selectedChipText]}>
									{i18n.t(option.label)}
								</Text>
							</TouchableOpacity>
						))}
					</View>
				</View>

				{/* Advanced Filters Toggle */}
				{!showAdvancedFilters && (
					<TouchableOpacity
						testID="search-advanced-toggle"
						style={styles.advancedToggle}
						onPress={handleAdvancedToggle}>
						{showAdvancedFilters ? <ChevronUp size={20} color="#F05537" /> : <Plus size={20} color="#F05537" />}
						<Text style={styles.advancedToggleText}>
							{showAdvancedFilters ? i18n.t("Search.advancedToggle.close") : i18n.t("Search.advancedToggle.open")}
						</Text>
					</TouchableOpacity>
				)}

				{/* Advanced Filters Section */}
				{showAdvancedFilters && (
					<>
						{/* Distance */}
						<View style={styles.section}>
							<View style={styles.sectionHeader}>
								<Ruler size={20} color="#F05537" />
								<Text style={styles.sectionTitle}>{i18n.t("Search.sections.distance")}</Text>
							</View>
							<View style={styles.sliderSection}>
								<Text style={styles.sliderValue}>
									{distanceOptions.find((option) => option.value === distance)?.label}
								</Text>
								<DistanceSlider distance={distance} setDistance={setDistance} />
							</View>
						</View>

						{/* Food Style */}
						<View style={styles.section}>
							<View style={styles.sectionHeader}>
								<ChefHat size={20} color="#F05537" />
								<Text style={styles.sectionTitle}>{i18n.t("Search.sections.foodStyle")}</Text>
							</View>
							<View style={styles.chipGrid}>
								{foodStyleOptions.map((option) => {
									const isSelected =
										option.featureType === "taste" ? taste === option.id : coreIngredient === option.id;
									return (
										<TouchableOpacity
											key={`${option.featureType}:${option.id}`}
											style={[styles.chip, isSelected && styles.selectedChip]}
											onPress={() => handleFoodStyleSelect(option)}>
											<Text style={styles.chipEmoji}>{option.icon}</Text>
											<Text style={[styles.chipText, isSelected && styles.selectedChipText]}>
												{i18n.t(option.label)}
											</Text>
										</TouchableOpacity>
									);
								})}
							</View>
						</View>

						{/* Restrictions */}
						{
							// #541 にて廃止
							// (<View style={styles.section}>
							// 	<View style={styles.sectionHeader}>
							// 		<Text style={styles.sectionTitle}>{i18n.t("Search.sections.restrictions")}</Text>
							// 	</View>
							// 	<View style={styles.restrictionsContainer}>
							// 		{restrictionOptions.map((option) => (
							// 			<TouchableOpacity
							// 				key={option.id}
							// 				style={[styles.restrictionChip, restrictions.includes(option.id) && styles.selectedRestrictionChip]}
							// 				onPress={() => toggleRestriction(option.id)}>
							// 				<Text style={styles.chipEmoji}>{option.icon}</Text>
							// 				<Text
							// 					style={[
							// 						styles.restrictionChipText,
							// 						restrictions.includes(option.id) && styles.selectedRestrictionChipText,
							// 					]}>
							// 					{i18n.t(option.label)}
							// 				</Text>
							// 			</TouchableOpacity>
							// 		))}
							// 	</View>
							// </View>)
						}
					</>
				)}
			</ScrollView>

			{/* Search FAB */}
			{/* #973【設計】コンテナ背景は完全透明にし、ボタンの裏に隠れがちな価格帯セクションに気づけるようにする。
			    ボタン以外の透明部分はタッチを透過させ、下のスクロール操作を妨げない。
			    ボタン自体は searchFab に白背景を持たせて視認性を確保しつつ、
			    未充足時は disabled にせず色をグレーに落とすことで、押下時の
			    バリデーションスナックバー（handleSearch 内）が必ず届くようにする */}
			<View style={styles.searchFabContainer} pointerEvents="box-none">
				<PrimaryButton
					testID="search-submit-button"
					label={i18n.t("Search.searchButton")}
					onPress={handleSearch}
					colors={isSearchReady ? ["#000000", "#000000"] : ["#6B7280", "#6B7280"]}
					labelStyle={{ color: "#FFFFFF" }}
					shadowColor="rgba(0, 0, 0, 0.45)"
					icon={<Search size={20} color="#FFFFFF" />}
					style={styles.searchFab}
				/>
			</View>

			{/* #642 【設計】チュートリアル BottomSheet */}
			<TutorialBottomSheet
				visible={showTutorial}
				pageConfigs={TUTORIAL_PAGES}
				onClose={() => setShowTutorial(false)}
				onCompleted={handleTutorialCompleted}
				onRequestCurrentLocation={handleTutorialRequestLocation}
			/>
			{/* #642 【設計】オフスクリーンでチュートリアル画像を一度描画して decode */}
			<View style={{ width: 0, height: 0, position: "absolute", overflow: "hidden" }}>
				{PRELOAD_IMAGES.map((src, i) => (
					<Image key={i} source={src} />
				))}
			</View>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#F8F9FA",
	},
	scrollView: {
		flex: 1,
	},
	scrollContent: {
		paddingBottom: 100, // moved here so it affects ScrollView content
		gap: 12,
	},
	header: {
		paddingHorizontal: 24,
		paddingTop: 20,
		paddingBottom: 20,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	helpButton: {
		paddingHorizontal: 8,
	},
	headerTitle: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		letterSpacing: -0.5,
	},
	// #667 【設計】カード無しセクションのスタイル
	section: {
		paddingHorizontal: HORIZONTAL_PADDING,
		marginBottom: 24,
	},
	sectionHeader: {
		flexDirection: "row",
		alignItems: "center",
		marginBottom: 16,
	},
	sectionTitle: {
		fontSize: 16,
		fontWeight: "700",
		color: "#1A1A1A",
		marginLeft: 8,
		flex: 1,
	},
	requiredBadge: {
		backgroundColor: "#FEE2E2",
		paddingHorizontal: 8,
		paddingVertical: 4,
		borderRadius: 12,
	},
	requiredText: {
		fontSize: 10,
		fontWeight: "600",
		color: "#DC2626",
	},
	locationSection: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 12,
	},
	currentLocationButton: {
		padding: 16,
		borderLeftWidth: 0.5,
		borderLeftColor: "#C9C9C9",
	},
	// #667 【設計】画像グリッドコンテナ（4列、flexWrap）
	gridContainer: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: ITEM_GAP,
	},
	// #667 【設計】グリッドアイテム（画像+ラベル）
	gridItem: {
		width: ITEM_WIDTH + 2 * ITEM_PADDING + 2 * BORDER_WIDTH,
		maxWidth: 256,
		alignItems: "center",
		overflow: "hidden",
		padding: ITEM_PADDING,
		borderRadius: 16,
		borderWidth: BORDER_WIDTH,
		borderColor: "transparent",
	},
	selectedGridItem: {
		borderColor: "#000000",
		backgroundColor: "#E5E5E5",
	},
	gridItemImage: {
		borderRadius: 16,
		maxWidth: 256,
		maxHeight: 256,
	},
	// #667 【設計】グリッドアイテムのラベル
	gridItemLabel: {
		marginTop: 4,
		fontSize: 11,
		color: "#000000",
		fontWeight: "600",
		textAlign: "center",
	},
	selectedGridItemLabel: {},
	// #667 【設計】ムード用の横並びコンテナ
	moodContainer: {
		flexDirection: "row",
		justifyContent: "space-around",
		alignItems: "center",
		paddingVertical: 16,
	},
	// #667 【設計】ムード個別アイテム（円+ラベル縦並び）
	moodItem: {
		flex: 1,
		alignItems: "center",
		gap: 8,
	},
	// #667 【設計】ムードの円形アイコン
	moodCircle: {
		backgroundColor: "#C9C9C9",
		borderRadius: 100, // 完全な円
	},
	selectedMoodCircle: {
		backgroundColor: "#000000",
	},
	// #667 【設計】ムードのラベル
	moodLabel: {
		fontSize: 13,
		color: "#000000",
		fontWeight: "500",
		textAlign: "center",
	},
	selectedMoodLabel: {
		fontWeight: "600",
	},
	advancedToggle: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#FDEBE7",
		marginHorizontal: 24,
		paddingVertical: 16,
		paddingHorizontal: 20,
		borderRadius: 16,
	},
	advancedToggleText: {
		fontSize: 15,
		color: "#F05537",
		fontWeight: "600",
		marginLeft: 12,
	},
	chipGrid: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 12,
	},
	chip: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#F8F9FA",
		paddingHorizontal: 12,
		paddingVertical: 6,
		borderRadius: 24,
		borderWidth: BORDER_WIDTH,
		borderColor: "#C9C9C9",
		marginBottom: 6,
	},
	selectedChip: {
		// 濃い灰色
		backgroundColor: "#E5E5E5",
		borderColor: "#000000",
	},
	chipEmoji: {
		fontSize: 14,
		marginRight: 4,
	},
	chipText: {
		fontSize: 13,
		color: "#000000",
		fontWeight: "600",
	},
	selectedChipText: {},
	sliderSection: {
		alignItems: "center",
	},
	sliderValue: {
		fontSize: 18,
		fontWeight: "700",
		color: "#000000",
		marginBottom: 8,
		textAlign: "center",
	},
	searchFabContainer: {
		position: "absolute",
		bottom: 0,
		paddingTop: 12,
		paddingBottom: 32,
		paddingHorizontal: HORIZONTAL_PADDING,
		width: "100%",
		justifyContent: "center",
		flexDirection: "row",
		alignItems: "center",
	},
	searchFab: {
		width: "100%",
		// #973【設計】コンテナ全体を透明にした分、ボタンの矩形部分だけ白背景を持たせて
		// 未充足時のグレー表示も含め視認性を確保する(価格帯セクションの見通しは維持)
		backgroundColor: "#FFFFFF",
		borderRadius: 8,
	},
	restrictionsContainer: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 12,
	},
	restrictionChip: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#F8F9FA",
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 20,
		marginBottom: 8,
	},
	selectedRestrictionChip: {
		backgroundColor: "#EF4444",
	},
	restrictionChipText: {
		fontSize: 11,
		color: "#6B7280",
		fontWeight: "500",
		marginLeft: 8,
		marginRight: 8,
	},
	selectedRestrictionChipText: {
		color: "#FFF",
		fontWeight: "700",
	},
});
