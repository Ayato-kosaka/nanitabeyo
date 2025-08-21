import { useState, useCallback } from "react";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { useAuth } from "@/contexts/AuthProvider";
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

export function useProfileQueries(userId?: string) {
	const { user } = useAuth();
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();

	const isOwnProfile = !userId || userId === user?.id;

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
		[callBackend, logFrontendEvent, user?.id, isOwnProfile, userId],
	);

	const fetchLikedDishMediaEntries = useCallback(
		async (cursor?: string) => {
			try {
				if (!user?.id) {
					throw new Error("User not authenticated");
				}
				const response = await callBackend<QueryMeLikedDishMediaDto, QueryMeLikedDishMediaResponse>(
					"v1/me/liked-dish-media",
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
		[callBackend, logFrontendEvent, user?.id],
	);

	const fetchSavedDishMediaEntries = useCallback(
		async (cursor?: string) => {
			try {
				if (!user?.id) {
					throw new Error("User not authenticated");
				}
				const response = await callBackend<QueryMeSavedDishMediaDto, QueryMeSavedDishMediaResponse>(
					"v1/me/saved-dish-media",
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
					event_name: "fetch_saved_dish_media_failed",
					error_level: "log",
					payload: {
						error: error instanceof Error ? error.message : String(error),
						cursor: cursor || "initial",
					},
				});
				throw error;
			}
		},
		[callBackend, logFrontendEvent, user?.id],
	);

	// Load initial data for a tab
	const loadInitialData = useCallback(
		async (tab: TabType) => {
			if (tab === "wallet") return;

			try {
				setFetchErrors((prev) => ({ ...prev, [tab]: null }));

				let response: any;
				switch (tab) {
					case "reviews":
						response = await fetchUserDishMediaEntries();
						setProfileData((prev) => ({
							...prev,
							userDishMediaEntries: response.data,
						}));
						break;
					case "liked":
						response = await fetchLikedDishMediaEntries();
						setProfileData((prev) => ({
							...prev,
							likedDishMediaEntries: response.data,
						}));
						break;
					case "saved":
						response = await fetchSavedDishMediaEntries();
						setProfileData((prev) => ({
							...prev,
							savedDishMediaEntries: response.data,
						}));
						break;
				}

				setPaginationState((prev) => ({
					...prev,
					[tab]: {
						cursor: response?.nextCursor || null,
						hasNextPage: !!response?.nextCursor,
						isLoadingMore: false,
					},
				}));
			} catch (error) {
				setFetchErrors((prev) => ({
					...prev,
					[tab]: error instanceof Error ? error.message : String(error),
				}));
			}
		},
		[fetchUserDishMediaEntries, fetchLikedDishMediaEntries, fetchSavedDishMediaEntries],
	);

	// Load more data for a tab
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
						const savedDishMediaEntriesResponse = await fetchSavedDishMediaEntries(currentState.cursor || undefined);
						setProfileData((prev) => ({
							...prev,
							savedDishMediaEntries: [...prev.savedDishMediaEntries!, ...savedDishMediaEntriesResponse.data],
						}));
						response = savedDishMediaEntriesResponse;
						break;
				}

				setPaginationState((prev) => ({
					...prev,
					[tab]: {
						cursor: response?.nextCursor || null,
						hasNextPage: !!response?.nextCursor,
						isLoadingMore: false,
					},
				}));
			} catch (error) {
				setPaginationState((prev) => ({
					...prev,
					[tab]: { ...prev[tab], isLoadingMore: false },
				}));
				setFetchErrors((prev) => ({
					...prev,
					[tab]: error instanceof Error ? error.message : String(error),
				}));
			}
		},
		[paginationState, fetchUserDishMediaEntries, fetchLikedDishMediaEntries, fetchSavedDishMediaEntries],
	);

	// Refresh data for a tab
	const refreshData = useCallback(
		async (tab: TabType) => {
			setPaginationState((prev) => ({
				...prev,
				[tab]: { cursor: null, hasNextPage: true, isLoadingMore: false },
			}));
			setFetchErrors((prev) => ({ ...prev, [tab]: null }));

			switch (tab) {
				case "reviews":
					setProfileData((prev) => ({ ...prev, userDishMediaEntries: null }));
					break;
				case "liked":
					setProfileData((prev) => ({ ...prev, likedDishMediaEntries: null }));
					break;
				case "saved":
					setProfileData((prev) => ({ ...prev, savedDishMediaEntries: null }));
					break;
			}

			await loadInitialData(tab);
		},
		[loadInitialData],
	);

	// Get current data for a tab
	const getCurrentDishMediaEntriesForTab = useCallback(
		(tab: TabType): DishMediaEntry[] | null => {
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
		},
		[profileData],
	);

	return {
		profileData,
		paginationState,
		fetchErrors,
		loadInitialData,
		loadMoreData,
		refreshData,
		getCurrentDishMediaEntriesForTab,
	};
}
