import React, { useState, useCallback } from "react";
import {
	View,
	Text,
	StyleSheet,
	TouchableOpacity,
	TextInput,
	ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
	ArrowLeft,
	Settings,
	Share,
	Lock,
} from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { userProfile, otherUserProfile } from "@/data/profileData";
import { useBlurModal } from "@/hooks/useBlurModal";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ProfileTabsLayout } from "@/features/profile/containers/ProfileTabsLayout";
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
	DishMediaEntry,
} from "@shared/api/v1/res";
import type {
	QueryMeLikedDishMediaDto,
	QueryMeSavedDishCategoriesDto,
	QueryMeSavedDishMediaDto,
	QueryUserDishReviewsDto,
} from "@shared/api/v1/dto";
import { useAuth } from "@/contexts/AuthProvider";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useLocale } from "@/hooks/useLocale";

type TabType = "reviews" | "saved" | "liked" | "wallet";

// Interface for API data structures
interface ProfileData {
	userDishMediaEntries: QueryUserDishReviewsResponse["data"] | null;
	likedDishMediaEntries: QueryMeLikedDishMediaResponse["data"] | null;
	savedTopics: QueryMeSavedDishCategoriesResponse["data"] | null;
	savedDishMediaEntries: QueryMeSavedDishMediaResponse["data"] | null;
}

interface PaginationState {
	cursor: string | null;
	hasNextPage: boolean;
	isLoadingMore: boolean;
}

export default function ProfileScreen() {
	const { user } = useAuth();
	const { userId } = useLocalSearchParams<{ userId?: string }>();
	const setDishes = useDishMediaEntriesStore((state) => state.setDishePromises);
	const [selectedTab, setSelectedTab] = useState<TabType>("reviews");
	const { BlurModal, open: openEditModal, close: closeEditModal } = useBlurModal({ intensity: 100 });
	const [editedBio, setEditedBio] = useState("");
	const [isFollowing, setIsFollowing] = useState(false);
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { isLoading: isInitialLoading, withLoading } = useWithLoading();
	const locale = useLocale();

	// API Data State
	const [profileData, setProfileData] = useState<ProfileData>({
		userDishMediaEntries: null,
		likedDishMediaEntries: null,
		savedTopics: null,
		savedDishMediaEntries: null,
	});

	// Pagination State for each tab
	const [paginationState, setPaginationState] = useState<Record<TabType, PaginationState>>({
		reviews: { cursor: null, hasNextPage: true, isLoadingMore: false },
		saved: { cursor: null, hasNextPage: true, isLoadingMore: false },
		liked: { cursor: null, hasNextPage: true, isLoadingMore: false },
		wallet: { cursor: null, hasNextPage: false, isLoadingMore: false },
	});

	const [fetchErrors, setFetchErrors] = useState<Record<TabType, string | null>>({
		reviews: null,
		saved: null,
		liked: null,
		wallet: null,
	});

	const [isRefreshing, setIsRefreshing] = useState(false);

	// Determine if this is the current user's profile or another user's
	const isOwnProfile = !userId || userId === userProfile.id;
	const profile = isOwnProfile ? userProfile : otherUserProfile;

	// Data fetching functions
	const fetchUserDishMediaEntries = useCallback(
		async (cursor?: string) => {
			try {
				if (!user?.id) {
					throw new Error("User not authenticated");
				}
				const response = await callBackend<QueryUserDishReviewsDto, QueryUserDishReviewsResponse>(
					`v1/users/${isOwnProfile ? user?.id : userId}/dish-reviews`,
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
					event_name: "fetch_user_dish_reviews_failed",
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

	const fetchLikedDishMediaEntries = useCallback(
		async (cursor?: string) => {
			try {
				const response = await callBackend<QueryMeLikedDishMediaDto, QueryMeLikedDishMediaResponse>(
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
					event_name: "fetch_liked_dish_media_failed",
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
				const response = await callBackend<QueryMeSavedDishCategoriesDto, QueryMeSavedDishCategoriesResponse>(
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

	const fetchSavedDishMediaEntries = useCallback(
		async (cursor?: string) => {
			try {
				const response = await callBackend<QueryMeSavedDishMediaDto, QueryMeSavedDishMediaResponse>(
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
					event_name: "fetch_saved_dish_media_entries_failed",
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

			setFetchErrors((prev) => ({ ...prev, [tab]: null }));

			try {
				let response;
				switch (tab) {
					case "reviews":
						const userDishMediaEntriesResponse = await fetchUserDishMediaEntries();
						setProfileData((prev) => ({ ...prev, userDishMediaEntries: userDishMediaEntriesResponse.data }));
						response = userDishMediaEntriesResponse;
						break;
					case "liked":
						if (!isOwnProfile) return;
						const likedDishMediaEntriesResponse = await fetchLikedDishMediaEntries();
						setProfileData((prev) => ({ ...prev, likedDishMediaEntries: likedDishMediaEntriesResponse.data }));
						response = likedDishMediaEntriesResponse;
						break;
					case "saved":
						if (!isOwnProfile) return;
						const [topicsResponse, dishMediaEntriesResponse] = await Promise.all([
							fetchSavedTopics(),
							fetchSavedDishMediaEntries(),
						]);
						setProfileData((prev) => ({
							...prev,
							savedTopics: topicsResponse.data,
							savedDishMediaEntries: dishMediaEntriesResponse.data,
						}));
						response = dishMediaEntriesResponse;
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
				const message = error instanceof Error ? error.message : "Failed to load data";
				setFetchErrors((prev) => ({ ...prev, [tab]: message }));
				setPaginationState((prev) => ({
					...prev,
					[tab]: { ...prev[tab], hasNextPage: false, isLoadingMore: false },
				}));
			}
		},
		[fetchUserDishMediaEntries, fetchLikedDishMediaEntries, fetchSavedTopics, fetchSavedDishMediaEntries, isOwnProfile],
	);

	// Load more data for infinite scroll
	const loadMoreData = useCallback(
		async (tab: TabType) => {
			const currentState = paginationState[tab];
			if (!currentState.cursor || !currentState.hasNextPage || currentState.isLoadingMore || tab === "wallet") return;

			setPaginationState((prev) => ({
				...prev,
				[tab]: { ...prev[tab], isLoadingMore: true },
			}));

			try {
				let response;
				switch (tab) {
					case "reviews":
						const userDishMediaEntriesresponse = await fetchUserDishMediaEntries(currentState.cursor || undefined);
						setProfileData((prev) => ({
							...prev,
							userDishMediaEntries: [...prev.userDishMediaEntries!, ...userDishMediaEntriesresponse.data],
						}));
						response = userDishMediaEntriesresponse;
						break;
					case "liked":
						const likedDishMediaEntriesResponse = await fetchLikedDishMediaEntries(currentState.cursor || undefined);
						setProfileData((prev) => ({
							...prev,
							likedDishMediaEntries: [...prev.likedDishMediaEntries!, ...likedDishMediaEntriesResponse.data],
						}));
						response = likedDishMediaEntriesResponse;
						break;
					case "saved":
						const topicsResponse = await fetchSavedTopics(currentState.cursor || undefined);
						setProfileData((prev) => ({
							...prev,
							savedTopics: topicsResponse.data,
						}));
						response = topicsResponse;
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
						cursor: paginationState[tab]?.cursor || "unknown",
					},
				});
				setPaginationState((prev) => ({
					...prev,
					[tab]: { ...prev[tab], isLoadingMore: false },
				}));
			}
		},
		[paginationState, fetchUserDishMediaEntries, fetchLikedDishMediaEntries, fetchSavedDishMediaEntries],
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
				withLoading(loadInitialData)(tab);
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
		// Load data for the new tab if it hasn't been loaded yet
		const currentData = getCurrentDishMediaEntriesForTab(selectedTab);
		if (currentData === null && selectedTab !== "wallet") {
			withLoading(loadInitialData)(selectedTab);
		}
	}, [selectedTab]);

	// Add wallet tab for own profile
	const availableTabs: TabType[] = isOwnProfile ? ["reviews", "saved", "liked", "wallet"] : ["reviews"];

	const formatNumber = (num: number): string => {
		if (num >= 1000000) {
			return (num / 1000000).toFixed(1).replace(/\.0$/, "") + i18n.t("Profile.numberSuffix.million");
		}
		if (num >= 1000) {
			return (num / 1000).toFixed(1).replace(/\.0$/, "") + i18n.t("Profile.numberSuffix.thousand");
		}
		return num.toString();
	};

	const getCurrentDishMediaEntries = (): DishMediaEntry[] => {
		switch (selectedTab) {
			case "reviews":
				return profileData.userDishMediaEntries ?? [];
			case "saved":
				return profileData.savedDishMediaEntries ?? [];
			case "wallet":
				return [];
			case "liked":
				return profileData.likedDishMediaEntries ?? [];
			default:
				return profileData.userDishMediaEntries ?? [];
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

	const handleDishMediaEntryPress = (index: number) => (item: DishMediaEntry) => {
		lightImpact();
		setDishes(selectedTab, Promise.resolve(getCurrentDishMediaEntries()));
		router.push({
			pathname: "/[locale]/(tabs)/profile/food",
			params: {
				locale,
				startIndex: index,
				tabName: selectedTab,
			},
		});

		logFrontendEvent({
			event_name: "dish_media_entry_selected",
			error_level: "log",
			payload: { item, selectedTab },
		});
	};

	const getCurrentDishMediaEntriesForTab = (tab: TabType): DishMediaEntry[] | null => {
		switch (tab) {
			case "reviews":
				return profileData.userDishMediaEntries;
			case "saved":
				return profileData.savedDishMediaEntries;
			case "liked":
				return profileData.likedDishMediaEntries;
			default:
				return [];
		}
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
	};

	// Create render functions for the new layout
	const renderEmptyComponent = (tab: TabType) => {
		const tabError = fetchErrors[tab];

		if (isInitialLoading) {
			return (
				<View style={styles.loadingContainer}>
					<ActivityIndicator size="large" color="#5EA2FF" />
					<Text style={styles.loadingText}>{i18n.t("Profile.loading")}</Text>
				</View>
			);
		}

		if (tabError) {
			return (
				<View style={styles.emptyStateContainer}>
					<View style={styles.emptyStateCard}>
						<Text style={styles.emptyStateText}>{i18n.t("Profile.tabError.failedToLoad", { error: tabError })}</Text>
						<TouchableOpacity style={styles.retryButton} onPress={() => refreshData(tab)}>
							<Text style={styles.retryButtonText}>{i18n.t("Profile.tabError.retry")}</Text>
						</TouchableOpacity>
					</View>
				</View>
			);
		}

		return (
			<View style={styles.emptyStateContainer}>
				<View style={styles.emptyStateCard}>
					<Text style={styles.emptyStateText}>
						{tab === "reviews"
							? i18n.t("Profile.emptyState.noDishReviews")
							: tab === "liked"
								? i18n.t("Profile.emptyState.noLikedDishMediaEntries")
								: i18n.t("Profile.emptyState.noSavedItems")}
					</Text>
				</View>
			</View>
		);
	};

	const handleItemPress = (item: DishMediaEntry, index: number) => {
		lightImpact();
		setDishes(selectedTab, Promise.resolve(getCurrentDishMediaEntries()));
		router.push({
			pathname: "/[locale]/(tabs)/profile/food",
			params: {
				locale,
				startIndex: index,
				tabName: selectedTab,
			},
		});

		logFrontendEvent({
			event_name: "dish_media_entry_selected",
			error_level: "log",
			payload: { item, selectedTab },
		});
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

			{/* New Profile Tabs Layout */}
			<ProfileTabsLayout
				profile={profile}
				isOwnProfile={isOwnProfile}
				isFollowing={isFollowing}
				profileData={profileData}
				onEditProfile={handleEditProfile}
				onFollow={handleFollow}
				onItemPress={handleItemPress}
				onEndReached={loadMoreData}
				onRefresh={refreshData}
				refreshing={isRefreshing}
				isLoadingMore={{
					reviews: paginationState.reviews.isLoadingMore,
					saved: paginationState.saved.isLoadingMore,
					liked: paginationState.liked.isLoadingMore,
					wallet: paginationState.wallet.isLoadingMore,
				}}
				renderEmptyComponent={renderEmptyComponent}
			/>

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
	dishMediaEntryContainer: {
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
	flatListContent: {
		paddingHorizontal: 16,
		marginVertical: 16,
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
