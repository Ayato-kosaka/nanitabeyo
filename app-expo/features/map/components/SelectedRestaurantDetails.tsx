import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent, Platform } from "react-native";
import { Camera, DollarSign, ExternalLink } from "lucide-react-native";
import { Card } from "@/components/Card";
import Stars from "@/components/Stars";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { useHaptics } from "@/hooks/useHaptics";
import { ReviewForm } from "@/features/map/components/ReviewForm";
import { BidForm } from "@/features/map/components/BidForm";
import { RestaurantReviewsTab } from "@/features/map/components/tabs/RestaurantReviewsTab";
import { RestaurantBidsTab } from "@/features/map/components/tabs/RestaurantBidsTab";
import { Tabs } from "@/components/collapsible-tabs";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import { useSharedValueState } from "@/hooks/useSharedValueState";
import type { QueryRestaurantsResponse } from "@shared/api/v1/res";
import { useLogger } from "@/hooks/useLogger";
import { getGoogleMapsLink } from "@/lib/googlePlaces";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useSafeAreaFrame } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { getCacheKeyForImage } from "@/lib/image";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { useLocale } from "@/hooks/useLocale";
import { router } from "expo-router";

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

export function SelectedRestaurantDetails({ restaurant, meta: restaurantMeta }: QueryRestaurantsResponse[number]) {
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { showSnackbar } = useSnackbar();
	const frame = useSafeAreaFrame(); // Safe Area を除いたフレームの高さ
	const { user } = useAuth();
	const { locale } = useLocale();

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

	const handleReviewButtonPress = async () => {
		lightImpact();
		// #477【設計】匿名ユーザーの場合はログイン導線へ、非匿名ユーザーの場合は ReviewForm を表示
		// #1092 PR4b 【修正】`user?.is_anonymous !== false` から共通判定（lib/authGuest.ts）へ寄せた。
		// 旧式は is_anonymous が undefined のときもゲストへ倒れ、レビュータブでは投稿できるのに
		// ここではログイン導線が出る、という画面間の食い違いになる
		if (isGuestUser(user)) {
			// #1359 【設計】この画面は地図（app/[locale]/(tabs)/map.tsx）の useState で選ばれた店を
			// BlurModal で重ねたもので、**選択中の店は URL にも zustand にも無い**。
			// そのため `next` では店の選択まで復元できず、地図タブへ戻すのが限界になる
			//（現行の web も OAuth の全画面リダイレクトで選択を失っているので、後退ではない）。
			// 通常導線では push が履歴を残すため、戻る導線が canGoBack 側に倒れて
			// 画面内 state ごと復帰できる（lib/authNext.ts の resolvePostLoginTarget）。
			router.push({ pathname: "/[locale]/auth/login", params: { locale, next: `/${locale}/map` } });
		} else {
			// ReviewForm を開くと同時にメディア選択が行われる
			openReviewModal();
		}
	};

	const handleOpenGoogleMaps = async () => {
		lightImpact();

		logFrontendEvent({
			event_name: "restaurant_google_maps_clicked",
			error_level: "log",
			payload: {
				restaurantId: restaurant.id,
				restaurantName: restaurant.name,
				googlePlaceId: restaurant.google_place_id,
			},
		});

		try {
			const { mapUrl, canOpen } = await getGoogleMapsLink(restaurant);
			// #1121 Web の別タブ起動は openExternalUrl へ寄せた。
			// canOpen（Linking.canOpenURL）はネイティブのハンドラ有無の判定なので Web では見ない
			if (Platform.OS !== "web" && !canOpen) {
				showSnackbar(i18n.t("DishMediaContent.errors.mapOpenFailed"));
				return;
			}
			await openExternalUrl(mapUrl);
		} catch (error) {
			showSnackbar(i18n.t("DishMediaContent.errors.mapOpenFailed"));
			logFrontendEvent({
				event_name: "restaurant_google_maps_open_failed",
				error_level: "error",
				payload: {
					restaurantId: restaurant.id,
					googlePlaceId: restaurant.google_place_id,
					error: error instanceof Error ? error.message : "Unknown error",
				},
			});
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
						<Image
							source={{ uri: restaurant.imageUrls?.md, cacheKey: getCacheKeyForImage(restaurant.imageUrls?.md) }}
							style={styles.restaurantAvatar}
						/>
						<View style={styles.restaurantDetails}>
							<Text style={styles.restaurantName}>{restaurant.name}</Text>
							<View style={styles.ratingContainer}>
								<Stars rating={restaurantMeta.averageRating} />
								<Text style={styles.ratingText}>{restaurantMeta.averageRating}</Text>
								<Text style={styles.reviewCount}>({restaurantMeta.reviewCount})</Text>
							</View>
							<PrimaryButton
								onPress={handleOpenGoogleMaps}
								label={i18n.t("Map.buttons.openInGoogle")}
								labelStyle={{ color: "#5EA2FF" }}
								colors={["#F0F8FF", "#F0F8FF"]}
								shadowColor="transparent"
								borderRadius={8}
							/>
						</View>
					</View>
				</Card>

				{restaurantMeta.maxEndDate && (
					<View style={styles.bidAmountContainer}>
						<Text style={styles.bidAmountLabel}>{i18n.t("Map.labels.currentBidAmount")}</Text>
						<Text style={styles.bidAmount}>
							{i18n.t("Search.currencySuffix")}
							{restaurantMeta.totalCents.toLocaleString()}
						</Text>
						<Text style={styles.remainingDays}>
							{i18n.t("Common.daysRemaining", {
								count: Math.max(
									0,
									Math.ceil(
										(new Date(restaurantMeta.maxEndDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24),
									),
								),
							})}
						</Text>
					</View>
				)}

				<View style={styles.actionButtons}>
					<PrimaryButton
						onPress={handleReviewButtonPress}
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
	}, [handleHeaderLayout, handleReviewButtonPress, openBidModal, handleOpenGoogleMaps, restaurant]);

	const renderTabBar = useCallback((props: TabBarProps<string>) => <RestaurantTabsBar {...props} />, []);

	return (
		<View style={{ height: frame.height }}>
			<Tabs.Container
				renderHeader={renderHeader}
				headerHeight={headerHeight}
				renderTabBar={renderTabBar}
				headerContainerStyle={{ shadowColor: "transparent", backgroundColor: "transparent" }}>
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
			<ReviewBlurModal>{({ close }) => <ReviewForm restaurant={restaurant} onCancel={close} />}</ReviewBlurModal>

			{/* Bid Modal */}
			<BidBlurModal>
				{({ close }) => <BidForm onSubmit={handleBid} onCancel={close} isProcessing={isProcessing} />}
			</BidBlurModal>
		</View>
	);
}

const styles = StyleSheet.create({
	restaurantInfo: {
		flexDirection: "row",
		alignItems: "center",
		marginVertical: 4,
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
		color: "#F05537",
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
		borderBottomColor: "#F05537",
	},
	tabText: {
		fontSize: 16,
		color: "#666",
		fontWeight: "500",
	},
	activeTabText: {
		color: "#F05537",
		fontWeight: "600",
	},
});
