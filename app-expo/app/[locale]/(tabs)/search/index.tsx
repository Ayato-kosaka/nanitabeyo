import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
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
import { LocationPermissionError, type LocationPermissionErrorKind } from "@/hooks/locationPermissionError";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import {
	LocationAutocomplete,
	type LocationAutocompleteHandle,
	type RecentLocation,
} from "@/components/LocationAutocomplete";
import {
	timeSlots,
	sceneOptions,
	foodStyleOptions,
	diningPaceOptions,
	priceLevelOptions,
	TUTORIAL_PAGES,
	PRELOAD_IMAGES,
} from "@/features/search/constants";
import { DistanceSlider } from "@/features/search/components/DistanceSlider";
import { PriceLevelsMultiSelect } from "@/features/search/components/PriceLevelsMultiSelect";
import { SelectableGridItem } from "@/features/search/components/SelectableGridItem";
import { SelectableChip } from "@/features/search/components/SelectableChip";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { SafeAreaView } from "react-native-safe-area-context";
import { DEFAULT_SEARCH_RADIUS } from "@/features/topics/constants";
import { TutorialBottomSheet } from "@/features/search/components/TutorialBottomSheet";
import { useSearchTutorial } from "@/features/search/hooks/useSearchTutorial";
import { useRecentLocations } from "@/features/search/hooks/useRecentLocations";
import { Image } from "expo-image";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useIsFocused } from "@react-navigation/native";
import { useContentWidth } from "@/hooks/useContentWidth";

// #667 【設計】画面幅ベースでアイテムサイズを計算（4列グリッド）
// #958 【修正】Dimensions.get("window") はモジュール評価時に1回だけ計算されリサイズに
// 追従しないうえ、web ではウィンドウ実幅であって CenteredAppShell が収める中央カラム幅とは
// 一致しない。ITEM_WIDTH の計算は useContentWidth() を使いコンポーネント内で行う
const HORIZONTAL_PADDING = 16;
const ITEM_PADDING = 3;
const BORDER_WIDTH = 2;
const ITEM_GAP = 2;
const NUM_COLUMNS = 4;

// #934 【設計】各セクション見出し。accessibilityRole="header" を持たせ、必須バッジは
// 別要素として視覚表示しつつスクリーンリーダー向けには見出しの accessibilityLabel に合成する
// (別々に読み上げられるより「(必須)」まで一続きで聞こえた方が分かりやすいため)
function SectionHeader({ icon, title, required }: { icon: React.ReactNode; title: string; required?: boolean }) {
	const label = required ? `${title} (${i18n.t("Search.required")})` : title;
	return (
		<View style={styles.sectionHeader}>
			{icon}
			<Text style={styles.sectionTitle} accessibilityRole="header" accessibilityLabel={label}>
				{title}
			</Text>
			{required && (
				<View style={styles.requiredBadge} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
					<Text style={styles.requiredText}>{i18n.t("Search.required")}</Text>
				</View>
			)}
		</View>
	);
}

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
	// #932 【設計】現在地取得の恒久的な失敗(権限拒否・未対応)時に手入力へ誘導するため
	const locationInputRef = useRef<LocationAutocompleteHandle>(null);

	// #958 【修正】中央カラム幅に追従する4列グリッドのアイテムサイズ
	const contentWidth = useContentWidth();
	const itemWidth = useMemo(
		() =>
			(contentWidth -
				HORIZONTAL_PADDING * 2 -
				ITEM_GAP * (NUM_COLUMNS - 1) -
				(ITEM_PADDING * 2 + BORDER_WIDTH * 2) * NUM_COLUMNS) /
			NUM_COLUMNS,
		[contentWidth],
	);

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
			// #953 【仕様】details 取得に成功した地点だけを「最近使った場所」に保存する。
			// viewport はスプレッドすると型上は Omit していても実行時には残ってしまうため、明示的に除く。
			const { viewport: _viewport, ...locationWithoutViewport } = locationDetails;
			addRecentLocation({ ...locationWithoutViewport, locationQuery: prediction.mainText });
		} catch (error) {
			logFrontendEvent({
				event_name: "location_selection_failed",
				error_level: "error",
				payload: { placeId: prediction.place_id, error: String(error) },
			});
			showSnackbar(i18n.t("Search.errors.fetchLocation"));
		}
	};

	// #932 【設計】失敗理由(kind)ごとに文言を出し分ける。denied/unsupported は再試行しても
	// 解決しないため、手入力へ誘導するよう地点入力欄へフォーカスを移動する
	const getCurrentLocationErrorMessage = (kind: LocationPermissionErrorKind): string => {
		switch (kind) {
			case "denied":
				return i18n.t("Search.errors.getCurrentLocationDenied");
			case "unsupported":
				return i18n.t("Search.errors.getCurrentLocationUnsupported");
			case "timeout":
				return i18n.t("Search.errors.getCurrentLocationTimeout");
			case "unavailable":
			default:
				return i18n.t("Search.errors.getCurrentLocation");
		}
	};

	// #953 【仕様】最近使った場所は details API を呼び直さず、保存済みの location をそのまま復元する
	const handleSelectRecentLocation = useCallback(
		(recent: RecentLocation) => {
			logFrontendEvent({
				event_name: "recent_location_selected",
				error_level: "log",
				payload: { locationQuery: recent.locationQuery },
			});
			setLocation(recent);
			setLocationQuery(recent.locationQuery);
		},
		[logFrontendEvent],
	);

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
			const kind: LocationPermissionErrorKind = error instanceof LocationPermissionError ? error.kind : "unavailable";
			logFrontendEvent({
				event_name: "current_location_failed",
				error_level: "error",
				payload: { error: String(error), kind },
			});
			showSnackbar(getCurrentLocationErrorMessage(kind));

			// #932 【設計】権限拒否・未対応は再試行しても解決しないため、手入力へ誘導する
			if (kind === "denied" || kind === "unsupported") {
				locationInputRef.current?.focus();
			}
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

	// #953 【仕様】直近5件の地点をローカル保存し、地点未入力でのフォーカス時に再選択候補として出す
	const { recentLocations, addRecentLocation, clearRecentLocations } = useRecentLocations();

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
			// #932 【修正】マウント時の自動取得はユーザー操作を伴わないためSnackbarは出さない(UXを損なうため)。
			// ただし console.error への握りつぶしをやめ、理由(kind)付きで構造化ログに残す
			getCurrentLocation()
				.then((currentLocation) => {
					setLocation(currentLocation);
					setLocationQuery(i18n.t("Search.currentLocation"));
				})
				.catch((error) => {
					logFrontendEvent({
						event_name: "current_location_auto_fetch_failed",
						error_level: "warn",
						payload: {
							error: String(error),
							kind: error instanceof LocationPermissionError ? error.kind : "unavailable",
						},
					});
				});
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
			// #932 【修正】上と同様、Snackbarは出さず理由(kind)付きで構造化ログに残す
			getCurrentLocation()
				.then((currentLocation) => {
					setLocation(currentLocation);
					setLocationQuery(i18n.t("Search.currentLocation"));
				})
				.catch((error) => {
					logFrontendEvent({
						event_name: "current_location_auto_fetch_failed",
						error_level: "warn",
						payload: {
							error: String(error),
							kind: error instanceof LocationPermissionError ? error.kind : "unavailable",
						},
					});
				});
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
					<TouchableOpacity
						style={styles.helpButton}
						onPress={handleOpenTutorial}
						hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("Search.accessibility.showTutorial")}
						testID="search-help-button">
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
					<SectionHeader
						icon={<MapPin size={20} color="#F05537" />}
						title={i18n.t("Search.sections.location")}
						required
					/>
					<View style={styles.locationSection}>
						<LocationAutocomplete
							ref={locationInputRef}
							value={locationQuery}
							onChangeText={setLocationQuery}
							onSelectSuggestion={handleLocationSelect}
							onClear={handleLocationClear}
							placeholder={i18n.t("Search.placeholders.enterLocation")}
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
									testID="search-current-location-button">
									<Navigation size={20} color="#000000" />
								</TouchableOpacity>
							}
							testID="search-location-autocomplete"
						/>
					</View>
				</View>

				{/* #667 【設計】Time of Day - カード無し、画像グリッド表示（4列1行） */}
				<View style={styles.section}>
					<SectionHeader icon={<SunMoon size={20} color="#F05537" />} title={i18n.t("Search.sections.time")} required />
					<View
						style={styles.gridContainer}
						accessibilityRole="radiogroup"
						accessibilityLabel={i18n.t("Search.sections.time")}>
						{timeSlots.map((slot) => (
							<SelectableGridItem
								key={slot.id}
								testID={`search-time-slot-${slot.id}`}
								selected={timeSlot === slot.id}
								onPress={() => handleTimeSlotSelect(slot.id)}
								image={slot.image}
								label={i18n.t(slot.label)}
								itemWidth={itemWidth}
							/>
						))}
					</View>
				</View>

				{/* #667 【設計】Scene - カード無し、画像グリッド表示（4列2行） */}
				<View style={styles.section}>
					<SectionHeader icon={<Users size={20} color="#F05537" />} title={i18n.t("Search.sections.scene")} required />
					<View
						style={styles.gridContainer}
						accessibilityRole="radiogroup"
						accessibilityLabel={i18n.t("Search.sections.scene")}>
						{sceneOptions.map((option) => (
							<SelectableGridItem
								key={option.id}
								testID={`search-scene-${option.id}`}
								selected={scene === option.id}
								onPress={() => handleSceneSelect(option.id)}
								image={option.image}
								label={i18n.t(option.label)}
								itemWidth={itemWidth}
							/>
						))}
					</View>
				</View>

				{/* Price Levels */}
				<View style={styles.section}>
					<SectionHeader icon={<DollarSign size={20} color="#F05537" />} title={i18n.t("Search.sections.budget")} />
					<View style={styles.sliderSection}>
						<PriceLevelsMultiSelect
							selectedPriceLevels={priceLevels}
							onPriceLevelsChange={setPriceLevels}
							customStyles={{ chipGrid: styles.chipGrid }}
							groupAccessibilityLabel={i18n.t("Search.sections.budget")}
						/>
					</View>
				</View>

				{/* Dining Pace */}
				<View style={styles.section}>
					<SectionHeader icon={<Timer size={20} color="#F05537" />} title={i18n.t("Search.sections.diningPace")} />
					<View
						style={styles.chipGrid}
						accessibilityRole="radiogroup"
						accessibilityLabel={i18n.t("Search.sections.diningPace")}>
						{diningPaceOptions.map((option) => (
							<SelectableChip
								key={option.id}
								role="radio"
								selected={diningPace === option.id}
								label={i18n.t(option.label)}
								icon={option.icon}
								onPress={() => handleDiningPaceSelect(option.id)}
								testID={`search-dining-pace-${option.id}`}
							/>
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
							<SectionHeader icon={<Ruler size={20} color="#F05537" />} title={i18n.t("Search.sections.distance")} />
							<View style={styles.sliderSection}>
								{/* #987 【設計】距離値・おすすめ移動時間・詳細開閉を一つのコンパクトな操作領域に集約 */}
								<DistanceSlider distance={distance} setDistance={setDistance} />
							</View>
						</View>

						{/* Food Style */}
						<View style={styles.section}>
							<SectionHeader icon={<ChefHat size={20} color="#F05537" />} title={i18n.t("Search.sections.foodStyle")} />
							<View
								style={styles.chipGrid}
								accessibilityRole="radiogroup"
								accessibilityLabel={i18n.t("Search.sections.foodStyle")}>
								{foodStyleOptions.map((option) => {
									const isSelected =
										option.featureType === "taste" ? taste === option.id : coreIngredient === option.id;
									return (
										<SelectableChip
											key={`${option.featureType}:${option.id}`}
											role="radio"
											selected={isSelected}
											label={i18n.t(option.label)}
											icon={option.icon}
											onPress={() => handleFoodStyleSelect(option)}
											testID={`search-food-style-${option.featureType}-${option.id}`}
										/>
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
			{/* #989 【修正】絶対配置の全幅コンテナがボタン以外の透明領域でもクリックを奪い、
			    この帯域に重なるフォーム要素(距離スライダー等)がマウス操作不能になっていたため、
			    コンテナ自体はヒット対象から外し子のボタンだけが反応するようにする */}
			<View style={styles.searchFabContainer} pointerEvents="box-none">
				<PrimaryButton
					testID="search-submit-button"
					label={i18n.t("Search.searchButton")}
					onPress={handleSearch}
					colors={isSearchReady ? ["#000000", "#000000"] : ["#999999", "#999999"]}
					labelStyle={{ color: isSearchReady ? "#FFFFFF" : "#FFFFFF" }}
					shadowColor="rgba(0, 0, 0, 0.45)"
					icon={<Search size={20} color={isSearchReady ? "#FFFFFF" : "#FFFFFF"} />}
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
			{/* #934 【修正】decode専用で内容を持たないため aria-hidden で支援技術から隠す(axe: image-alt 対策) */}
			<View style={{ width: 0, height: 0, position: "absolute", overflow: "hidden" }} aria-hidden>
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
	sliderSection: {
		width: "100%",
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
