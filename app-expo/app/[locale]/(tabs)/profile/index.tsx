import React, { useState, useEffect, useCallback } from "react";
import {
	View,
	Text,
	StyleSheet,
	ScrollView,
	TouchableOpacity,
	Image,
	Dimensions,
	FlatList,
	TextInput,
	ActivityIndicator,
	RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
	ArrowLeft,
	Settings,
	Share,
	Pencil as Edit3,
	Heart,
	MessageCircle,
	Lock,
	Grid3x3 as Grid3X3,
	Bookmark,
	X,
	Wallet,
	DollarSign,
} from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { UserProfile, UserPost } from "@/types";
import { userProfile, otherUserProfile } from "@/data/profileData";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { useBlurModal } from "@/hooks/useBlurModal";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ImageCardGrid } from "@/components/ImageCardGrid";
import { BidItem, EarningItem, mockBids, mockEarnings } from "@/features/profile/constants";
import Stars from "@/components/Stars";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useAPICall } from "@/hooks/useAPICall";
import { useWithLoading } from "@/hooks/useWithLoading";
import type {
	QueryUserDishReviewsResponse,
	QueryMeLikedDishMediaResponse,
	QueryMeSavedDishCategoriesResponse,
	QueryMeSavedDishMediaResponse,
	PaginatedResponse,
} from "@shared/api/v1/res";

const { width } = Dimensions.get("window");
const Tab = createMaterialTopTabNavigator();

type TabType = "posts" | "saved" | "liked" | "wallet";

// Interface for API data structures
interface ProfileData {
	userPosts: QueryUserDishReviewsResponse;
	likedPosts: QueryMeLikedDishMediaResponse;
	savedTopics: QueryMeSavedDishCategoriesResponse;
	savedPosts: QueryMeSavedDishMediaResponse;
}

interface PaginationState {
	cursor: string | null;
	hasNextPage: boolean;
	isLoadingMore: boolean;
}

function DepositsScreen() {
	const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["active", "completed", "refunded"]);
	const { lightImpact } = useHaptics();

	const depositStatuses = [
		{ id: "active", label: i18n.t("Profile.statusLabels.active"), color: "#4CAF50" },
		{ id: "completed", label: i18n.t("Profile.statusLabels.completed"), color: "#2196F3" },
		{ id: "refunded", label: i18n.t("Profile.statusLabels.refunded"), color: "#FF9800" },
	];

	const toggleStatus = (statusId: string) => {
		lightImpact();
		setSelectedStatuses((prev) =>
			prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId],
		);
	};

	const filteredBids = mockBids.filter((bid) => selectedStatuses.includes(bid.status));

	const renderBidItem = ({ item }: { item: BidItem }) => (
		<View style={styles.depositCard}>
			<View style={styles.depositHeader}>
				<Image
					source={{ uri: item.restaurantImageUrl }}
					style={styles.depositAvatar}
					onError={() => console.log("Failed to load restaurant image")}
				/>
				<View style={styles.depositInfo}>
					<Text style={styles.depositRestaurantName}>{item.restaurantName}</Text>
					<Text style={styles.depositAmount}>
						{i18n.t("Search.currencySuffix")}
						{item.bidAmount.toLocaleString()}
					</Text>
				</View>
				<View style={[styles.statusChip, { backgroundColor: getStatusColor(item.status) }]}>
					<Text style={styles.statusText}>{getStatusText(item.status)}</Text>
				</View>
			</View>
			<Text style={styles.depositDays}>{i18n.t("Common.daysRemaining", { count: item.remainingDays })}</Text>
		</View>
	);

	const getStatusColor = (status: string) => {
		switch (status) {
			case "active":
				return "#4CAF50";
			case "completed":
				return "#2196F3";
			case "refunded":
				return "#FF9800";
			default:
				return "#666";
		}
	};

	const getStatusText = (status: string) => {
		switch (status) {
			case "active":
				return i18n.t("Profile.statusLabels.active");
			case "completed":
				return i18n.t("Profile.statusLabels.completed");
			case "refunded":
				return i18n.t("Profile.statusLabels.refunded");
			default:
				return status;
		}
	};

	return (
		<View style={styles.tabContent}>
			{/* Status Filter Chips */}
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				style={styles.statusFilterContainer}
				contentContainerStyle={styles.statusFilterContent}>
				{depositStatuses.map((status) => (
					<TouchableOpacity
						key={status.id}
						style={[
							styles.statusFilterChip,
							selectedStatuses.includes(status.id) && {
								backgroundColor: status.color,
							},
						]}
						onPress={() => toggleStatus(status.id)}>
						<Text
							style={[
								styles.statusFilterChipText,
								selectedStatuses.includes(status.id) && styles.statusFilterChipTextActive,
							]}>
							{status.label}
						</Text>
					</TouchableOpacity>
				))}
			</ScrollView>

			{/* Filtered Results */}
			{filteredBids.length > 0 ? (
				<FlatList
					data={filteredBids}
					renderItem={renderBidItem}
					keyExtractor={(item) => item.id}
					contentContainerStyle={styles.depositsList}
					showsVerticalScrollIndicator={false}
					scrollEnabled={false}
				/>
			) : (
				<View style={styles.emptyStateContainer}>
					<View style={styles.emptyStateCard}>
						<Text style={styles.emptyStateText}>{i18n.t("Profile.emptyState.noDeposits")}</Text>
					</View>
				</View>
			)}
		</View>
	);
}

function EarningsScreen() {
	const [selectedEarningStatuses, setSelectedEarningStatuses] = useState<string[]>(["paid", "pending"]);
	const { lightImpact } = useHaptics();

	const earningStatuses = [
		{ id: "paid", label: i18n.t("Profile.statusLabels.paid"), color: "#4CAF50" },
		{ id: "pending", label: i18n.t("Profile.statusLabels.pending"), color: "#FF9800" },
	];

	const toggleEarningStatus = (statusId: string) => {
		lightImpact();
		setSelectedEarningStatuses((prev) =>
			prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId],
		);
	};

	const filteredEarnings = mockEarnings.filter((earning) => selectedEarningStatuses.includes(earning.status));

	return (
		<View style={styles.tabContent}>
			{/* Status Filter Chips */}
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				style={styles.statusFilterContainer}
				contentContainerStyle={styles.statusFilterContent}>
				{earningStatuses.map((status) => (
					<TouchableOpacity
						key={status.id}
						style={[
							styles.statusFilterChip,
							selectedEarningStatuses.includes(status.id) && {
								backgroundColor: status.color,
							},
						]}
						onPress={() => toggleEarningStatus(status.id)}>
						<Text
							style={[
								styles.statusFilterChipText,
								selectedEarningStatuses.includes(status.id) && styles.statusFilterChipTextActive,
							]}>
							{status.label}
						</Text>
					</TouchableOpacity>
				))}
			</ScrollView>

			{/* Filtered Results */}
			{filteredEarnings.length > 0 ? (
				<ImageCardGrid
					data={filteredEarnings}
					containerStyle={{ marginVertical: 16 }}
					renderOverlay={(item) => (
						<View style={styles.earningCardOverlay}>
							<Text style={styles.earningCardAmount}>
								{i18n.t("Search.currencySuffix")}
								{item.earnings.toLocaleString()}
							</Text>
							<View
								style={[
									styles.statusChip,
									{
										backgroundColor: item.status === "paid" ? "#4CAF50" : "#FF9800",
									},
								]}>
								<Text style={styles.statusText}>
									{item.status === "paid"
										? i18n.t("Profile.statusLabels.paid")
										: i18n.t("Profile.statusLabels.pending")}
								</Text>
							</View>
						</View>
					)}
				/>
			) : (
				<View style={styles.emptyStateContainer}>
					<View style={styles.emptyStateCard}>
						<Text style={styles.emptyStateText}>{i18n.t("Profile.emptyState.noEarnings")}</Text>
					</View>
				</View>
			)}
		</View>
	);
}

function WalletTabs() {
	return (
		<Tab.Navigator
			screenOptions={{
				tabBarActiveTintColor: "#5EA2FF",
				tabBarInactiveTintColor: "#666",
				tabBarStyle: {
					marginHorizontal: 16,
					marginTop: 16,
					backgroundColor: "transparent",
					shadowColor: "transparent",
					elevation: 0,
				},
				tabBarIndicatorStyle: {
					height: "100%",
					backgroundColor: "white",
					borderRadius: 32,
					shadowColor: "#000",
					shadowOffset: { width: 0, height: 0 },
					shadowOpacity: 0.1,
					shadowRadius: 16,
					elevation: 4,
				},
				tabBarItemStyle: {
					flexDirection: "row",
					paddingHorizontal: 16,
				},
				sceneStyle: {
					backgroundColor: "transparent",
				},
				// tabBarPressColor: 'transparent',
			}}>
			<Tab.Screen
				name="Deposits"
				component={DepositsScreen}
				options={{
					tabBarLabel: i18n.t("Profile.tabs.deposits"),
					tabBarIcon: ({ color }) => <Wallet size={20} color={color} />,
				}}
			/>
			<Tab.Screen
				name="Earnings"
				component={EarningsScreen}
				options={{
					tabBarLabel: i18n.t("Profile.tabs.earnings"),
					tabBarIcon: ({ color }) => <DollarSign size={20} color={color} />,
				}}
			/>
		</Tab.Navigator>
	);
}

export default function ProfileScreen() {
	const { userId } = useLocalSearchParams();
	const [selectedTab, setSelectedTab] = useState<TabType>("posts");
	const { BlurModal, open: openEditModal, close: closeEditModal } = useBlurModal({ intensity: 100 });
	const [editedBio, setEditedBio] = useState("");
	const [isFollowing, setIsFollowing] = useState(false);
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { isLoading, withLoading } = useWithLoading();

	// API Data State
	const [profileData, setProfileData] = useState<ProfileData>({
		userPosts: [],
		likedPosts: [],
		savedTopics: [],
		savedPosts: [],
	});

	// Pagination State for each tab
	const [paginationState, setPaginationState] = useState<Record<TabType, PaginationState>>({
		posts: { cursor: null, hasNextPage: true, isLoadingMore: false },
		saved: { cursor: null, hasNextPage: true, isLoadingMore: false },
		liked: { cursor: null, hasNextPage: true, isLoadingMore: false },
		wallet: { cursor: null, hasNextPage: false, isLoadingMore: false },
	});

	const [isRefreshing, setIsRefreshing] = useState(false);
	const [fetchError, setFetchError] = useState<string | null>(null);

	// Determine if this is the current user's profile or another user's
	const isOwnProfile = !userId || userId === userProfile.id;
	const profile = isOwnProfile ? userProfile : otherUserProfile;

	// Data fetching functions
	const fetchUserPosts = useCallback(
		async (cursor?: string) => {
			try {
				const response = await callBackend<PaginatedResponse<QueryUserDishReviewsResponse[0]>>(
					`v1/users/${isOwnProfile ? "me" : userId}/dish-reviews`,
					{
						method: "GET",
						requestPayload: cursor ? { cursor } : {},
					},
				);

				return {
					data: response.data || [],
					nextCursor: response.nextCursor,
				};
			} catch (error) {
				logFrontendEvent({
					event_name: "fetch_user_posts_failed",
					error_level: "log",
					payload: {
						error: error instanceof Error ? error.message : String(error),
						userId: isOwnProfile ? "me" : userId,
						cursor: cursor || "initial",
					},
				});
				throw error;
			}
		},
		[callBackend, isOwnProfile, userId],
	);

	const fetchLikedPosts = useCallback(
		async (cursor?: string) => {
			try {
				const response = await callBackend<PaginatedResponse<QueryMeLikedDishMediaResponse[0]>>(
					"v1/users/me/liked-dish-media",
					{
						method: "GET",
						requestPayload: cursor ? { cursor } : {},
					},
				);

				return {
					data: response.data || [],
					nextCursor: response.nextCursor,
				};
			} catch (error) {
				logFrontendEvent({
					event_name: "fetch_liked_posts_failed",
					error_level: "log",
					payload: {
						error: error instanceof Error ? error.message : String(error),
						cursor: cursor || "initial",
					},
				});
				throw error;
			}
		},
		[callBackend],
	);

	const fetchSavedTopics = useCallback(
		async (cursor?: string) => {
			try {
				const response = await callBackend<PaginatedResponse<QueryMeSavedDishCategoriesResponse[0]>>(
					"v1/users/me/saved-dish-categories",
					{
						method: "GET",
						requestPayload: cursor ? { cursor } : {},
					},
				);

				return {
					data: response.data || [],
					nextCursor: response.nextCursor,
				};
			} catch (error) {
				logFrontendEvent({
					event_name: "fetch_saved_topics_failed",
					error_level: "log",
					payload: {
						error: error instanceof Error ? error.message : String(error),
						cursor: cursor || "initial",
					},
				});
				throw error;
			}
		},
		[callBackend],
	);

	const fetchSavedPosts = useCallback(
		async (cursor?: string) => {
			try {
				const response = await callBackend<PaginatedResponse<QueryMeSavedDishMediaResponse[0]>>(
					"v1/users/me/saved-dish-media",
					{
						method: "GET",
						requestPayload: cursor ? { cursor } : {},
					},
				);

				return {
					data: response.data || [],
					nextCursor: response.nextCursor,
				};
			} catch (error) {
				logFrontendEvent({
					event_name: "fetch_saved_posts_failed",
					error_level: "log",
					payload: {
						error: error instanceof Error ? error.message : String(error),
						cursor: cursor || "initial",
					},
				});
				throw error;
			}
		},
		[callBackend],
	);

	// Load initial data for a specific tab
	const loadInitialData = useCallback(
		async (tab: TabType) => {
			if (tab === "wallet") return;

			setFetchError(null);

			try {
				let response;
				switch (tab) {
					case "posts":
						response = await fetchUserPosts();
						setProfileData((prev) => ({ ...prev, userPosts: response.data }));
						break;
					case "liked":
						if (!isOwnProfile) return;
						response = await fetchLikedPosts();
						setProfileData((prev) => ({ ...prev, likedPosts: response.data }));
						break;
					case "saved":
						if (!isOwnProfile) return;
						// For saved tab, we need both topics and posts
						const [topicsResponse, postsResponse] = await Promise.all([fetchSavedTopics(), fetchSavedPosts()]);
						setProfileData((prev) => ({
							...prev,
							savedTopics: topicsResponse.data,
							savedPosts: postsResponse.data,
						}));
						// Use the posts response for pagination
						response = postsResponse;
						break;
					default:
						return;
				}

				setPaginationState((prev) => ({
					...prev,
					[tab]: {
						cursor: response.nextCursor,
						hasNextPage: !!response.nextCursor,
						isLoadingMore: false,
					},
				}));
			} catch (error) {
				setFetchError(error instanceof Error ? error.message : "Failed to load data");
				setPaginationState((prev) => ({
					...prev,
					[tab]: { ...prev[tab], hasNextPage: false, isLoadingMore: false },
				}));
			}
		},
		[fetchUserPosts, fetchLikedPosts, fetchSavedTopics, fetchSavedPosts, isOwnProfile],
	);

	// Load more data for infinite scroll
	const loadMoreData = useCallback(
		async (tab: TabType) => {
			const currentState = paginationState[tab];
			if (!currentState.hasNextPage || currentState.isLoadingMore || tab === "wallet") return;

			setPaginationState((prev) => ({
				...prev,
				[tab]: { ...prev[tab], isLoadingMore: true },
			}));

			try {
				let response;
				switch (tab) {
					case "posts":
						response = await fetchUserPosts(currentState.cursor || undefined);
						setProfileData((prev) => ({
							...prev,
							userPosts: [...prev.userPosts, ...response.data],
						}));
						break;
					case "liked":
						response = await fetchLikedPosts(currentState.cursor || undefined);
						setProfileData((prev) => ({
							...prev,
							likedPosts: [...prev.likedPosts, ...response.data],
						}));
						break;
					case "saved":
						response = await fetchSavedPosts(currentState.cursor || undefined);
						setProfileData((prev) => ({
							...prev,
							savedPosts: [...prev.savedPosts, ...response.data],
						}));
						break;
					default:
						return;
				}

				setPaginationState((prev) => ({
					...prev,
					[tab]: {
						cursor: response.nextCursor,
						hasNextPage: !!response.nextCursor,
						isLoadingMore: false,
					},
				}));
			} catch (error) {
				logFrontendEvent({
					event_name: "load_more_data_failed",
					error_level: "log",
					payload: {
						error: error instanceof Error ? error.message : String(error),
						tab: tab,
						cursor: paginationState[tab]?.nextCursor || "unknown",
					},
				});
				setPaginationState((prev) => ({
					...prev,
					[tab]: { ...prev[tab], isLoadingMore: false },
				}));
			}
		},
		[paginationState, fetchUserPosts, fetchLikedPosts, fetchSavedPosts],
	);

	// Refresh data
	const refreshData = useCallback(
		async (tab: TabType) => {
			setIsRefreshing(true);
			setPaginationState((prev) => ({
				...prev,
				[tab]: { cursor: null, hasNextPage: true, isLoadingMore: false },
			}));

			try {
				await loadInitialData(tab);
			} finally {
				setIsRefreshing(false);
			}
		},
		[loadInitialData],
	);

	React.useEffect(() => {
		// Screen view logging
		logFrontendEvent({
			event_name: "screen_view",
			error_level: "log",
			payload: {
				screen: "profile",
				isOwnProfile,
				profileUserId: profile.id,
				followerCount: profile.followersCount,
				followingCount: profile.followingCount,
			},
		});

		if (profile && !isOwnProfile) {
			setIsFollowing(profile.isFollowing || false);
		}
	}, [profile, isOwnProfile, logFrontendEvent]);

	// Load initial data when component mounts or tab changes
	React.useEffect(() => {
		const loadData = async () => {
			await withLoading(async () => {
				await loadInitialData(selectedTab);
			});
		};

		loadData();
	}, [selectedTab, withLoading, loadInitialData]);

	// Add wallet tab for own profile
	const availableTabs: TabType[] = isOwnProfile ? ["posts", "saved", "liked", "wallet"] : ["posts"];

	const formatNumber = (num: number): string => {
		if (num >= 1000000) {
			return (num / 1000000).toFixed(1).replace(/\.0$/, "") + i18n.t("Profile.numberSuffix.million");
		}
		if (num >= 1000) {
			return (num / 1000).toFixed(1).replace(/\.0$/, "") + i18n.t("Profile.numberSuffix.thousand");
		}
		return num.toString();
	};

	const getCurrentPosts = (): any[] => {
		switch (selectedTab) {
			case "posts":
				return profileData.userPosts;
			case "saved":
				return profileData.savedPosts;
			case "wallet":
				return [];
			case "liked":
				return profileData.likedPosts;
			default:
				return profileData.userPosts;
		}
	};

	const handleFollow = () => {
		mediumImpact();
		const newFollowState = !isFollowing;
		setIsFollowing(newFollowState);

		logFrontendEvent({
			event_name: newFollowState ? "user_followed" : "user_unfollowed",
			error_level: "log",
			payload: {
				targetUserId: profile.id,
				targetUsername: profile.username,
				followersCount: profile.followersCount,
			},
		});
	};

	const handleEditProfile = () => {
		lightImpact();
		setEditedBio(profile.bio);
		openEditModal();

		logFrontendEvent({
			event_name: "profile_edit_started",
			error_level: "log",
			payload: { currentBioLength: profile.bio.length },
		});
	};

	const handleSaveProfile = () => {
		mediumImpact();
		// In a real app, this would update the profile via API
		console.log("Saving profile with bio:", editedBio);
		closeEditModal();

		logFrontendEvent({
			event_name: "profile_edit_saved",
			error_level: "log",
			payload: {
				oldBioLength: profile.bio.length,
				newBioLength: editedBio.length,
			},
		});
	};

	const handleShareProfile = () => {
		lightImpact();
		console.log("Sharing profile:", profile.username);

		logFrontendEvent({
			event_name: "profile_shared",
			error_level: "log",
			payload: {
				profileUserId: profile.id,
				profileUsername: profile.username,
				isOwnProfile,
			},
		});
	};

	const handlePostPress = (index: number) => {
		lightImpact();
		// router.push(`/(tabs)/profile/food?startIndex=${index}`);

		logFrontendEvent({
			event_name: "profile_post_clicked",
			error_level: "log",
			payload: { postIndex: index, selectedTab },
		});
	};

	const handleTabSelect = async (tab: TabType) => {
		lightImpact();
		setSelectedTab(tab);

		logFrontendEvent({
			event_name: "profile_tab_selected",
			error_level: "log",
			payload: {
				selectedTab: tab,
				previousTab: selectedTab,
				isOwnProfile,
			},
		});

		// Load data for the new tab if it hasn't been loaded yet
		const currentData = getCurrentPostsForTab(tab);
		if (currentData.length === 0 && tab !== "wallet") {
			await withLoading(async () => {
				await loadInitialData(tab);
			});
		}
	};

	const getCurrentPostsForTab = (tab: TabType): any[] => {
		switch (tab) {
			case "posts":
				return profileData.userPosts;
			case "saved":
				return profileData.savedPosts;
			case "liked":
				return profileData.likedPosts;
			default:
				return [];
		}
	};

	const renderTabIcon = (tab: TabType) => {
		const isActive = selectedTab === tab;
		const iconColor = isActive ? "#5EA2FF" : "#666";

		switch (tab) {
			case "posts":
				return <Grid3X3 size={20} color={iconColor} />;
			case "saved":
				return <Bookmark size={20} color={iconColor} fill={isActive ? iconColor : "transparent"} />;
			case "wallet":
				return <Wallet size={20} color={iconColor} fill={isActive ? iconColor : "transparent"} />;
			case "liked":
				return <Heart size={20} color={iconColor} fill={isActive ? iconColor : "transparent"} />;
		}
	};

	// Render item for API data
	const renderApiPostItem = ({ item }: { item: any }) => {
		// Handle different data structures based on API responses
		let imageUrl, title, rating, reviewCount;

		if (selectedTab === "posts") {
			// QueryUserDishReviewsResponse structure
			imageUrl = item.dish_media?.mediaImageUrl || item.signedUrls?.[0];
			title = item.dish_media?.dishName || "Dish";
			rating = item.dish_review?.rating || 0;
			reviewCount = 1; // Single review
		} else if (selectedTab === "liked" || selectedTab === "saved") {
			// QueryMeLikedDishMediaResponse / QueryMeSavedDishMediaResponse structure
			imageUrl = item.dish_media?.mediaImageUrl;
			title = item.dish?.name || "Dish";
			rating =
				item.dish_reviews?.reduce((sum: number, review: any) => sum + review.rating, 0) /
				(item.dish_reviews?.length || 1);
			reviewCount = item.dish_reviews?.length || 0;
		}

		return (
			<TouchableOpacity
				style={styles.postItem}
				onPress={() => handlePostPress(0)} // Index doesn't matter for logging
			>
				<Image source={{ uri: imageUrl }} style={styles.postImage} />
				<View style={styles.reviewCardOverlay}>
					<Text style={styles.reviewCardTitle}>{title}</Text>
					<View style={styles.reviewCardRating}>
						<Stars rating={rating} />
						<Text style={styles.reviewCardRatingText}>({reviewCount})</Text>
					</View>
				</View>
			</TouchableOpacity>
		);
	};

	// Render loading footer
	const renderLoadingFooter = () => {
		if (!paginationState[selectedTab]?.isLoadingMore) return null;

		return (
			<View style={styles.loadingFooter}>
				<ActivityIndicator size="small" color="#5EA2FF" />
			</View>
		);
	};

	// Render empty state
	const renderEmptyState = () => {
		if (isLoading) {
			return (
				<View style={styles.loadingContainer}>
					<ActivityIndicator size="large" color="#5EA2FF" />
					<Text style={styles.loadingText}>Loading...</Text>
				</View>
			);
		}

		if (fetchError) {
			return (
				<View style={styles.emptyStateContainer}>
					<View style={styles.emptyStateCard}>
						<Text style={styles.emptyStateText}>Failed to load data: {fetchError}</Text>
						<TouchableOpacity style={styles.retryButton} onPress={() => refreshData(selectedTab)}>
							<Text style={styles.retryButtonText}>Retry</Text>
						</TouchableOpacity>
					</View>
				</View>
			);
		}

		return (
			<View style={styles.emptyStateContainer}>
				<View style={styles.emptyStateCard}>
					<Text style={styles.emptyStateText}>
						{selectedTab === "posts" ? "No posts yet" : selectedTab === "liked" ? "No liked posts" : "No saved items"}
					</Text>
				</View>
			</View>
		);
	};

	const shouldShowTab = (tab: TabType): boolean => {
		if (isOwnProfile) return true;
		// For other users, only show posts tab
		return tab === "posts";
	};

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			{/* Header */}
			<View style={styles.header}>
				{!isOwnProfile && (
					<TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
						<ArrowLeft size={24} color="#1A1A1A" />
					</TouchableOpacity>
				)}
				<Text style={styles.headerTitle}>{profile.username}</Text>
				<View style={{ flexDirection: "row", gap: 8 }}>
					<TouchableOpacity style={styles.shareButton} onPress={handleShareProfile}>
						<Share size={24} color="#666" />
					</TouchableOpacity>
					<TouchableOpacity style={styles.settingButton}>
						<Settings size={24} color="#666" />
					</TouchableOpacity>
				</View>
			</View>

			{/* Profile Info - Fixed Header */}
			<View style={styles.profileSection}>
				<Card>
					{/* Avatar and Stats */}
					<View style={styles.profileHeader}>
						<Image source={{ uri: profile.avatar }} style={styles.avatar} />

						<View style={styles.statsContainer}>
							<View style={styles.statColumn}>
								<Text style={styles.statNumber}>{formatNumber(profile.followingCount)}</Text>
								<Text style={styles.statLabel}>{i18n.t("Profile.stats.following")}</Text>
							</View>
							<View style={styles.statColumn}>
								<Text style={styles.statNumber}>{formatNumber(profile.followersCount)}</Text>
								<Text style={styles.statLabel}>{i18n.t("Profile.stats.followers")}</Text>
							</View>
							<View style={styles.statColumn}>
								<Text style={styles.statNumber}>{formatNumber(profile.totalLikes)}</Text>
								<Text style={styles.statLabel}>{i18n.t("Profile.stats.likes")}</Text>
							</View>
						</View>
					</View>

					{/* Display Name */}
					<Text style={styles.displayName}>{profile.displayName}</Text>

					{/* Bio */}
					<Text style={styles.bio}>{profile.bio}</Text>

					{/* Action Buttons */}
					<View style={styles.actionButtons}>
						{isOwnProfile ? (
							<>
								<PrimaryButton
									style={{ flex: 1 }}
									onPress={handleEditProfile}
									label={i18n.t("Profile.buttons.editProfile")}
									icon={<Edit3 size={16} color="#FFFFFF" />}
								/>
							</>
						) : (
							<>
								<TouchableOpacity
									style={[styles.followButton, isFollowing && styles.followingButton]}
									onPress={handleFollow}>
									<Text style={[styles.followButtonText, isFollowing && styles.followingButtonText]}>
										{isFollowing ? i18n.t("Profile.buttons.following") : i18n.t("Profile.buttons.follow")}
									</Text>
								</TouchableOpacity>
								<TouchableOpacity style={styles.messageButton}>
									<MessageCircle size={16} color="#FFFFFF" />
									<Text style={styles.messageButtonText}>{i18n.t("Profile.buttons.message")}</Text>
								</TouchableOpacity>
							</>
						)}
					</View>
				</Card>

				{/* Content Tabs */}
				<View style={styles.tabsContainer}>
					{availableTabs.map((tab) => (
						<TouchableOpacity
							key={tab}
							style={[styles.tab, selectedTab === tab && styles.activeTab]}
							onPress={() => handleTabSelect(tab)}>
							{renderTabIcon(tab)}
						</TouchableOpacity>
					))}
				</View>
			</View>

			{/* Posts Content - FlatList for infinite scroll */}
			{selectedTab === "wallet" ? (
				<WalletTabs />
			) : selectedTab === "saved" && !isOwnProfile ? (
				<View style={styles.privateContainer}>
					<View style={styles.privateCard}>
						<Lock size={48} color="#6B7280" />
						<Text style={styles.privateText}>{i18n.t("Profile.privateContent")}</Text>
					</View>
				</View>
			) : (
				<FlatList
					data={getCurrentPosts()}
					renderItem={renderApiPostItem}
					keyExtractor={(item, index) => {
						// Handle different ID structures from different APIs
						return item.id || item.dish_media?.id || item.dish_review?.id || `${selectedTab}-${index}`;
					}}
					numColumns={2}
					contentContainerStyle={styles.flatListContent}
					showsVerticalScrollIndicator={false}
					onEndReached={() => loadMoreData(selectedTab)}
					onEndReachedThreshold={0.5}
					refreshControl={
						<RefreshControl
							refreshing={isRefreshing}
							onRefresh={() => refreshData(selectedTab)}
							colors={["#5EA2FF"]}
							tintColor="#5EA2FF"
						/>
					}
					ListEmptyComponent={renderEmptyState}
					ListFooterComponent={renderLoadingFooter}
				/>
			)}

			{/* Edit Profile Modal */}
			<BlurModal>
				<Card>
					<Text style={styles.editLabel}>{i18n.t("Profile.labels.bio")}</Text>
					<TextInput
						style={styles.editInput}
						value={editedBio}
						onChangeText={setEditedBio}
						multiline
						numberOfLines={4}
						placeholder={i18n.t("Profile.placeholders.enterBio")}
						placeholderTextColor="#666"
					/>
				</Card>
				<PrimaryButton style={{ marginHorizontal: 16 }} onPress={handleSaveProfile} label={i18n.t("Common.save")} />
			</BlurModal>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
	backButton: {
		padding: 4,
		borderRadius: 12,
		backgroundColor: "rgba(255, 255, 255, 0.1)",
	},
	headerTitle: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		letterSpacing: -0.5,
	},
	settingButton: {
		padding: 4,
	},
	shareButton: {
		padding: 4,
	},
	content: {
		flex: 1,
	},
	profileHeader: {
		flexDirection: "row",
		alignItems: "center",
		marginBottom: 16,
	},
	avatar: {
		width: 80,
		height: 80,
		borderRadius: 20,
		marginRight: 20,
		borderWidth: 3,
		borderColor: "#FFFFFF",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.15,
		shadowRadius: 8,
		elevation: 6,
	},
	statsContainer: {
		flex: 1,
		flexDirection: "row",
		justifyContent: "space-around",
	},
	statColumn: {
		alignItems: "center",
	},
	statNumber: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 2,
		letterSpacing: -0.3,
	},
	statLabel: {
		fontSize: 13,
		color: "#6B7280",
		fontWeight: "500",
	},
	displayName: {
		fontSize: 18,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 8,
		letterSpacing: -0.3,
	},
	bio: {
		fontSize: 15,
		color: "#6B7280",
		lineHeight: 20,
		marginBottom: 16,
		fontWeight: "400",
	},
	actionButtons: {
		flexDirection: "row",
		gap: 8,
	},
	followButton: {
		flex: 1,
		backgroundColor: "#5EA2FF",
		paddingVertical: 10,
		paddingHorizontal: 16,
		borderRadius: 16,
		alignItems: "center",
		shadowColor: "#5EA2FF",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 8,
		elevation: 6,
	},
	followingButton: {
		backgroundColor: "#6B7280",
	},
	followButtonText: {
		fontSize: 15,
		fontWeight: "600",
		color: "#FFFFFF",
		letterSpacing: 0.2,
	},
	followingButtonText: {
		color: "#FFFFFF",
	},
	messageButton: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#6B7280",
		paddingVertical: 10,
		paddingHorizontal: 16,
		borderRadius: 16,
		gap: 6,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 4,
		elevation: 3,
	},
	messageButtonText: {
		fontSize: 15,
		fontWeight: "600",
		color: "#FFFFFF",
		letterSpacing: 0.2,
	},
	tabsContainer: {
		flexDirection: "row",
		marginHorizontal: 16,
		marginTop: 16,
	},
	tab: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: 8,
		gap: 6,
	},
	activeTab: {
		borderBottomWidth: 2,
		borderBottomColor: "#5EA2FF",
	},
	postsContainer: {
		flex: 1,
		minHeight: 400,
		marginTop: 16,
	},
	privateContainer: {
		flex: 1,
		paddingHorizontal: 16,
	},
	privateCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 20,
		padding: 32,
		alignItems: "center",
		justifyContent: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.08,
		shadowRadius: 16,
		elevation: 4,
	},
	privateText: {
		fontSize: 17,
		color: "#6B7280",
		marginTop: 16,
		fontWeight: "500",
		textAlign: "center",
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
	editLabel: {
		fontSize: 17,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 8,
		letterSpacing: -0.3,
	},
	editInput: {
		backgroundColor: "#F8F9FA",
		borderRadius: 12,
		paddingHorizontal: 12,
		paddingVertical: 12,
		fontSize: 15,
		color: "#1A1A1A",
		textAlignVertical: "top",
		minHeight: 100,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.05,
		shadowRadius: 2,
		elevation: 1,
	},
	tabContent: {
		flex: 1,
	},
	depositsList: {
		padding: 16,
	},
	depositCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 16,
		padding: 16,
		marginBottom: 12,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.08,
		shadowRadius: 16,
		elevation: 4,
	},
	depositHeader: {
		flexDirection: "row",
		alignItems: "center",
		marginBottom: 8,
	},
	depositAvatar: {
		width: 40,
		height: 40,
		borderRadius: 20,
		marginRight: 12,
		borderWidth: 2,
		borderColor: "#FFFFFF",
	},
	depositInfo: {
		flex: 1,
	},
	depositRestaurantName: {
		fontSize: 14,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 2,
		letterSpacing: -0.3,
	},
	depositAmount: {
		fontSize: 16,
		fontWeight: "700",
		color: "#5EA2FF",
		letterSpacing: -0.3,
	},
	depositDays: {
		fontSize: 15,
		color: "#6B7280",
		fontWeight: "500",
	},
	statusChip: {
		paddingHorizontal: 8,
		paddingVertical: 4,
		borderRadius: 16,
		alignItems: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 4,
		elevation: 3,
	},
	statusText: {
		fontSize: 13,
		color: "#FFFFFF",
		fontWeight: "600",
	},
	earningCard: {
		flex: 1,
		aspectRatio: 9 / 16,
		borderRadius: 16,
		margin: 4,
		overflow: "hidden",
		position: "relative",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.15,
		shadowRadius: 8,
		elevation: 6,
	},
	earningCardOverlay: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		padding: 8,
	},
	earningCardAmount: {
		fontSize: 15,
		fontWeight: "700",
		color: "#FFF",
		letterSpacing: -0.2,
	},
	statusFilterContainer: {
		flexGrow: 0,
		paddingTop: 8,
		paddingHorizontal: 16,
	},
	statusFilterContent: {
		gap: 8,
	},
	statusFilterChip: {
		paddingHorizontal: 16,
		paddingVertical: 8,
		borderRadius: 16,
		backgroundColor: "#EDEFF1",
		marginHorizontal: 4,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 4,
		elevation: 3,
	},
	statusFilterChipText: {
		fontSize: 13,
		color: "#6B7280",
		fontWeight: "500",
	},
	statusFilterChipTextActive: {
		color: "#FFF",
		fontWeight: "600",
	},
	emptyStateContainer: {
		flex: 1,
		padding: 16,
	},
	emptyStateCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 20,
		padding: 32,
		alignItems: "center",
		justifyContent: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.08,
		shadowRadius: 16,
		elevation: 4,
	},
	emptyStateText: {
		fontSize: 17,
		color: "#6B7280",
		textAlign: "center",
		fontWeight: "500",
	},
	profileSection: {
		paddingHorizontal: 16,
	},
	flatListContent: {
		padding: 8,
	},
	postItem: {
		flex: 1,
		aspectRatio: 9 / 16,
		margin: 4,
		borderRadius: 16,
		overflow: "hidden",
		position: "relative",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.15,
		shadowRadius: 8,
		elevation: 6,
	},
	postImage: {
		width: "100%",
		height: "100%",
		resizeMode: "cover",
	},
	loadingFooter: {
		paddingVertical: 20,
		alignItems: "center",
	},
	loadingContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingTop: 50,
	},
	loadingText: {
		marginTop: 10,
		fontSize: 16,
		color: "#6B7280",
	},
	retryButton: {
		marginTop: 16,
		backgroundColor: "#5EA2FF",
		paddingHorizontal: 20,
		paddingVertical: 10,
		borderRadius: 20,
	},
	retryButtonText: {
		color: "#FFFFFF",
		fontWeight: "600",
	},
});
