import React, { useState, useEffect } from "react";
import {
	View,
	Text,
	StyleSheet,
	ScrollView,
	TouchableOpacity,
	TextInput,
	SafeAreaView,
	ActivityIndicator,
	FlatList,
} from "react-native";
import { Divider } from "react-native-paper";
import {
	MapPin,
	Search,
	Clock,
	Users,
	Heart,
	Navigation,
	MapPin as Distance,
	DollarSign,
	Plus,
	ChevronUp,
} from "lucide-react-native";
import { router } from "expo-router";
import { SearchParams, SearchLocation } from "@/types/search";
import type { AutocompleteLocation } from "@shared/api/v1/res";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { Card } from "@/components/Card";
import { timeSlots, sceneOptions, moodOptions, distanceOptions, restrictionOptions } from "@/features/search/constants";
import { DistanceSlider } from "@/features/search/components/DistanceSlider";
import { PriceLevelsMultiSelect } from "@/features/search/components/PriceLevelsMultiSelect";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";

export default function SearchScreen() {
	const locale = useLocale();
	const { lightImpact, mediumImpact } = useHaptics();
	const [location, setLocation] = useState<SearchLocation | null>(null);
	const [locationQuery, setLocationQuery] = useState("");
	const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
	const [timeSlot, setTimeSlot] = useState<SearchParams["timeSlot"]>("lunch");
	const [scene, setScene] = useState<SearchParams["scene"] | undefined>(undefined);
	const [mood, setMood] = useState<SearchParams["mood"] | undefined>(undefined);
	const [restrictions, setRestrictions] = useState<string[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [distance, setDistance] = useState<number>(500); // Default 500m
	const [priceLevels, setPriceLevels] = useState<number[]>([0, 1, 2, 3, 4]); // Default all selected
	const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

	const {
		suggestions,
		isSearching: isLocationSearching,
		searchLocations,
		getLocationDetails,
		getCurrentLocation,
	} = useLocationSearch();
	const { showSnackbar } = useSnackbar();

	useEffect(() => {
		// Auto-detect current location on mount
		getCurrentLocation().then(setLocation).catch(console.error);

		// Auto-set time slot based on current time
		const hour = new Date().getHours();
		if (hour < 10) setTimeSlot("morning");
		else if (hour < 15) setTimeSlot("lunch");
		else if (hour < 17) setTimeSlot("afternoon");
		else if (hour < 22) setTimeSlot("dinner");
		else setTimeSlot("late_night");
	}, [getCurrentLocation]);

	const handleLocationSearch = (query: string) => {
		setLocationQuery(query);
		if (query.length >= 2) {
			setShowLocationSuggestions(true);
			searchLocations(query);
		} else {
			setShowLocationSuggestions(false);
		}
	};

	const handleLocationSelect = async (prediction: AutocompleteLocation) => {
		lightImpact();
		try {
			const locationDetails = await getLocationDetails(prediction);
			setLocation(locationDetails);
			setLocationQuery(locationDetails.address);
			setShowLocationSuggestions(false);
		} catch (error) {
			showSnackbar(i18n.t("Search.errors.fetchLocation"));
		}
	};

	const handleUseCurrentLocation = async () => {
		lightImpact();
		try {
			const currentLocation = await getCurrentLocation();
			setLocation(currentLocation);
			setLocationQuery(currentLocation.address);
		} catch (error) {
			showSnackbar(i18n.t("Search.errors.getCurrentLocation"));
		}
	};

	const toggleRestriction = (restrictionId: string) => {
		lightImpact();
		setRestrictions((prev) =>
			prev.includes(restrictionId) ? prev.filter((id) => id !== restrictionId) : [...prev, restrictionId],
		);
	};

	const handleSearch = async () => {
		if (!location) {
			showSnackbar(i18n.t("Search.errors.noLocationSelected"));
			return;
		}

		mediumImpact();
		setIsSearching(true);

		try {
			const searchParams: SearchParams = {
				address: location.address,
				location: `${location.latitude},${location.longitude}`,
				timeSlot,
				scene,
				mood,
				restrictions,
				distance,
				priceLevels,
			};

			// Navigate to cards screen with search parameters
			router.push({
				pathname: "/[locale]/(tabs)/search/topics",
				params: {
					locale,
					searchParams: JSON.stringify(searchParams),
				},
			});
		} catch (error) {
			showSnackbar(i18n.t("Search.errors.searchFailed"));
		} finally {
			setIsSearching(false);
		}
	};

	const formatPriceLevelsDisplay = () => {
		if (priceLevels.length === 0) {
			return i18n.t("Search.priceLevels.none");
		}
		if (priceLevels.length === 5) {
			return i18n.t("Search.priceLevels.all");
		}
		return i18n.t("Search.priceLevels.selected", { count: priceLevels.length });
	};

	// Wrapper functions for haptic feedback
	const handleTimeSlotSelect = (slotId: SearchParams["timeSlot"]) => {
		lightImpact();
		setTimeSlot(slotId);
	};

	const handleSceneSelect = (sceneId: SearchParams["scene"]) => {
		lightImpact();
		setScene(scene === sceneId ? undefined : sceneId);
	};

	const handleMoodSelect = (moodId: SearchParams["mood"]) => {
		lightImpact();
		setMood(mood === moodId ? undefined : moodId);
	};

	const handleAdvancedToggle = () => {
		lightImpact();
		setShowAdvancedFilters(!showAdvancedFilters);
	};

	const renderLocationSuggestion = ({ item }: { item: AutocompleteLocation }) => (
		<TouchableOpacity style={styles.suggestionItem} onPress={() => handleLocationSelect(item)}>
			<MapPin size={16} color="#666" />
			<View style={styles.suggestionText}>
				<Text style={styles.suggestionMain}>{item.mainText}</Text>
				<Text style={styles.suggestionSecondary}>{item.secondaryText}</Text>
			</View>
		</TouchableOpacity>
	);

	return (
		<SafeAreaView style={styles.container}>
			{/* Header */}
			<View style={styles.header}>
				<Text style={styles.headerTitle}>{i18n.t("Search.headerTitle")}</Text>
			</View>

			<ScrollView
				style={styles.scrollView}
				contentContainerStyle={styles.scrollContent}
				showsVerticalScrollIndicator={false}>
				{/* Location Input */}
				<Card>
					<View style={styles.sectionHeader}>
						<MapPin size={20} color="#5EA2FF" />
						<Text style={styles.sectionTitle}>{i18n.t("Search.sections.location")}</Text>
						<View style={styles.requiredBadge}>
							<Text style={styles.requiredText}>{i18n.t("Search.required")}</Text>
						</View>
					</View>
					<View style={styles.locationInputContainer}>
						<TextInput
							style={styles.locationInput}
							placeholder={i18n.t("Search.placeholders.enterLocation")}
							placeholderTextColor="#6B7280"
							value={locationQuery}
							onChangeText={handleLocationSearch}
							onFocus={() => locationQuery.length >= 2 && setShowLocationSuggestions(true)}
						/>
						<TouchableOpacity style={styles.currentLocationButton} onPress={handleUseCurrentLocation}>
							<Navigation size={20} color="#5EA2FF" />
						</TouchableOpacity>
					</View>

					{showLocationSuggestions && (
						<View style={styles.suggestionsContainer}>
							{isLocationSearching ? (
								<View style={styles.loadingContainer}>
									<ActivityIndicator size="small" color="#5EA2FF" />
									<Text style={styles.loadingText}>{i18n.t("Search.loading")}</Text>
								</View>
							) : (
								<FlatList
									data={suggestions}
									renderItem={renderLocationSuggestion}
									keyExtractor={(item) => item.place_id}
									style={styles.suggestionsList}
									scrollEnabled={false}
								/>
							)}
						</View>
					)}
				</Card>

				{/* Time of Day */}
				<Card>
					<View style={styles.sectionHeader}>
						<Clock size={20} color="#5EA2FF" />
						<Text style={styles.sectionTitle}>{i18n.t("Search.sections.time")}</Text>
					</View>
					<View style={styles.chipGrid}>
						{timeSlots.map((slot) => (
							<TouchableOpacity
								key={slot.id}
								style={[styles.chip, timeSlot === slot.id && styles.selectedChip]}
								onPress={() => handleTimeSlotSelect(slot.id)}>
								<Text style={styles.chipEmoji}>{slot.icon}</Text>
								<Text style={[styles.chipText, timeSlot === slot.id && styles.selectedChipText]}>
									{i18n.t(slot.label)}
								</Text>
							</TouchableOpacity>
						))}
					</View>
				</Card>

				{/* Scene */}
				<Card>
					<View style={styles.sectionHeader}>
						<Users size={20} color="#5EA2FF" />
						<Text style={styles.sectionTitle}>{i18n.t("Search.sections.scene")}</Text>
					</View>
					<View style={styles.chipGrid}>
						{sceneOptions.map((option) => (
							<TouchableOpacity
								key={option.id}
								style={[styles.chip, scene === option.id && styles.selectedChip]}
								onPress={() => handleSceneSelect(option.id)}>
								<Text style={styles.chipEmoji}>{option.icon}</Text>
								<Text style={[styles.chipText, scene === option.id && styles.selectedChipText]}>
									{i18n.t(option.label)}
								</Text>
							</TouchableOpacity>
						))}
					</View>
				</Card>

				{/* Mood */}
				<Card>
					<View style={styles.sectionHeader}>
						<Heart size={20} color="#5EA2FF" />
						<Text style={styles.sectionTitle}>{i18n.t("Search.sections.mood")}</Text>
					</View>
					<View style={styles.chipGrid}>
						{moodOptions.map((option) => (
							<TouchableOpacity
								key={option.id}
								style={[styles.chip, mood === option.id && styles.selectedChip]}
								onPress={() => handleMoodSelect(option.id)}>
								<Text style={styles.chipEmoji}>{option.icon}</Text>
								<Text style={[styles.chipText, mood === option.id && styles.selectedChipText]}>
									{i18n.t(option.label)}
								</Text>
							</TouchableOpacity>
						))}
					</View>
				</Card>

				{/* Advanced Filters Toggle */}
				{!showAdvancedFilters && (
					<TouchableOpacity style={styles.advancedToggle} onPress={handleAdvancedToggle}>
						{showAdvancedFilters ? <ChevronUp size={20} color="#5EA2FF" /> : <Plus size={20} color="#5EA2FF" />}
						<Text style={styles.advancedToggleText}>
							{showAdvancedFilters ? i18n.t("Search.advancedToggle.close") : i18n.t("Search.advancedToggle.open")}
						</Text>
					</TouchableOpacity>
				)}

				{/* Advanced Filters Section */}
				{showAdvancedFilters && (
					<>
						{/* Distance */}
						<Card>
							<View style={styles.sectionHeader}>
								<Distance size={20} color="#5EA2FF" />
								<Text style={styles.sectionTitle}>{i18n.t("Search.sections.distance")}</Text>
							</View>
							<View style={styles.sliderSection}>
								<Text style={styles.sliderValue}>
									{distanceOptions.find((option) => option.value === distance)?.label}
								</Text>
								<DistanceSlider distance={distance} setDistance={setDistance} />
							</View>
						</Card>

						{/* Price Levels */}
						<Card>
							<View style={styles.sectionHeader}>
								<DollarSign size={20} color="#5EA2FF" />
								<Text style={styles.sectionTitle}>{i18n.t("Search.sections.priceLevels")}</Text>
							</View>
							<View style={styles.sliderSection}>
								<Text style={styles.sliderValue}>{formatPriceLevelsDisplay()}</Text>
								<PriceLevelsMultiSelect selectedPriceLevels={priceLevels} onPriceLevelsChange={setPriceLevels} />
							</View>
						</Card>

						{/* Restrictions */}
						<Card>
							<View style={styles.sectionHeader}>
								<Text style={styles.sectionTitle}>{i18n.t("Search.sections.restrictions")}</Text>
							</View>
							<View style={styles.restrictionsContainer}>
								{restrictionOptions.map((option) => (
									<TouchableOpacity
										key={option.id}
										style={[styles.restrictionChip, restrictions.includes(option.id) && styles.selectedRestrictionChip]}
										onPress={() => toggleRestriction(option.id)}>
										<Text style={styles.chipEmoji}>{option.icon}</Text>
										<Text
											style={[
												styles.restrictionChipText,
												restrictions.includes(option.id) && styles.selectedRestrictionChipText,
											]}>
											{i18n.t(option.label)}
										</Text>
									</TouchableOpacity>
								))}
							</View>
						</Card>
					</>
				)}
			</ScrollView>

			{/* Search FAB */}
			<View pointerEvents="box-none" style={styles.searchFabContainer}>
				<TouchableOpacity
					style={[styles.searchFab, !location && styles.disabledFab]}
					onPress={handleSearch}
					disabled={!location || isSearching}>
					{isSearching ? (
						<ActivityIndicator size="small" color="#FFF" />
					) : (
						<>
							<Search size={24} color="#FFF" />
							<Text style={styles.fabText}>{i18n.t("Search.searchButton")}</Text>
						</>
					)}
				</TouchableOpacity>
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
	},
	header: {
		paddingHorizontal: 24,
		paddingTop: 20,
		paddingBottom: 20,
	},
	headerTitle: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 8,
		letterSpacing: -0.5,
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
	locationInputContainer: {
		flexDirection: "row",
		alignItems: "center",
		borderRadius: 16,
		backgroundColor: "#F8F9FA",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.05,
		shadowRadius: 2,
		elevation: 1,
	},
	locationInput: {
		flex: 1,
		paddingHorizontal: 20,
		paddingVertical: 16,
		fontSize: 16,
		color: "#1A1A1A",
	},
	currentLocationButton: {
		padding: 16,
		borderLeftWidth: 0.5,
		borderLeftColor: "#E5E7EB",
	},
	suggestionsContainer: {
		marginTop: 12,
		backgroundColor: "#FFF",
		borderRadius: 16,
		maxHeight: 200,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.1,
		shadowRadius: 24,
		elevation: 4,
	},
	loadingContainer: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: 20,
	},
	loadingText: {
		marginLeft: 8,
		fontSize: 14,
		color: "#6B7280",
	},
	suggestionsList: {
		maxHeight: 200,
	},
	suggestionItem: {
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 20,
		paddingVertical: 16,
		borderBottomWidth: 0.5,
		borderBottomColor: "#F3F4F6",
	},
	suggestionText: {
		marginLeft: 16,
		flex: 1,
	},
	suggestionMain: {
		fontSize: 16,
		color: "#1A1A1A",
		fontWeight: "600",
	},
	suggestionSecondary: {
		fontSize: 14,
		color: "#6B7280",
		marginTop: 4,
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
		marginBottom: 6,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.1,
		shadowRadius: 4,
		elevation: 1,
	},
	selectedChip: {
		backgroundColor: "#5EA2FF",
		shadowColor: "#5EA2FF",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 24,
		elevation: 8,
	},
	chipEmoji: {
		fontSize: 14,
		marginRight: 4,
	},
	chipText: {
		fontSize: 13,
		color: "#6B7280",
		fontWeight: "500",
	},
	selectedChipText: {
		color: "#FFF",
		fontWeight: "600",
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
	searchFabContainer: {
		position: "absolute",
		bottom: 32,
		right: 20,
		left: 20,
		justifyContent: "center",
		flexDirection: "row",
		alignItems: "center",
	},
	searchFab: {
		backgroundColor: "#5EA2FF",
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 32,
		paddingVertical: 20,
		borderRadius: 32,
		shadowColor: "#5EA2FF",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.5,
		shadowRadius: 24,
		elevation: 12,
	},
	disabledFab: {
		backgroundColor: "#D1D5DB",
		shadowOpacity: 0.1,
	},
	fabText: {
		fontSize: 18,
		fontWeight: "700",
		color: "#FFF",
		marginLeft: 12,
		letterSpacing: 0.5,
	},
	sliderSection: {
		alignItems: "center",
	},
	sliderValue: {
		fontSize: 18,
		fontWeight: "700",
		color: "#5EA2FF",
		marginBottom: 8,
		textAlign: "center",
	},
	sliderContainer: {
		width: 300,
		justifyContent: "center",
	},
	sliderTrack: {
		height: 6,
		backgroundColor: "#E5E7EB",
		borderRadius: 3,
		position: "relative",
		marginHorizontal: 16,
	},
	sliderThumb: {
		position: "absolute",
		width: 28,
		height: 28,
		backgroundColor: "#5EA2FF",
		borderRadius: 14,
		top: -11,
		borderWidth: 3,
		borderColor: "#FFFFFF",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.15,
		shadowRadius: 8,
		elevation: 6,
	},
	rangeTrack: {
		position: "absolute",
		height: 6,
		backgroundColor: "#5EA2FF",
		borderRadius: 3,
		top: 0,
	},
	rangeThumbMin: {
		backgroundColor: "#5EA2FF",
	},
	rangeThumbMax: {
		backgroundColor: "#5EA2FF",
	},
	sliderLabels: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginTop: 12,
		paddingHorizontal: 16,
	},
	sliderLabelLeft: {
		fontSize: 13,
		color: "#6B7280",
		fontWeight: "500",
	},
	sliderLabelRight: {
		fontSize: 13,
		color: "#6B7280",
		fontWeight: "500",
	},
	advancedToggle: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#F0F8FF",
		marginHorizontal: 24,
		marginVertical: 12,
		paddingVertical: 16,
		paddingHorizontal: 20,
		borderRadius: 16,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.1,
		shadowRadius: 8,
		elevation: 2,
	},
	advancedToggleText: {
		fontSize: 15,
		color: "#5EA2FF",
		fontWeight: "600",
		marginLeft: 12,
	},
});
