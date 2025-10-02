import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity, LayoutChangeEvent } from "react-native";
import { Camera, DollarSign } from "lucide-react-native";
import { Card } from "@/components/Card";
import Stars from "@/components/Stars";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { useBlurModal } from "@/hooks/useBlurModal";
import { useHaptics } from "@/hooks/useHaptics";
import { ReviewForm } from "@/features/map/components/ReviewForm";
import { BidForm } from "@/features/map/components/BidForm";
import { RestaurantReviewsTab } from "@/features/map/components/tabs/RestaurantReviewsTab";
import { RestaurantBidsTab } from "@/features/map/components/tabs/RestaurantBidsTab";
import { Tabs } from "@/components/collapsible-tabs";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import { useSharedValueState } from "@/hooks/useSharedValueState";
import type { CreateRestaurantResponse } from "@shared/api/v1/res";
import { useLogger } from "@/hooks/useLogger";

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

export function SelectedRestaurantDetails(restaurant: CreateRestaurantResponse) {
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

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

	const handleBid = async (bidAmount: string) => {
		if (!bidAmount) return;
		mediumImpact();
		setIsProcessing(true);
		try {
			await new Promise((resolve) => setTimeout(resolve, 2000));
			logFrontendEvent({
				event_name: "restaurant_bid_submitted",
				error_level: "log",
				payload: { restaurantId: restaurant?.id, bidAmount: Number(bidAmount) },
			});
			closeBidModal();
		} catch {
			logFrontendEvent({
				event_name: "restaurant_bid_submission_failed",
				error_level: "error",
				payload: { restaurantId: restaurant?.id, bidAmount: Number(bidAmount) },
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
				payload: { restaurantId: restaurant?.id, rating: data.rating },
			});
			closeReviewModal();
		} catch {
			logFrontendEvent({
				event_name: "restaurant_review_submission_failed",
				error_level: "error",
				payload: { restaurantId: restaurant?.id, rating: data.rating },
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
		return restaurant ? (
			<View onLayout={handleHeaderLayout}>
				<Card>
					<View style={styles.restaurantInfo}>
						<Image source={{ uri: restaurant.image_url }} style={styles.restaurantAvatar} />
						<View style={styles.restaurantDetails}>
							<Text style={styles.restaurantName}>{restaurant.name}</Text>
							<View style={styles.ratingContainer}>
								<Stars rating={restaurant.averageRating} />
								<Text style={styles.ratingText}>{restaurant.averageRating}</Text>
								<Text style={styles.reviewCount}>({restaurant.reviewCount})</Text>
							</View>
						</View>
					</View>
				</Card>

				{restaurant.maxEndDate && (
					<View style={styles.bidAmountContainer}>
						<Text style={styles.bidAmountLabel}>{i18n.t("Map.labels.currentBidAmount")}</Text>
						<Text style={styles.bidAmount}>
							{i18n.t("Search.currencySuffix")}
							{restaurant.totalCents.toLocaleString()}
						</Text>
						<Text style={styles.remainingDays}>
							{i18n.t("Common.daysRemaining", {
								count: Math.max(
									0,
									Math.ceil((new Date(restaurant.maxEndDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)),
								),
							})}
						</Text>
					</View>
				)}

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
	}, [handleHeaderLayout, openReviewModal, openBidModal, restaurant]);

	const renderTabBar = useCallback((props: TabBarProps<string>) => <RestaurantTabsBar {...props} />, []);

	return (
		<View style={styles.container}>
			<Tabs.Container
				renderHeader={renderHeader}
				headerHeight={headerHeight}
				renderTabBar={renderTabBar}
				headerContainerStyle={{ shadowColor: "transparent" }}
				containerStyle={{ backgroundColor: "white" }}>
				{/* 
					レビュータブ: RestaurantReviewsTabコンポーネントを使用
					useCursorPaginationでレストランの料理メディアを取得し、
					既存のGridListレイアウトを完全に維持
				*/}
				<Tabs.Tab name="reviews">
					<RestaurantReviewsTab restaurantId={restaurant.id} />
				</Tabs.Tab>
				{/* 
					入札タブ: RestaurantBidsTabコンポーネントを使用
					useCursorPaginationでレストランの入札履歴を取得し、
					既存のFlatListレイアウトとフィルター機能を完全に維持
				*/}
				<Tabs.Tab name="bids">
					<RestaurantBidsTab restaurantId={restaurant.id} />
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
});
