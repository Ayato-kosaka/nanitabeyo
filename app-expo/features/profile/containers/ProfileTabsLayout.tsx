import React, { useState, useCallback, useMemo, useEffect } from "react";
import { View, StyleSheet, LayoutChangeEvent, Text, TextInput } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Tabs } from "@/components/collapsible-tabs";
import { ProfileHeader } from "../components/ProfileHeader";
import { ProfileTabsBar, ProfileTabsBarProps } from "../components/ProfileTabsBar";
import { ReviewTab } from "../tabs/ReviewTab";
import { LikeTab } from "../tabs/LikeTab";
import { SaveTab } from "../tabs/SaveTab";
import { WalletTab } from "../tabs/WalletTab";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useAPICall } from "@/hooks/useAPICall";
import { useWithLoading } from "@/hooks/useWithLoading";
import { useAuth } from "@/contexts/AuthProvider";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useLocale } from "@/hooks/useLocale";
import { useBlurModal } from "@/hooks/useBlurModal";
import { userProfile, otherUserProfile } from "@/data/profileData";
import { mockBids, mockEarnings } from "../constants";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import type { TabBarProps } from "react-native-collapsible-tab-view";
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

interface ProfileTabsLayoutProps {
	// Add props as needed for data fetching and state management
}

export function ProfileTabsLayout({}: ProfileTabsLayoutProps) {
	const { userId } = useLocalSearchParams();
	const { mediumImpact, lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { isLoading: isInitialLoading, withLoading } = useWithLoading();
	const { user } = useAuth();
	const { setDishePromises } = useDishMediaEntriesStore();
	const locale = useLocale();
	const { BlurModal, open: openEditModal, close: closeEditModal } = useBlurModal({ intensity: 100 });

	const [headerHeight, setHeaderHeight] = useState(0);
	const [isFollowing, setIsFollowing] = useState(false);
	const [editedBio, setEditedBio] = useState("");
	const [selectedTab, setSelectedTab] = useState<TabType>("reviews");

	// Determine if this is own profile
	const isOwnProfile = !userId || userId === "me";
	const profile = isOwnProfile ? userProfile : otherUserProfile;

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

	// Available tabs based on profile ownership
	const availableTabs: TabType[] = useMemo(() => {
		const tabs: TabType[] = ["reviews"];
		if (isOwnProfile) {
			tabs.push("saved", "liked", "wallet");
		}
		return tabs;
	}, [isOwnProfile]);

	// API Functions
	const fetchUserDishMediaEntries = useCallback(
		async (cursor?: string) => {
			try {
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
		[callBackend, isOwnProfile, userId, user?.id, logFrontendEvent],
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
		[callBackend, logFrontendEvent],
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
		[callBackend, logFrontendEvent],
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
		[callBackend, logFrontendEvent],
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
						const [savedTopicsResponse, savedDishMediaEntriesResponse] = await Promise.all([
							fetchSavedTopics(),
							fetchSavedDishMediaEntries(),
						]);
						setProfileData((prev) => ({
							...prev,
							savedTopics: savedTopicsResponse.data,
							savedDishMediaEntries: savedDishMediaEntriesResponse.data,
						}));
						response = savedTopicsResponse; // Use topics response for pagination
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
				const errorMessage = error instanceof Error ? error.message : String(error);
				setFetchErrors((prev) => ({ ...prev, [tab]: errorMessage }));
			}
		},
		[fetchUserDishMediaEntries, fetchLikedDishMediaEntries, fetchSavedTopics, fetchSavedDishMediaEntries, isOwnProfile],
	);

	// Load more data for pagination
	const loadMoreData = useCallback(
		async (tab: TabType) => {
			if (
				!paginationState[tab].cursor ||
				tab === "wallet" ||
				!paginationState[tab].hasNextPage ||
				paginationState[tab].isLoadingMore
			)
				return;

			setPaginationState((prev) => ({
				...prev,
				[tab]: { ...prev[tab], isLoadingMore: true },
			}));

			try {
				let response;
				switch (tab) {
					case "reviews":
						const userDishMediaEntriesresponse = await fetchUserDishMediaEntries(
							paginationState[tab].cursor || undefined,
						);
						setProfileData((prev) => ({
							...prev,
							userDishMediaEntries: [...prev.userDishMediaEntries!, ...userDishMediaEntriesresponse.data],
						}));
						response = userDishMediaEntriesresponse;
						break;
					case "liked":
						if (!isOwnProfile) return;
						const likedDishMediaEntriesResponse = await fetchLikedDishMediaEntries(
							paginationState[tab].cursor || undefined,
						);
						setProfileData((prev) => ({
							...prev,
							likedDishMediaEntries: [...prev.likedDishMediaEntries!, ...likedDishMediaEntriesResponse.data],
						}));
						response = likedDishMediaEntriesResponse;
						break;
					case "saved":
						if (!isOwnProfile) return;
						const [savedTopicsResponse, savedDishMediaEntriesResponse] = await Promise.all([
							fetchSavedTopics(paginationState[tab].cursor || undefined),
							fetchSavedDishMediaEntries(paginationState[tab].cursor || undefined),
						]);
						setProfileData((prev) => ({
							...prev,
							savedTopics: [...(prev.savedTopics || []), ...savedTopicsResponse.data],
							savedDishMediaEntries: [...(prev.savedDishMediaEntries || []), ...savedDishMediaEntriesResponse.data],
						}));
						response = savedTopicsResponse; // Use topics response for pagination
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
				setPaginationState((prev) => ({
					...prev,
					[tab]: { ...prev[tab], isLoadingMore: false },
				}));
			}
		},
		[
			paginationState,
			fetchUserDishMediaEntries,
			fetchLikedDishMediaEntries,
			fetchSavedTopics,
			fetchSavedDishMediaEntries,
			isOwnProfile,
		],
	);

	// Get current dish media entries for store
	const getCurrentDishMediaEntries = useCallback(() => {
		switch (selectedTab) {
			case "reviews":
				return profileData.userDishMediaEntries || [];
			case "liked":
				return profileData.likedDishMediaEntries || [];
			case "saved":
				return profileData.savedDishMediaEntries || [];
			default:
				return [];
		}
	}, [selectedTab, profileData]);

	// Load initial data when component mounts
	useEffect(() => {
		withLoading(() => loadInitialData("reviews"));
	}, [loadInitialData, withLoading]);
	// Event handlers
	const handleDishMediaEntryPress = useCallback(
		(index: number) => (item: DishMediaEntry) => {
			lightImpact();
			setDishePromises(selectedTab, Promise.resolve(getCurrentDishMediaEntries()));
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
		},
		[lightImpact, setDishePromises, selectedTab, getCurrentDishMediaEntries, router, locale, logFrontendEvent],
	);

	const handleHeaderLayout = useCallback((event: LayoutChangeEvent) => {
		const { height } = event.nativeEvent.layout;
		setHeaderHeight(height);
	}, []);

	const handleBack = useCallback(() => {
		router.back();
	}, []);

	const handleShareProfile = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "profile_shared",
			error_level: "log",
			payload: {
				userId: profile.id,
				username: profile.username,
			},
		});
	}, [lightImpact, logFrontendEvent, profile]);

	const handleFollow = useCallback(() => {
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
	}, [mediumImpact, isFollowing, logFrontendEvent, profile]);

	const handleEditProfile = useCallback(() => {
		lightImpact();
		setEditedBio(profile.bio);
		openEditModal();

		logFrontendEvent({
			event_name: "profile_edit_started",
			error_level: "log",
			payload: { currentBioLength: profile.bio.length },
		});
	}, [lightImpact, profile.bio, openEditModal, logFrontendEvent]);

	const handleSaveProfile = useCallback(() => {
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
	}, [mediumImpact, closeEditModal, logFrontendEvent, profile.bio.length, editedBio.length]);

	const handleTabChange = useCallback(
		(index: number) => {
			const tabName = availableTabs[index];
			setSelectedTab(tabName);

			// Load data for the newly selected tab if not already loaded
			if (
				tabName !== "reviews" &&
				!profileData[tabName === "saved" ? "savedTopics" : (`${tabName}DishMediaEntries` as keyof ProfileData)]
			) {
				withLoading(() => loadInitialData(tabName));
			}

			logFrontendEvent({
				event_name: "profile_tab_changed",
				error_level: "log",
				payload: {
					tabName,
					userId: profile.id,
				},
			});
		},
		[availableTabs, profileData, loadInitialData, withLoading, logFrontendEvent, profile.id],
	);

	// Render header component
	const renderHeader = useCallback(() => {
		return (
			<ProfileHeader
				profile={profile}
				isOwnProfile={isOwnProfile}
				isFollowing={isFollowing}
				onLayout={handleHeaderLayout}
				onBack={handleBack}
				onShare={handleShareProfile}
				onSettings={() => {}} // TODO: Implement settings handler
				onEditProfile={handleEditProfile}
				onFollow={handleFollow}
				onMessage={() => {}} // TODO: Implement message handler
			/>
		);
	}, [
		profile,
		isOwnProfile,
		isFollowing,
		handleHeaderLayout,
		handleBack,
		handleShareProfile,
		handleEditProfile,
		handleFollow,
	]);

	// Render tab bar component
	const renderTabBar = useCallback(
		(props: TabBarProps<string>) => {
			return <ProfileTabsBar {...props} availableTabs={availableTabs} />;
		},
		[availableTabs],
	);

	return (
		<View style={styles.container}>
			<Tabs.Container
				headerHeight={headerHeight}
				renderHeader={renderHeader}
				renderTabBar={renderTabBar}
				onIndexChange={handleTabChange}
				pagerProps={{ scrollEnabled: true }}>
				<Tabs.Tab name="reviews">
					<ReviewTab
						data={profileData.userDishMediaEntries || []}
						isLoading={isInitialLoading && selectedTab === "reviews"}
						isLoadingMore={paginationState.reviews.isLoadingMore}
						refreshing={false}
						onRefresh={() => withLoading(() => loadInitialData("reviews"))}
						onEndReached={() => loadMoreData("reviews")}
						onItemPress={(item, index) => handleDishMediaEntryPress(index)(item)}
					/>
				</Tabs.Tab>

				<Tabs.Tab name="saved">
					<SaveTab
						savedTopics={profileData.savedTopics || []}
						savedPosts={profileData.savedDishMediaEntries || []}
						isOwnProfile={isOwnProfile}
						isLoading={isInitialLoading && selectedTab === "saved"}
						isLoadingMore={paginationState.saved.isLoadingMore}
						refreshing={false}
						onRefresh={() => withLoading(() => loadInitialData("saved"))}
						onEndReached={() => loadMoreData("saved")}
						onTopicPress={(item, index) => {
							// TODO: Handle topic press - implement topic navigation
							logFrontendEvent({
								event_name: "saved_topic_selected",
								error_level: "log",
								payload: { topicId: item.id, index },
							});
						}}
						onPostPress={(item, index) => handleDishMediaEntryPress(index)(item)}
					/>
				</Tabs.Tab>

				<Tabs.Tab name="liked">
					<LikeTab
						data={profileData.likedDishMediaEntries || []}
						isLoading={isInitialLoading && selectedTab === "liked"}
						isLoadingMore={paginationState.liked.isLoadingMore}
						refreshing={false}
						onRefresh={() => withLoading(() => loadInitialData("liked"))}
						onEndReached={() => loadMoreData("liked")}
						onItemPress={(item, index) => handleDishMediaEntryPress(index)(item)}
					/>
				</Tabs.Tab>

				<Tabs.Tab name="wallet">
					<WalletTab
						deposits={mockBids}
						earnings={mockEarnings}
						onDepositPress={(item, index) => {
							lightImpact();
							logFrontendEvent({
								event_name: "deposit_item_selected",
								error_level: "log",
								payload: { depositId: item.id, index },
							});
							// TODO: Handle deposit press - implement deposit detail navigation
						}}
						onEarningPress={(item, index) => {
							lightImpact();
							logFrontendEvent({
								event_name: "earning_item_selected",
								error_level: "log",
								payload: { earningId: item.id, index },
							});
							// TODO: Handle earning press - implement earning detail navigation
						}}
					/>
				</Tabs.Tab>
			</Tabs.Container>

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
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
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
});
