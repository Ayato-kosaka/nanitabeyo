import React, { useState, useRef, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MapPin, Search, Navigation } from "lucide-react-native";
import MapView, { Region } from "@/components/MapView";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import type { AutocompleteLocation, QueryRestaurantsResponse } from "@shared/api/v1/res";
import { AvatarBubbleMarker } from "@/components/AvatarBubbleMarker";
import { useBlurModal } from "@/hooks/useBlurModal";
import { mockActiveBids } from "@/features/map/constants";
import { useHaptics } from "@/hooks/useHaptics";
import { SelectedRestaurantDetails } from "@/features/map/components/SelectedRestaurantDetails";
import i18n from "@/lib/i18n";
import { useLogger } from "@/hooks/useLogger";

export default function MapScreen() {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const [selectedPlace, setSelectedPlace] = useState<QueryRestaurantsResponse[number] | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const {
		BlurModal: RestaurantBlurModal,
		open: openRestaurantModal,
		close: closeRestaurantModal,
	} = useBlurModal({ intensity: 100 });

	const mapRef = useRef<any>(null);
	const { suggestions, getLocationDetails, searchLocations, getCurrentLocation } = useLocationSearch();

	const [currentRegion, setCurrentRegion] = useState<Region>({
		latitude: 35.6762,
		longitude: 139.6503,
		latitudeDelta: 0.01,
		longitudeDelta: 0.01,
	});

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
		});
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
			<MapView ref={mapRef} style={styles.map} region={currentRegion} onRegionChangeComplete={setCurrentRegion}>
				{mockActiveBids.map((bid) => (
					<AvatarBubbleMarker
						key={bid.restaurant.id}
						coordinate={{ latitude: bid.restaurant.latitude, longitude: bid.restaurant.longitude }}
						onPress={() => handleMarkerPress(bid)}
						color="#FFF"
						uri={bid.restaurant.image_url}
					/>
				))}
			</MapView>

			{/* Search Bar */}
			<View style={styles.searchContainer}>
				<View style={styles.searchBar}>
					<Search size={20} color="#666" />
					<TextInput
						style={styles.searchInput}
						placeholder={i18n.t("Map.placeholders.searchRestaurants")}
						value={searchQuery}
						onChangeText={(text) => {
							setSearchQuery(text);
							if (text.length >= 2) {
								searchLocations(text);
							}
						}}
					/>
				</View>

				{suggestions.length > 0 && (
					<View style={styles.suggestionsContainer}>
						<FlatList
							data={suggestions}
							keyExtractor={(item) => item.place_id}
							renderItem={({ item }) => (
								<TouchableOpacity style={styles.suggestionItem} onPress={() => handleSearchSelect(item)}>
									<MapPin size={16} color="#666" />
									<Text style={styles.suggestionText}>{item.text}</Text>
								</TouchableOpacity>
							)}
						/>
					</View>
				)}
			</View>

			{/* Current Location FAB */}
			<TouchableOpacity style={styles.fab} onPress={handleCurrentLocation}>
				<Navigation size={24} color="#FFF" />
			</TouchableOpacity>

			{/* Bottom Sheet */}
			<RestaurantBlurModal>
				{selectedPlace && <SelectedRestaurantDetails id={selectedPlace.restaurant.google_place_id} />}
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
	searchBar: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#FFF",
		borderRadius: 25,
		paddingHorizontal: 16,
		paddingVertical: 12,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 4,
		elevation: 3,
	},
	searchInput: {
		flex: 1,
		marginLeft: 8,
		fontSize: 16,
	},
	suggestionsContainer: {
		backgroundColor: "#FFF",
		borderRadius: 12,
		marginTop: 8,
		maxHeight: 200,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 4,
		elevation: 3,
	},
	suggestionItem: {
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 16,
		paddingVertical: 12,
		borderBottomWidth: 1,
		borderBottomColor: "#F0F0F0",
	},
	suggestionText: {
		marginLeft: 8,
		fontSize: 14,
		color: "#333",
	},
	fab: {
		position: "absolute",
		bottom: 30,
		right: 20,
		backgroundColor: "#007AFF",
		borderRadius: 28,
		padding: 16,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.4,
		shadowRadius: 8,
		elevation: 8,
	},
});
