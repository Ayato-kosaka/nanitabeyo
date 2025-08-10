import React, { useState, useRef, useEffect } from "react";
import {
	View,
	Text,
	StyleSheet,
	TouchableOpacity,
	Modal,
	TextInput,
	ScrollView,
	Image,
	Alert,
	ActivityIndicator,
	FlatList,
	Dimensions,
} from "react-native";
import { MapPin, Search, Navigation, Camera, DollarSign, Star, Calendar, X, Plus } from "lucide-react-native";
import MapView, { Marker, Region } from "@/components/MapView";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { GooglePlacesPrediction } from "@/types/search";
import { AvatarBubbleMarker } from "@/components/AvatarBubbleMarker";
import { useBlurModal } from "@/hooks/useBlurModal";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ImageCardGrid } from "@/components/ImageCardGrid";
import i18n from "@/lib/i18n";
import { formatCurrencyForDisplay } from "@/lib/currency";
import { ActiveBid, Review, mockActiveBids, mockReviews, mockBidHistory } from "@/features/map/constants";
import { getBidStatusColor, getBidStatusText } from "@/features/map/utils";
import Stars from "@/components/Stars";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";

const { width, height } = Dimensions.get("window");

export default function MapScreen() {
	const { lightImpact, mediumImpact } = useHaptics();
	const locale = useLocale();
	const [selectedPlace, setSelectedPlace] = useState<ActiveBid | null>(null);
	const [selectedTab, setSelectedTab] = useState<"reviews" | "bids">("reviews");
	const [searchQuery, setSearchQuery] = useState("");
	const [bidAmount, setBidAmount] = useState("");
	const [reviewText, setReviewText] = useState("");
	const [rating, setRating] = useState(5);
	const [price, setPrice] = useState("");
	const [isProcessing, setIsProcessing] = useState(false);
	const {
		BlurModal: RestaurantBlurModal,
		open: openRestaurantModal,
		close: closeRestaurantModal,
	} = useBlurModal({ intensity: 100 });
	const {
		BlurModal: ReviewBlurModal,
		open: openReviewModal,
		close: closeReviewModal,
	} = useBlurModal({ intensity: 100, zIndex: 1200 });
	const {
		BlurModal: BidBlurModal,
		open: openBidModal,
		close: closeBidModal,
	} = useBlurModal({ intensity: 100, zIndex: 1300 });

	const mapRef = useRef<any>(null);
	const { suggestions, isSearching, searchLocations, getLocationDetails, getCurrentLocation } = useLocationSearch();

	const [currentRegion, setCurrentRegion] = useState<Region>({
		latitude: 35.6762,
		longitude: 139.6503,
		latitudeDelta: 0.01,
		longitudeDelta: 0.01,
	});

	const [selectedBidStatuses, setSelectedBidStatuses] = useState<string[]>(["active", "completed", "refunded"]);
	useEffect(() => {
		getCurrentLocation().then((location) => {
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

	const handleMarkerPress = (bid: ActiveBid) => {
		lightImpact();
		setSelectedPlace(bid);
		openRestaurantModal();
	};

	const handleSearchSelect = async (prediction: GooglePlacesPrediction) => {
		lightImpact();
		try {
			const location = await getLocationDetails(prediction);
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
			Alert.alert(i18n.t("Common.error"), i18n.t("Map.alerts.locationError"));
		}
	};

	const handleCurrentLocation = async () => {
		lightImpact();
		try {
			const location = await getCurrentLocation();
			const newRegion = {
				latitude: location.latitude,
				longitude: location.longitude,
				latitudeDelta: 0.01,
				longitudeDelta: 0.01,
			};
			setCurrentRegion(newRegion);
			mapRef.current?.animateToRegion(newRegion, 1000);
		} catch (error) {
			Alert.alert(i18n.t("Common.error"), i18n.t("Map.alerts.currentLocationError"));
		}
	};

	const handleBid = async () => {
		if (!bidAmount || !selectedPlace) return;

		mediumImpact();
		setIsProcessing(true);
		try {
			// Mock Stripe payment processing
			await new Promise((resolve) => setTimeout(resolve, 2000));
			Alert.alert(
				i18n.t("Common.success"),
				i18n.t("Map.alerts.bidSuccess", {
					place: selectedPlace.placeName,
					amount: parseInt(bidAmount).toLocaleString(),
				}),
			);
			closeBidModal();
			setBidAmount("");
		} catch (error) {
			Alert.alert(i18n.t("Common.error"), i18n.t("Map.alerts.bidError"));
		} finally {
			setIsProcessing(false);
		}
	};

	const handleReviewSubmit = async () => {
		if (!reviewText || !price) return;

		mediumImpact();
		setIsProcessing(true);
		try {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			Alert.alert(i18n.t("Common.success"), i18n.t("Map.alerts.reviewSuccess"));
			closeReviewModal();
			setReviewText("");
			setPrice("");
			setRating(5);
		} catch (error) {
			Alert.alert(i18n.t("Common.error"), i18n.t("Map.alerts.reviewError"));
		} finally {
			setIsProcessing(false);
		}
	};

	const bidStatuses = [
		{ id: "active", label: i18n.t("Profile.statusLabels.active"), color: "#4CAF50" },
		{ id: "completed", label: i18n.t("Profile.statusLabels.completed"), color: "#2196F3" },
		{ id: "refunded", label: i18n.t("Profile.statusLabels.refunded"), color: "#FF9800" },
	];

	const toggleBidStatus = (statusId: string) => {
		lightImpact();
		setSelectedBidStatuses((prev) =>
			prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId],
		);
	};

	const handleTabSelect = (tab: "reviews" | "bids") => {
		lightImpact();
		setSelectedTab(tab);
	};

	const filteredBidHistory = mockBidHistory.filter((bid) => selectedBidStatuses.includes(bid.status));

	return (
		<View style={styles.container}>
			{/* Map */}
			<MapView ref={mapRef} style={styles.map} region={currentRegion} onRegionChangeComplete={setCurrentRegion}>
				{mockActiveBids.map((bid) => (
					<AvatarBubbleMarker
						key={bid.placeId}
						coordinate={{ latitude: bid.latitude, longitude: bid.longitude }}
						onPress={() => handleMarkerPress(bid)}
						color="#FFF"
						uri={bid.imageUrl}
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
							keyExtractor={(item) => item.placeId}
							renderItem={({ item }) => (
								<TouchableOpacity style={styles.suggestionItem} onPress={() => handleSearchSelect(item)}>
									<MapPin size={16} color="#666" />
									<Text style={styles.suggestionText}>{item.description}</Text>
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
				{selectedPlace && (
					<>
						<Card>
							<View style={styles.restaurantInfo}>
								<Image source={{ uri: selectedPlace.imageUrl }} style={styles.restaurantAvatar} />
								<View style={styles.restaurantDetails}>
									<Text style={styles.restaurantName}>{selectedPlace.placeName}</Text>
									<View style={styles.ratingContainer}>
										<Stars rating={selectedPlace.rating} />
										<Text style={styles.ratingText}>{selectedPlace.rating}</Text>
										<Text style={styles.reviewCount}>({selectedPlace.reviewCount})</Text>
									</View>
								</View>
							</View>
						</Card>

						<View style={styles.bidAmountContainer}>
							<Text style={styles.bidAmountLabel}>{i18n.t("Map.labels.currentBidAmount")}</Text>
							<Text style={styles.bidAmount}>
								{formatCurrencyForDisplay(selectedPlace.totalAmount, locale)}
							</Text>
							<Text style={styles.remainingDays}>
								{i18n.t("Common.daysRemaining", {
									count: selectedPlace.remainingDays,
								})}
							</Text>
						</View>

						{/* Action Buttons */}
						<View style={styles.actionButtons}>
							<PrimaryButton
								onPress={() => openReviewModal()}
								label={i18n.t("Map.buttons.postReview")}
								icon={<Camera size={20} color="#FFF" />}
								borderRadius={8}
								style={{ flex: 1 }}
							/>
							<PrimaryButton
								onPress={() => openBidModal()}
								label={i18n.t("Map.buttons.placeBid")}
								icon={<DollarSign size={20} color="#FFF" />}
								borderRadius={8}
								style={{ flex: 1 }}
							/>
						</View>

						{/* Tabs */}
						<View style={styles.tabContainer}>
							<TouchableOpacity
								style={[styles.tab, selectedTab === "reviews" && styles.activeTab]}
								onPress={() => handleTabSelect("reviews")}>
								<Text style={[styles.tabText, selectedTab === "reviews" && styles.activeTabText]}>
									{i18n.t("Map.tabs.reviews")}
								</Text>
							</TouchableOpacity>
							<TouchableOpacity
								style={[styles.tab, selectedTab === "bids" && styles.activeTab]}
								onPress={() => handleTabSelect("bids")}>
								<Text style={[styles.tabText, selectedTab === "bids" && styles.activeTabText]}>
									{i18n.t("Map.tabs.bids")}
								</Text>
							</TouchableOpacity>
						</View>

						{/* Tab Content */}
						{selectedTab === "reviews" ? (
							<ImageCardGrid
								data={mockReviews}
								renderOverlay={(review) => (
									<View style={styles.reviewCardOverlay}>
										<Text style={styles.reviewCardTitle}>{review.dishName}</Text>
										<View style={styles.reviewCardRating}>
											<Stars rating={review.rating} />
											<Text style={styles.reviewCardRatingText}>({review.reviewCount})</Text>
										</View>
									</View>
								)}
							/>
						) : (
							<View style={styles.bidsContent}>
								{/* Status Filter Chips */}
								<ScrollView
									horizontal
									showsHorizontalScrollIndicator={false}
									style={styles.statusFilterContainer}
									contentContainerStyle={styles.statusFilterContent}>
									{bidStatuses.map((status) => (
										<TouchableOpacity
											key={status.id}
											style={[
												styles.statusChip,
												selectedBidStatuses.includes(status.id) && {
													backgroundColor: status.color,
												},
											]}
											onPress={() => toggleBidStatus(status.id)}>
											<Text
												style={[
													styles.statusChipText,
													selectedBidStatuses.includes(status.id) && styles.statusChipTextActive,
												]}>
												{status.label}
											</Text>
										</TouchableOpacity>
									))}
								</ScrollView>

								{/* Filtered Bid History */}
								{filteredBidHistory.length > 0 ? (
									filteredBidHistory.map((bid) => (
										<View key={bid.id} style={styles.bidHistoryCard}>
											<View style={styles.bidHistoryHeader}>
												<Text style={styles.bidHistoryAmount}>
													{formatCurrencyForDisplay(bid.amount, locale)}
												</Text>
												<View
													style={[
														styles.bidStatusChip,
														{
															backgroundColor: getBidStatusColor(bid.status),
														},
													]}>
													<Text style={styles.bidStatusText}>{getBidStatusText(bid.status)}</Text>
												</View>
											</View>
											<Text style={styles.bidHistoryDate}>{bid.date}</Text>
											<Text style={styles.bidHistoryDays}>
												{i18n.t("Common.daysRemaining", { count: bid.remainingDays })}
											</Text>
										</View>
									))
								) : (
									<View style={styles.emptyState}>
										<Text style={styles.emptyStateText}>{i18n.t("Map.emptyState.noBidsForStatus")}</Text>
									</View>
								)}
							</View>
						)}
					</>
				)}
			</RestaurantBlurModal>

			{/* Review Modal */}
			<ReviewBlurModal>
				<Card>
					<Text style={styles.inputLabel}>{i18n.t("Map.inputs.price")}</Text>
					<TextInput
						style={styles.textInput}
						placeholder={i18n.t("Map.placeholders.enterPrice")}
						value={price}
						onChangeText={setPrice}
						keyboardType="numeric"
					/>
				</Card>

				<Card>
					<Text style={styles.inputLabel}>{i18n.t("Map.inputs.rating")}</Text>
					<View style={styles.ratingInput}>
						{[1, 2, 3, 4, 5].map((star) => (
							<TouchableOpacity key={star} onPress={() => setRating(star)}>
								<Star size={32} color="#FFD700" fill={star <= rating ? "#FFD700" : "transparent"} />
							</TouchableOpacity>
						))}
					</View>
				</Card>

				<Card>
					<Text style={styles.inputLabel}>{i18n.t("Map.inputs.comment")}</Text>
					<TextInput
						style={[styles.textInput, styles.textArea]}
						placeholder={i18n.t("Map.placeholders.enterReview")}
						value={reviewText}
						onChangeText={setReviewText}
						multiline
						numberOfLines={4}
					/>
				</Card>

				<PrimaryButton
					label={i18n.t("Common.post")}
					onPress={handleReviewSubmit}
					disabled={isProcessing}
					style={{ marginHorizontal: 16 }}
				/>
			</ReviewBlurModal>

			{/* Bid Modal */}
			<BidBlurModal>
				<Card>
					<Text style={styles.inputLabel}>{i18n.t("Map.inputs.bidAmount")}</Text>
					<TextInput
						style={styles.textInput}
						placeholder={i18n.t("Map.placeholders.enterBidAmount")}
						value={bidAmount}
						onChangeText={setBidAmount}
						keyboardType="numeric"
					/>
				</Card>

				<View style={styles.bidInfo}>
					<View style={styles.bidInfoRow}>
						<Calendar size={16} color="#666" />
						<Text style={styles.bidInfoText}>
							{i18n.t("Map.labels.endDate")}{" "}
							{new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString("ja-JP")}
						</Text>
					</View>
				</View>

				{isProcessing && (
					<View style={styles.processingContainer}>
						<ActivityIndicator size="large" color="#007AFF" />
						<Text style={styles.processingText}>{i18n.t("Map.labels.paymentProcessing")}</Text>
					</View>
				)}
				<PrimaryButton
					label={i18n.t("Map.buttons.bid")}
					onPress={handleBid}
					disabled={isProcessing || !bidAmount}
					style={{ marginHorizontal: 16 }}
				/>
			</BidBlurModal>
		</View>
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
	restaurantInfo: {
		flexDirection: "row",
		alignItems: "center",
		marginVertical: 12,
	},
	restaurantAvatar: {
		width: 60,
		height: 60,
		borderRadius: 20,
	},
	restaurantDetails: {
		flex: 1,
		marginLeft: 12,
	},
	restaurantName: {
		fontSize: 18,
		fontWeight: "bold",
		color: "#000",
		marginBottom: 4,
	},
	ratingContainer: {
		flexDirection: "row",
		alignItems: "center",
		marginBottom: 4,
	},
	ratingText: {
		fontSize: 14,
		fontWeight: "600",
		color: "#000",
		marginRight: 4,
	},
	reviewCount: {
		fontSize: 12,
		color: "#666",
	},
	bidAmountContainer: {
		backgroundColor: "#F0F8FF",
		padding: 16,
		borderRadius: 12,
		alignItems: "center",
		marginVertical: 12,
		marginHorizontal: 16,
	},
	bidAmountLabel: {
		fontSize: 12,
		color: "#666",
		marginBottom: 4,
	},
	bidAmount: {
		fontSize: 28,
		fontWeight: "bold",
		color: "#007AFF",
		marginBottom: 4,
	},
	remainingDays: {
		fontSize: 14,
		color: "#666",
	},
	actionButtons: {
		flexDirection: "row",
		gap: 12,
		margin: 16,
	},
	tabContainer: {
		flexDirection: "row",
		marginHorizontal: 16,
		marginBottom: 16,
	},
	tab: {
		flex: 1,
		paddingVertical: 12,
		alignItems: "center",
	},
	activeTab: {
		borderBottomWidth: 2,
		borderBottomColor: "#007AFF",
	},
	tabText: {
		fontSize: 16,
		color: "#666",
		fontWeight: "500",
	},
	activeTabText: {
		color: "#007AFF",
		fontWeight: "600",
	},
	reviewCardOverlay: {
		position: "absolute",
		bottom: 8,
		left: 8,
		right: 8,
		flexDirection: "column",
		justifyContent: "space-between",
	},
	reviewCardTitle: {
		fontSize: 12,
		fontWeight: "600",
		color: "#FFF",
		marginBottom: 4,
	},
	reviewCardRating: {
		flexDirection: "row",
		alignItems: "center",
	},
	reviewCardRatingText: {
		fontSize: 10,
		color: "#FFF",
		marginLeft: 4,
	},
	bidsContent: {
		paddingHorizontal: 16,
		gap: 12,
	},
	bidHistoryCard: {
		backgroundColor: "#F8F9FA",
		padding: 16,
		borderRadius: 12,
	},
	bidHistoryHeader: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		marginBottom: 4,
	},
	bidHistoryAmount: {
		fontSize: 18,
		fontWeight: "bold",
		color: "#007AFF",
	},
	bidHistoryDate: {
		fontSize: 12,
		color: "#666",
		marginBottom: 2,
	},
	bidHistoryDays: {
		fontSize: 12,
		color: "#666",
	},
	bidStatusChip: {
		paddingHorizontal: 12,
		paddingVertical: 4,
		borderRadius: 12,
	},
	bidStatusText: {
		fontSize: 12,
		color: "#FFF",
		fontWeight: "500",
	},
	inputLabel: {
		fontSize: 16,
		fontWeight: "600",
		color: "#000",
		marginBottom: 8,
	},
	textInput: {
		borderWidth: 1,
		borderColor: "#E5E5E5",
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 12,
		fontSize: 16,
		color: "#000",
	},
	textArea: {
		height: 100,
		textAlignVertical: "top",
	},
	ratingInput: {
		flexDirection: "row",
		gap: 8,
	},
	bidInfo: {
		marginHorizontal: 16,
		marginBottom: 24,
	},
	bidInfoRow: {
		flexDirection: "row",
		alignItems: "center",
		marginBottom: 8,
	},
	bidInfoText: {
		fontSize: 14,
		color: "#666",
		marginLeft: 8,
	},
	processingContainer: {
		alignItems: "center",
		paddingVertical: 32,
	},
	processingText: {
		fontSize: 16,
		color: "#666",
		marginTop: 16,
	},
	statusFilterContainer: {
		marginBottom: 16,
	},
	statusFilterContent: {
		paddingHorizontal: 4,
		gap: 8,
	},
	statusChip: {
		paddingHorizontal: 16,
		paddingVertical: 8,
		borderRadius: 20,
		borderColor: "#E0E0E0",
		marginHorizontal: 4,
	},
	statusChipText: {
		fontSize: 14,
		color: "#666",
		fontWeight: "500",
	},
	statusChipTextActive: {
		color: "#FFF",
		fontWeight: "600",
	},
	emptyState: {
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: 40,
	},
	emptyStateText: {
		fontSize: 16,
		color: "#666",
		textAlign: "center",
	},
});
