import React, { useState, useCallback, use, useEffect } from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView, LayoutChangeEvent } from "react-native";
import { Camera, DollarSign } from "lucide-react-native";
import { Card } from "@/components/Card";
import Stars from "@/components/Stars";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ImageCard } from "@/components/ImageCardGrid";
import i18n from "@/lib/i18n";
import { mockActiveBids, mockBidHistory } from "@/features/map/constants";
import { useBlurModal } from "@/hooks/useBlurModal";
import { useHaptics } from "@/hooks/useHaptics";
import { ReviewForm } from "@/features/map/components/ReviewForm";
import { BidForm } from "@/features/map/components/BidForm";
import { Tabs, GridList } from "@/components/collapsible-tabs";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import { useSharedValueState } from "@/hooks/useSharedValueState";
import { QueryRestaurantDishMediaResponse, QueryRestaurantsResponse } from "@shared/api/v1/res";
import { mockDishItems } from "@/data/searchMockData";
import { useLogger } from "@/hooks/useLogger";
import { SupabaseRestaurantBids } from "@shared/converters/convert_restaurant_bids";

type BidStatus = { id: SupabaseRestaurantBids["status"]; label: string; color: string };
type Props = {
	id: string;
};

function RestaurantTabsBar({ tabNames, index, onTabPress }: TabBarProps<string>) {
	const currentIndex = useSharedValueState(index);
	return (
		<View style={styles.tabContainer}>
			{tabNames.map((name, i) => {
				const isActive = currentIndex === i;
				const label = name === "reviews" ? i18n.t("Map.tabs.reviews") : i18n.t("Map.tabs.bids");
				return (
					<TouchableOpacity
						key={name}
						style={[styles.tab, isActive && styles.activeTab]}
						onPress={() => onTabPress(name)}>
						<Text style={[styles.tabText, isActive && styles.activeTabText]}>{label}</Text>
					</TouchableOpacity>
				);
			})}
		</View>
	);
}

export function SelectedRestaurantDetails({ id }: Props) {
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const [selectedPlace, setSelectedPlace] = useState<QueryRestaurantsResponse[number] | null>(null);

	// Bid status filters
	const bidStatuses: BidStatus[] = [
		{ id: "pending", label: i18n.t("Profile.statusLabels.active"), color: "#4CAF50" },
		{ id: "paid", label: i18n.t("Profile.statusLabels.completed"), color: "#2196F3" },
		{ id: "refunded", label: i18n.t("Profile.statusLabels.refunded"), color: "#FF9800" },
	];
	const [selectedBidStatuses, setSelectedBidStatuses] = useState<string[]>(bidStatuses.map((b) => b.id));
	const toggleBidStatus = (statusId: string) => {
		lightImpact();
		setSelectedBidStatuses((prev) =>
			prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId],
		);
	};
	const filteredBidHistory = mockBidHistory.filter((bid) => selectedBidStatuses.includes(bid.status));

	// Modals
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

	// Processing state for submit actions
	const [isProcessing, setIsProcessing] = useState(false);

	useEffect(() => {
		// TODO: GET /v1/restaurants を呼び出す
		setSelectedPlace(mockActiveBids.find((bid) => bid.restaurant.google_place_id === id) || null);
	}, [id]);

	const handleBid = async (bidAmount: string) => {
		if (!bidAmount) return;
		mediumImpact();
		setIsProcessing(true);
		try {
			await new Promise((resolve) => setTimeout(resolve, 2000));
			logFrontendEvent({
				event_name: "restaurant_bid_submitted",
				error_level: "log",
				payload: { restaurantId: selectedPlace?.restaurant.id, bidAmount: Number(bidAmount) },
			});
			closeBidModal();
		} catch {
			logFrontendEvent({
				event_name: "restaurant_bid_submission_failed",
				error_level: "error",
				payload: { restaurantId: selectedPlace?.restaurant.id, bidAmount: Number(bidAmount) },
			});
		} finally {
			setIsProcessing(false);
		}
	};

	const handleReviewSubmit = async (data: { price: string; reviewText: string; rating: number }) => {
		if (!data.reviewText || !data.price) return;
		mediumImpact();
		setIsProcessing(true);
		try {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			logFrontendEvent({
				event_name: "restaurant_review_submitted",
				error_level: "log",
				payload: { restaurantId: selectedPlace?.restaurant.id, rating: data.rating },
			});
			closeReviewModal();
		} catch {
			logFrontendEvent({
				event_name: "restaurant_review_submission_failed",
				error_level: "error",
				payload: { restaurantId: selectedPlace?.restaurant.id, rating: data.rating },
			});
		} finally {
			setIsProcessing(false);
		}
	};

	// Collapsible header
	const [headerHeight, setHeaderHeight] = useState(0);
	const handleHeaderLayout = useCallback((event: LayoutChangeEvent) => {
		setHeaderHeight(event.nativeEvent.layout.height);
	}, []);

	const renderHeader = useCallback(() => {
		return selectedPlace ? (
			<View onLayout={handleHeaderLayout}>
				<Card>
					<View style={styles.restaurantInfo}>
						<Image source={{ uri: selectedPlace.restaurant.image_url }} style={styles.restaurantAvatar} />
						<View style={styles.restaurantDetails}>
							<Text style={styles.restaurantName}>{selectedPlace.restaurant.name}</Text>
							<View style={styles.ratingContainer}>
								<Stars rating={selectedPlace.restaurant.averageRating} />
								<Text style={styles.ratingText}>{selectedPlace.restaurant.averageRating}</Text>
								<Text style={styles.reviewCount}>({selectedPlace.restaurant.reviewCount})</Text>
							</View>
						</View>
					</View>
				</Card>

				<View style={styles.bidAmountContainer}>
					<Text style={styles.bidAmountLabel}>{i18n.t("Map.labels.currentBidAmount")}</Text>
					<Text style={styles.bidAmount}>
						{i18n.t("Search.currencySuffix")}
						{selectedPlace.meta.totalCents.toLocaleString()}
					</Text>
					<Text style={styles.remainingDays}>
						{i18n.t("Common.daysRemaining", {
							count: selectedPlace.meta.maxEndDate
								? Math.max(
										0,
										Math.ceil(
											(new Date(selectedPlace.meta.maxEndDate).getTime() - new Date().getTime()) /
												(1000 * 60 * 60 * 24),
										),
									)
								: 0,
						})}
					</Text>
				</View>

				<View style={styles.actionButtons}>
					<PrimaryButton
						onPress={openReviewModal}
						label={i18n.t("Map.buttons.postReview")}
						icon={<Camera size={20} color="#FFF" />}
						borderRadius={8}
						style={{ flex: 1 }}
					/>
					<PrimaryButton
						onPress={openBidModal}
						label={i18n.t("Map.buttons.placeBid")}
						icon={<DollarSign size={20} color="#FFF" />}
						borderRadius={8}
						style={{ flex: 1 }}
					/>
				</View>
			</View>
		) : (
			<Card />
		);
	}, [handleHeaderLayout, openReviewModal, openBidModal, selectedPlace]);

	const renderTabBar = useCallback((props: TabBarProps<string>) => <RestaurantTabsBar {...props} />, []);

	const renderReviewItem = useCallback(
		({ item }: { item: QueryRestaurantDishMediaResponse["data"][number] }) => (
			<ImageCard item={{ id: item.dish_media.id, imageUrl: item.dish_media.thumbnailImageUrl }}>
				<View style={styles.reviewCardOverlay}>
					<Text style={styles.reviewCardTitle}>{item.dish.name}</Text>
					<View style={styles.reviewCardRating}>
						<Stars rating={item.dish.averageRating} />
						<Text style={styles.reviewCardRatingText}>({item.dish.reviewCount})</Text>
					</View>
				</View>
			</ImageCard>
		),
		[],
	);

	const renderBidHeader = useCallback(
		() => (
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				style={styles.statusFilterContainer}
				contentContainerStyle={styles.statusFilterContent}>
				{bidStatuses.map((status) => (
					<TouchableOpacity
						key={status.id}
						style={[styles.statusChip, selectedBidStatuses.includes(status.id) && { backgroundColor: status.color }]}
						onPress={() => toggleBidStatus(status.id)}>
						<Text
							style={[styles.statusChipText, selectedBidStatuses.includes(status.id) && styles.statusChipTextActive]}>
							{status.label}
						</Text>
					</TouchableOpacity>
				))}
			</ScrollView>
		),
		[bidStatuses, selectedBidStatuses, toggleBidStatus],
	);

	const renderBidItem = useCallback(
		({ item }: { item: (typeof filteredBidHistory)[number] }) => (
			<View style={styles.bidHistoryCard}>
				<View style={styles.bidHistoryHeader}>
					<Text style={styles.bidHistoryAmount}>
						{i18n.t("Search.currencySuffix")}
						{item.amount_cents.toLocaleString()}
					</Text>
					<View
						style={[
							styles.bidStatusChip,
							{ backgroundColor: bidStatuses.find((b) => b.id === item.status)?.color || "#666" },
						]}>
						<Text style={styles.bidStatusText}>
							{bidStatuses.find((b) => b.id === item.status)?.label || item.status}
						</Text>
					</View>
				</View>
				<Text style={styles.bidHistoryDate}>{item.end_date}</Text>
				<Text style={styles.bidHistoryDays}>
					{i18n.t("Common.daysRemaining", {
						count: Math.max(
							0,
							Math.ceil((new Date(item.end_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)),
						),
					})}
				</Text>
			</View>
		),
		[],
	);

	const renderBidEmpty = useCallback(
		() => (
			<View style={styles.emptyState}>
				<Text style={styles.emptyStateText}>{i18n.t("Map.empty.bidHistory")}</Text>
			</View>
		),
		[],
	);

	return (
		<View style={styles.container}>
			<Tabs.Container
				renderHeader={renderHeader}
				headerHeight={headerHeight}
				renderTabBar={renderTabBar}
				headerContainerStyle={{ shadowColor: "transparent" }}
				containerStyle={{ backgroundColor: "white" }}>
				<Tabs.Tab name="reviews">
					<GridList
						data={mockDishItems.map((item) => ({ ...item, id: item.dish_media.id }))}
						renderItem={renderReviewItem}
						numColumns={3}
						contentContainerStyle={styles.reviewsContent}
						columnWrapperStyle={styles.reviewsRow}
					/>
				</Tabs.Tab>
				<Tabs.Tab name="bids">
					<Tabs.FlatList
						data={filteredBidHistory}
						renderItem={renderBidItem}
						keyExtractor={(item) => item.id}
						ListHeaderComponent={renderBidHeader}
						ListEmptyComponent={renderBidEmpty}
						contentContainerStyle={styles.bidsContent}
					/>
				</Tabs.Tab>
			</Tabs.Container>

			{/* Review Modal */}
			<ReviewBlurModal>
				{({ close }) => <ReviewForm onSubmit={handleReviewSubmit} onCancel={close} isProcessing={isProcessing} />}
			</ReviewBlurModal>

			{/* Bid Modal */}
			<BidBlurModal>
				{({ close }) => <BidForm onSubmit={handleBid} onCancel={close} isProcessing={isProcessing} />}
			</BidBlurModal>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
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
	reviewsContent: {
		paddingHorizontal: 16,
		paddingVertical: 8,
	},
	reviewsRow: {
		gap: 1,
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
		borderWidth: 0,
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
