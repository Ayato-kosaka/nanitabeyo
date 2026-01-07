import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SaveTopicTab } from "./save/SaveTopicTab";
import { LocationSearchForm } from "../components/LocationSearchForm";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { useTopicSearch } from "@/features/topics/hooks/useTopicSearch";
import { useLocale } from "@/hooks/useLocale";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useTopicsStore, selectTopicIdsByKey, DishCategory } from "@/stores/useTopicsStore";
import type { QueryMeSavedDishCategoriesDto } from "@shared/api/v1/dto";
import type { QueryMeSavedDishCategoriesResponse } from "@shared/api/v1/res";
import type { AutocompleteLocation } from "@shared/api/v1/res";
import { shallow } from "zustand/shallow";
import { makeDishMediaEntriesKey } from "@/features/dishMedia/utils/dishMediaEntriesKey";
import { DEFAULT_PRICE_LEVELS, DEFAULT_SEARCH_RADIUS } from "@/features/topics/constants";

interface SavedTopicsTabProps {
	isOwnProfile: boolean;
}

export const profileSavedTopicsEntriesKey = "profileSavedTopics";

export function SavedTopicsTab({ isOwnProfile }: SavedTopicsTabProps) {
	const { userId } = useLocalSearchParams();
	const locale = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { createDishItemsPromise } = useTopicSearch();
	const { getLocationDetails } = useLocationSearch();

	const {
		ids: topicIds,
		isLoading,
		error,
		hasNextPage,
		isLoadingMore,
	} = useTopicsStore(selectTopicIdsByKey(profileSavedTopicsEntriesKey), shallow);

	// Location search modal state
	const [selectedTopic, setSelectedTopic] = useState<DishCategory | null>(null);
	const {
		BlurModal: LocationModal,
		open: openLocationModal,
		close: closeLocationModal,
	} = useBlurModal({
		intensity: 100,
	});

	// #472 【設計】初回マウント時にストアから保存トピックを取得
	useEffect(() => {
		const { fetchInitialByKey, hasFetchedInitialByKey } = useTopicsStore.getState();

		// 既に取得済みの場合はスキップ
		if (hasFetchedInitialByKey[profileSavedTopicsEntriesKey]) {
			return;
		}

		fetchInitialByKey(profileSavedTopicsEntriesKey, {} as QueryMeSavedDishCategoriesDto, async ({ cursor }) => {
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
		});
	}, [callBackend]);

	// #472 【設計】リフレッシュハンドラ（初期データを再取得）
	const handleRefresh = useCallback(async () => {
		const { fetchInitialByKey } = useTopicsStore.getState();
		await fetchInitialByKey(profileSavedTopicsEntriesKey, {} as QueryMeSavedDishCategoriesDto, async ({ cursor }) => {
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
		});
	}, [callBackend]);

	// #472 【設計】追加ページ取得ハンドラ
	const handleLoadMore = useCallback(async () => {
		if (!hasNextPage || isLoadingMore) return;

		const { fetchMoreByKey } = useTopicsStore.getState();
		await fetchMoreByKey(profileSavedTopicsEntriesKey, {} as QueryMeSavedDishCategoriesDto, async ({ cursor }) => {
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
		});
	}, [callBackend, hasNextPage, isLoadingMore]);

	const handleTopicPress = useCallback(
		(item: DishCategory, index: number) => {
			lightImpact();
			logFrontendEvent({
				event_name: "saved_topic_selected",
				error_level: "log",
				payload: { topicId: item.id, index },
			});

			// Set selected topic and open location modal
			setSelectedTopic(item);
			openLocationModal();
		},
		[lightImpact, logFrontendEvent, openLocationModal],
	);

	// Handle location selection from autocomplete
	const handleLocationSelect = useCallback(
		async (location: AutocompleteLocation) => {
			if (!selectedTopic) return;

			// Close modal first
			closeLocationModal();

			const { mediaIdsByKey, isLoadingByKey, upsertDishMediaEntries, updateMediaIdsByKeyAsync } =
				useDishMediaEntriesStore.getState();
			const entriesKey = makeDishMediaEntriesKey({
				categoryId: selectedTopic.id,
				location: { mainText: location.mainText },
				radius: DEFAULT_SEARCH_RADIUS,
				priceLevels: [...DEFAULT_PRICE_LEVELS],
			});

			if (mediaIdsByKey[entriesKey] === undefined && !isLoadingByKey[entriesKey]) {
				const getIds = async () => {
					// Get location details including coordinates and language code
					const locationDetails = await getLocationDetails(location);

					const dishItems = await createDishItemsPromise(
						selectedTopic.id,
						selectedTopic.label_en,
						locationDetails.location.latitude,
						locationDetails.location.longitude,
						locationDetails.localLanguageCode,
					);
					upsertDishMediaEntries(dishItems);
					return dishItems.map((item) => String(item.dish_media.id));
				};
				updateMediaIdsByKeyAsync(entriesKey, getIds(), (_, ids) => ids);
			}

			// Navigate to result screen (referenced from topics.tsx handleViewDetails)
			// Stay within profile tab as required
			router.push({
				pathname: "/[locale]/(tabs)/profile/search-results",
				params: {
					locale,
					entriesKey,
				},
			});

			logFrontendEvent({
				event_name: "saved_topic_location_selected",
				error_level: "log",
				payload: {
					topicId: selectedTopic.id,
					location: location.text,
					categoryId: selectedTopic.id,
				},
			});
		},
		[selectedTopic, closeLocationModal, createDishItemsPromise, locale, logFrontendEvent, getLocationDetails],
	);

	const handleLocationCancel = useCallback(() => {
		closeLocationModal();
	}, [closeLocationModal]);

	if (!isOwnProfile) {
		return (
			<View style={styles.privateContainer}>
				<View style={styles.privateCard}>
					<Text style={styles.privateText}>{i18n.t("Profile.privateContent")}</Text>
				</View>
			</View>
		);
	}

	return (
		<>
			<SaveTopicTab
				topicIds={topicIds}
				isLoading={isLoading}
				isLoadingMore={isLoadingMore}
				refreshing={isLoading}
				onRefresh={handleRefresh}
				onEndReached={handleLoadMore}
				onItemPress={handleTopicPress}
				error={error}
				onRetry={handleRefresh}
			/>

			{/* Location Search Modal - Updated to use render-prop pattern */}
			<LocationModal>
				{({ close }) => (
					<LocationSearchForm onSubmit={handleLocationSelect} onCancel={close} testID="saved-topic-location-search" />
				)}
			</LocationModal>
		</>
	);
}

const styles = StyleSheet.create({
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
});
