import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent } from "react-native";
import { Camera } from "lucide-react-native";
import { Card } from "@/components/Card";
import Stars from "@/components/Stars";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { useHaptics } from "@/hooks/useHaptics";
import { RestaurantReviewsTab } from "@/features/map/components/tabs/RestaurantReviewsTab";
import { Tabs } from "@/components/collapsible-tabs";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import { useSharedValueState } from "@/hooks/useSharedValueState";
import { useLogger } from "@/hooks/useLogger";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useSafeAreaFrame } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { getCacheKeyForImage } from "@/lib/image";
import { useAuth } from "@/contexts/AuthProvider";
import { LoginbackModal } from "@/features/profile/components/LoginbackModal";
import { RestaurantEntry } from "../stores/useRestaurantStore";
import { useLocale } from "@/hooks/useLocale";
import { useRouter } from "expo-router";

function RestaurantTabsBar({ tabNames, index, onTabPress }: TabBarProps<string>) {
	const currentIndex = useSharedValueState(index);
	return (
		<View style={styles.tabContainer}>
			{tabNames.map((name, i) => {
				const isActive = currentIndex === i;
				// #644 【設計】レビュー専用モーダルでは「みんなの投稿」のみ表示
				const label = i18n.t("Review.everybodyPostsTitle");
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

type SelectedRestaurantDetailsProps = {
	// #644 【設計】レストランエントリ（restaurant + meta 情報）
	restaurantEntry: RestaurantEntry;
};

export function SelectedRestaurantDetails({ restaurantEntry }: SelectedRestaurantDetailsProps) {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { showSnackbar } = useSnackbar();
	const router = useRouter();
	const { locale } = useLocale();
	const frame = useSafeAreaFrame(); // Safe Area を除いたフレームの高さ
	const { user } = useAuth();

	// Modals
	const {
		BlurModal: LoginBlurModal,
		open: openLoginModal,
		close: closeLoginModal,
	} = useBlurModal({ intensity: 100, zIndex: 1400 });

	// #644 【設計】写真・動画を投稿するボタン押下時の処理（メディア選択ありモード）
	const handleReviewButtonPress = useCallback(async () => {
		lightImpact();
		logFrontendEvent({
			event_name: "review_post_photo_video_button_press",
			error_level: "log",
			payload: {
				restaurant_id: restaurantEntry.restaurant.id,
			},
		});

		// #477【設計】匿名ユーザーの場合は LoginbackModal を表示、非匿名ユーザーの場合は ReviewForm を表示
		if (user?.is_anonymous !== false) {
			openLoginModal();
		} else {
			// ReviewForm に遷移すると同時にメディア選択が行われる
			router.push({
				pathname: "/[locale]/(tabs)/review/restaurant/[restaurantId]/review",
				params: { locale, restaurantId: restaurantEntry.restaurant.id },
			});
		}
	}, [lightImpact, openLoginModal, router, locale, restaurantEntry, user?.is_anonymous]);

	// #644 【設計】「みんなの投稿」のレビューアイテム押下時の処理
	const onPressPostReview = useCallback(
		(index: number, dishMediaId: string) => {
			lightImpact();
			logFrontendEvent({
				event_name: "review_from_media_navigate",
				error_level: "log",
				payload: {
					restaurant_id: restaurantEntry.restaurant.id,
					dish_media_id: dishMediaId,
				},
			});
			router.push({
				pathname: "/[locale]/(tabs)/review/restaurant/[restaurantId]/review-from-media/[dishMediaId]",
				params: { locale, restaurantId: restaurantEntry.restaurant.id, dishMediaId },
			});
		},
		[lightImpact, logFrontendEvent, router, locale, restaurantEntry],
	);

	// Collapsible header
	const [headerHeight, setHeaderHeight] = useState(0);
	const handleHeaderLayout = useCallback((event: LayoutChangeEvent) => {
		setHeaderHeight(event.nativeEvent.layout.height);
	}, []);

	const renderHeader = useCallback(
		() => (
			<View onLayout={handleHeaderLayout}>
				<Card>
					<View style={styles.restaurantInfo}>
						<Image
							source={{
								uri: restaurantEntry.restaurant.imageUrls?.md,
								cacheKey: getCacheKeyForImage(restaurantEntry.restaurant.imageUrls?.md),
							}}
							style={styles.restaurantAvatar}
						/>
						<View style={styles.restaurantDetails}>
							<Text style={styles.restaurantName}>{restaurantEntry.restaurant.name}</Text>
							<View style={styles.ratingContainer}>
								<Stars rating={restaurantEntry.meta.averageRating} />
								<Text style={styles.ratingText}>{restaurantEntry.meta.averageRating}</Text>
								<Text style={styles.reviewCount}>({restaurantEntry.meta.reviewCount})</Text>
							</View>
							{/* #644 【設計】自分の投稿ボタン「写真・動画を投稿」 */}
							<PrimaryButton
								onPress={handleReviewButtonPress}
								label={i18n.t("Review.selectRestaurant.postPhotoVideo")}
								icon={<Camera size={20} color="#F05537" />}
								labelStyle={{ color: "#F05537" }}
								colors={["#FDEBE7", "#FDEBE7"]}
								shadowColor="transparent"
								borderRadius={8}
							/>
						</View>
					</View>
				</Card>
			</View>
		),
		[handleHeaderLayout, restaurantEntry, handleReviewButtonPress],
	);

	const renderTabBar = useCallback((props: TabBarProps<string>) => <RestaurantTabsBar {...props} />, []);

	return (
		<View style={{ height: frame.height }}>
			<Tabs.Container
				renderHeader={renderHeader}
				headerHeight={headerHeight}
				renderTabBar={renderTabBar}
				headerContainerStyle={{ shadowColor: "transparent", backgroundColor: "transparent" }}>
				{/* 
					#644 【設計】レビュータブ: RestaurantReviewsTabコンポーネントを使用
					みんなの投稿サムネ押下でReviewFormモーダルが開く（既存メディア利用モード）
				*/}
				<Tabs.Tab name="reviews">
					<RestaurantReviewsTab restaurantId={restaurantEntry.restaurant.id} onItemPress={onPressPostReview} />
				</Tabs.Tab>
			</Tabs.Container>

			{/* Login Modal */}
			<LoginBlurModal>{({ close }) => <LoginbackModal onClose={close} />}</LoginBlurModal>
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
