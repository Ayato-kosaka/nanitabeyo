import React, { useState, useRef, useEffect, useCallback } from "react";
import { View, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Navigation } from "lucide-react-native";
import MapView, { Region } from "@/components/MapView";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { useAPICall } from "@/hooks/useAPICall";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import type { AutocompleteLocation, QueryRestaurantsResponse } from "@shared/api/v1/res";
import type { QueryRestaurantsDto } from "@shared/api/v1/dto";
import { AvatarBubbleMarker } from "@/components/AvatarBubbleMarker";
import { useBlurModal } from "@/hooks/useBlurModal";
import { useHaptics } from "@/hooks/useHaptics";
import { SelectedRestaurantDetails } from "@/features/map/components/SelectedRestaurantDetails";
import i18n from "@/lib/i18n";
import { useLogger } from "@/hooks/useLogger";
import { PrimaryButton } from "@/components/PrimaryButton";

export default function MapScreen() {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const [selectedPlace, setSelectedPlace] = useState<QueryRestaurantsResponse[number] | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [restaurants, setRestaurants] = useState<QueryRestaurantsResponse>([]);
	const [isLoadingRestaurants, setIsLoadingRestaurants] = useState(false);
	const {
		BlurModal: RestaurantBlurModal,
		open: openRestaurantModal,
		close: closeRestaurantModal,
	} = useBlurModal({ intensity: 100 });

	const mapRef = useRef<any>(null);
	const { getLocationDetails, getCurrentLocation } = useLocationSearch();

	const [currentRegion, setCurrentRegion] = useState<Region>({
		latitude: 35.6762,
		longitude: 139.6503,
		latitudeDelta: 0.01,
		longitudeDelta: 0.01,
	});

	// Search nearby restaurants when region changes
	const searchNearbyRestaurants = useCallback(
		async (region: Region) => {
			if (isLoadingRestaurants) return;

			setIsLoadingRestaurants(true);
			try {
				const results = await callBackend<QueryRestaurantsDto, QueryRestaurantsResponse>("v1/restaurants/search", {
					method: "GET",
					requestPayload: {
						lat: region.latitude,
						lng: region.longitude,
						radius: Math.max(region.latitudeDelta, region.longitudeDelta) * 50000, // Approximate radius based on map view
						limit: 16,
					},
				});
				setRestaurants(results);
				logFrontendEvent({
					event_name: "restaurant_search_success",
					error_level: "log",
					payload: { count: results.length, lat: region.latitude, lng: region.longitude },
				});
			} catch (error) {
				logFrontendEvent({
					event_name: "restaurant_search_error",
					error_level: "error",
					payload: { error, lat: region.latitude, lng: region.longitude },
				});
			} finally {
				setIsLoadingRestaurants(false);
			}
		},
		[callBackend, isLoadingRestaurants, logFrontendEvent],
	);

	useEffect(() => {
		getCurrentLocation().then(({ location }) => {
			const newRegion = {
				latitude: location.latitude,
				longitude: location.longitude,
				latitudeDelta: 0.01,
				longitudeDelta: 0.01,
			};
			setCurrentRegion(newRegion);
			mapRef.current?.animateToRegion(newRegion, 1000);
			// Search restaurants at current location
			searchNearbyRestaurants(newRegion);
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Handle region change with debouncing
	const handleRegionChangeComplete = useCallback((region: Region) => {
		setCurrentRegion(region);
	}, []);

	const handleMarkerPress = (bid: QueryRestaurantsResponse[number]) => {
		lightImpact();
		setSelectedPlace(bid);
		openRestaurantModal();
	};

	const handleSearchSelect = async (prediction: AutocompleteLocation) => {
		lightImpact();
		try {
			const { location } = await getLocationDetails(prediction);
			const newRegion = {
				latitude: location.latitude,
				longitude: location.longitude,
				latitudeDelta: 0.01,
				longitudeDelta: 0.01,
			};
			setCurrentRegion(newRegion);
			mapRef.current?.animateToRegion(newRegion, 1000);
			setSearchQuery("");
		} catch (error) {
			logFrontendEvent({
				event_name: "MapSearchError",
				error_level: "error",
				payload: { error, prediction },
			});
		}
	};

	const handleCurrentLocation = async () => {
		lightImpact();
		try {
			const { location } = await getCurrentLocation();
			const newRegion = {
				latitude: location.latitude,
				longitude: location.longitude,
				latitudeDelta: 0.01,
				longitudeDelta: 0.01,
			};
			setCurrentRegion(newRegion);
			mapRef.current?.animateToRegion(newRegion, 1000);
		} catch (error) {
			logFrontendEvent({
				event_name: "MapCurrentLocationError",
				error_level: "error",
				payload: { error },
			});
		}
	};

	return (
		<SafeAreaView style={styles.container} edges={["left", "right", "bottom"]}>
			{/* Map */}
			<MapView
				ref={mapRef}
				style={styles.map}
				region={currentRegion}
				onRegionChangeComplete={handleRegionChangeComplete}>
				{restaurants.map((restaurantData: QueryRestaurantsResponse[number]) => (
					<AvatarBubbleMarker
						key={restaurantData.restaurant.id}
						coordinate={{
							latitude: restaurantData.restaurant.latitude,
							longitude: restaurantData.restaurant.longitude,
						}}
						onPress={() => handleMarkerPress(restaurantData)}
						color="#FFF"
						uri={restaurantData.restaurant.image_url}
					/>
				))}
			</MapView>

			{/* Search Bar */}
			<View style={styles.searchContainer}>
				<LocationAutocomplete
					value={searchQuery}
					onChangeText={setSearchQuery}
					onSelectSuggestion={handleSearchSelect}
					onClear={() => setSearchQuery("")}
					placeholder={i18n.t("Map.placeholders.searchRestaurants")}
					renderInputRight={
						<TouchableOpacity style={styles.currentLocationButton} onPress={handleCurrentLocation}>
							<Navigation size={20} color="#5EA2FF" />
						</TouchableOpacity>
					}
				/>
			</View>

			{/* Search This Area Button */}
			<View style={styles.bottomActionContainer}>
				<PrimaryButton
					label={i18n.t("Map.buttons.searchNearby")}
					onPress={() => searchNearbyRestaurants(currentRegion)}
					colors={["#ffffff", "#ffffff"]}
					labelStyle={{ color: "#000" }}
					loading={isLoadingRestaurants}
				/>
			</View>

			<RestaurantBlurModal>
				{selectedPlace && (
					<SelectedRestaurantDetails
						id={selectedPlace.restaurant.google_place_id}
						totalCents={selectedPlace.meta.totalCents}
						maxEndDate={selectedPlace.meta.maxEndDate}
					/>
				)}
			</RestaurantBlurModal>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#000",
	},
	map: {
		flex: 1,
	},
	searchContainer: {
		position: "absolute",
		top: 50,
		left: 16,
		right: 16,
		zIndex: 10,
	},
	bottomActionContainer: {
		position: "absolute",
		bottom: 20,
		left: 16,
		right: 16,
		zIndex: 10,
	},
	currentLocationButton: {
		padding: 16,
		borderLeftWidth: 0.5,
		borderLeftColor: "#E5E7EB",
	},
});
