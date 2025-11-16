import React, { useCallback, useEffect, useState, useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SaveTopicTab } from "./save/SaveTopicTab";
import { LocationSearchForm } from "../components/LocationSearchForm";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { useTopicSearch } from "@/features/topics/hooks/useTopicSearch";
import { useLocale } from "@/hooks/useLocale";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useTopicStore } from "@/stores/useTopicStore";
import type { QueryMeSavedDishCategoriesDto } from "@shared/api/v1/dto";
import type { QueryMeSavedDishCategoriesResponse } from "@shared/api/v1/res";
import type { AutocompleteLocation } from "@shared/api/v1/res";

interface SavedTopicsTabProps {
	isOwnProfile: boolean;
}

export function SavedTopicsTab({ isOwnProfile }: SavedTopicsTabProps) {
	const { userId } = useLocalSearchParams();
	const locale = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const setDishes = useDishMediaEntriesStore((state) => state.setDishePromises);
	// #433 【設計】Topic ストアを使用（唯一のソースオブトゥルース）
	const { setTopic, topicsById } = useTopicStore();
	const { createDishItemsPromise } = useTopicSearch();
	const { getLocationDetails } = useLocationSearch();

	// Location search modal state
	const [selectedTopic, setSelectedTopic] = useState<QueryMeSavedDishCategoriesResponse["data"][number] | null>(null);
	const {
		BlurModal: LocationModal,
		open: openLocationModal,
		close: closeLocationModal,
	} = useBlurModal({
		intensity: 100,
	});

	if (!isOwnProfile) {
		return (
			<View style={styles.privateContainer}>
				<View style={styles.privateCard}>
					<Text style={styles.privateText}>{i18n.t("Profile.privateContent")}</Text>
				</View>
			</View>
		);
	}

	const topics = useCursorPagination<QueryMeSavedDishCategoriesDto, QueryMeSavedDishCategoriesResponse["data"][number]>(
		useCallback(
			async ({ cursor }) => {
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
			},
			[callBackend],
		),
	);

	useEffect(() => {
		topics.loadInitial();
	}, []);

	// #433 【設計】フェッチ結果をストアに保存
	useEffect(() => {
		if (topics.items.length > 0) {
			topics.items.forEach((item) => {
				// QueryMeSavedDishCategoriesResponse の item を Topic 型に変換
				const topicEntry = {
					category: item.label_en,
					topicTitle: item.label_en,
					reason: "", // saved topics don't have reason
					categoryId: item.id,
					imageUrl: item.image_url || "",
					dishItemsPromise: Promise.resolve([]), // placeholder, will be updated on selection
					isSaved: true, // saved topics are marked as saved
				};
				setTopic(item.id, topicEntry);
			});
		}
	}, [topics.items, setTopic]);

	// #433 【設計】表示用データはストアから取得（保存状態の即時反映）
	const displayItems = useMemo(() => {
		return topics.items.filter((item) => {
			const storeEntry = topicsById[item.id];
			// 保存済みアイテムのみ表示（楽観的更新で unsave した場合は非表示）
			return storeEntry?.isSaved ?? true;
		});
	}, [topics.items, topicsById]);

	const handleTopicPress = useCallback(
		(item: any, index: number) => {
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

			try {
				// Close modal first
				closeLocationModal();

				// Get location details including coordinates and language code
				const locationDetails = await getLocationDetails(location);

				const dishItemsPromise = createDishItemsPromise(
					selectedTopic.id,
					selectedTopic.label_en,
					locationDetails.location.latitude,
					locationDetails.location.longitude,
					locationDetails.localLanguageCode,
				);

				// Set to store
				setDishes(selectedTopic.id, dishItemsPromise);

				// Navigate to result screen (referenced from topics.tsx handleViewDetails)
				// Stay within profile tab as required
				router.push({
					pathname: "/[locale]/(tabs)/profile/search-results",
					params: {
						locale,
						topicId: selectedTopic.id,
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
			} catch (error) {
				console.error("Error handling location selection:", error);
				logFrontendEvent({
					event_name: "saved_topic_navigation_failed",
					error_level: "error",
					payload: {
						selectedTopic,
						error: error instanceof Error ? error.message : String(error),
					},
				});
			}
		},
		[
			selectedTopic,
			closeLocationModal,
			createDishItemsPromise,
			setDishes,
			locale,
			logFrontendEvent,
			getLocationDetails,
		],
	);

	const handleLocationCancel = useCallback(() => {
		closeLocationModal();
	}, [closeLocationModal]);

	const error = topics.error ? (topics.error instanceof Error ? topics.error.message : String(topics.error)) : null;

	return (
		<>
			<SaveTopicTab
				data={displayItems}
				isLoading={topics.isLoadingInitial}
				isLoadingMore={topics.isLoadingMore}
				refreshing={topics.isLoadingInitial}
				onRefresh={topics.refresh}
				onEndReached={topics.loadMore}
				onItemPress={handleTopicPress}
				error={error}
				onRetry={topics.refresh}
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
