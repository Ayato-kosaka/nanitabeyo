import React, { useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ProfileHeader } from "../components/ProfileHeader";
import { ProfileTabsBar } from "../components/ProfileTabsBar";
import { GridList } from "../components/GridList";
import { ImageCard } from "@/components/ImageCardGrid";
import { useProfileQueries } from "../hooks/useProfileQueries";
import { useAuth } from "@/contexts/AuthProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useBlurModal } from "@/hooks/useBlurModal";
import { userProfile, otherUserProfile } from "@/data/profileData";
import Stars from "@/components/Stars";
import i18n from "@/lib/i18n";
import type { DishMediaEntry } from "@shared/api/v1/res";

export function ReviewTab() {
	const { user } = useAuth();
	const { userId } = useLocalSearchParams<{ userId?: string }>();
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { BlurModal, open: openEditModal } = useBlurModal({ intensity: 100 });
	
	// Determine if this is the current user's profile or another user's
	const isOwnProfile = !userId || userId === userProfile.id;
	const profile = isOwnProfile ? userProfile : otherUserProfile;
	
	// Add wallet tab for own profile
	const availableTabs = isOwnProfile ? ["reviews", "saved", "liked", "wallet"] : ["reviews"];

	const {
		profileData,
		paginationState,
		fetchErrors,
		loadInitialData,
		loadMoreData,
		refreshData,
		getCurrentDishMediaEntriesForTab,
	} = useProfileQueries(userId);

	// Load initial data when component mounts
	useEffect(() => {
		const currentData = getCurrentDishMediaEntriesForTab("reviews");
		if (currentData === null) {
			loadInitialData("reviews");
		}
	}, []);

	// Event handlers
	const handleEditProfile = () => {
		lightImpact();
		openEditModal();
		logFrontendEvent({
			event_name: "profile_edit_started",
			error_level: "log",
			payload: { currentBioLength: profile.bio.length },
		});
	};

	const handleFollow = () => {
		mediumImpact();
		logFrontendEvent({
			event_name: "user_followed",
			error_level: "log",
			payload: {
				targetUserId: profile.id,
				targetUsername: profile.username,
				followersCount: profile.followersCount,
			},
		});
	};

	const handleDishMediaEntryPress = (item: DishMediaEntry) => {
		lightImpact();
		logFrontendEvent({
			event_name: "dish_media_entry_selected",
			error_level: "log",
			payload: { item, selectedTab: "reviews" },
		});
	};

	// Render empty state
	const renderEmptyState = () => {
		const tabError = fetchErrors.reviews;

		if (tabError) {
			return (
				<View style={styles.emptyStateContainer}>
					<View style={styles.emptyStateCard}>
						<Text style={styles.emptyStateText}>{i18n.t("Profile.tabError.failedToLoad", { error: tabError })}</Text>
						<TouchableOpacity style={styles.retryButton} onPress={() => refreshData("reviews")}>
							<Text style={styles.retryButtonText}>{i18n.t("Profile.tabError.retry")}</Text>
						</TouchableOpacity>
					</View>
				</View>
			);
		}

		return (
			<View style={styles.emptyStateContainer}>
				<View style={styles.emptyStateCard}>
					<Text style={styles.emptyStateText}>{i18n.t("Profile.emptyState.noDishReviews")}</Text>
				</View>
			</View>
		);
	};

	const currentData = getCurrentDishMediaEntriesForTab("reviews") || [];

	// Convert DishMediaEntry to ImageCardItem format
	const convertedData = currentData.map(item => ({
		id: item.dish_media.id,
		imageUrl: item.dish_media.thumbnailImageUrl,
		originalItem: item, // Store original item for access in render
	}));

	// Update render function to use converted data
	const renderDishMediaEntryItem = ({ item }: { item: any }) => {
		const originalItem = item.originalItem;
		return (
			<ImageCard
				item={item}
				onPress={() => handleDishMediaEntryPress(originalItem)}>
				<View style={styles.reviewCardOverlay}>
					<View style={styles.reviewCardRating}>
						<Stars rating={originalItem.dish.averageRating} />
						<Text style={styles.reviewCardRatingText}>({originalItem.dish.reviewCount})</Text>
					</View>
				</View>
			</ImageCard>
		);
	};

	return (
		<GridList
			data={convertedData}
			numColumns={3}
			renderItem={renderDishMediaEntryItem}
			keyExtractor={(item) => item.id}
			onEndReached={() => loadMoreData("reviews")}
			onEndReachedThreshold={0.5}
			onRefresh={() => refreshData("reviews")}
			isRefreshing={false}
			isLoadingMore={paginationState.reviews?.isLoadingMore}
			ListEmptyComponent={renderEmptyState}
			ListHeaderComponent={
				<>
					<ProfileHeader
						profile={profile}
						isOwnProfile={isOwnProfile}
						isFollowing={false}
						onEditProfile={handleEditProfile}
						onFollow={handleFollow}
					/>
					<ProfileTabsBar
						availableTabs={availableTabs as any}
						isOwnProfile={isOwnProfile}
					/>
				</>
			}
		/>
	);
}

const styles = StyleSheet.create({
	reviewCardOverlay: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		backgroundColor: "rgba(0, 0, 0, 0.6)",
		padding: 8,
	},
	reviewCardRating: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	reviewCardRatingText: {
		fontSize: 12,
		color: "#FFFFFF",
		fontWeight: "500",
		marginLeft: 4,
	},
	emptyStateContainer: {
		flex: 1,
		paddingHorizontal: 16,
		paddingTop: 32,
	},
	emptyStateCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 20,
		padding: 32,
		alignItems: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 8,
		elevation: 4,
	},
	emptyStateText: {
		fontSize: 16,
		color: "#6B7280",
		textAlign: "center",
		fontWeight: "500",
		lineHeight: 24,
	},
	retryButton: {
		backgroundColor: "#5EA2FF",
		marginTop: 16,
		paddingHorizontal: 20,
		paddingVertical: 10,
		borderRadius: 20,
	},
	retryButtonText: {
		color: "#FFFFFF",
		fontWeight: "600",
	},
});