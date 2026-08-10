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
	const { locale } = useLocale();
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

			const entriesKey = makeDishMediaEntriesKey({
				categoryId: selectedTopic.id,
				location: { place_id: location.place_id },
				radius: DEFAULT_SEARCH_RADIUS,
				priceLevels: [...DEFAULT_PRICE_LEVELS],
				// #817 端末言語でレビューの並びが変わるためキーに含める
				viewerLanguageCode: locale,
			});

			// #1243 【設計】search/result.tsx と同じ Google Maps 退避導線を profile/search-results.tsx でも
			// 出せるようにするため、push の前に座標を解決する。
			// この画面が握っているのは place_id だけだが、退避先の URL には緯度経度が要る（lib/googleMaps.ts）。
			// expo-router は push 後に params を足せないので、渡すなら push 前に解決するしかない。
			//   - 呼び出し回数は増えない。従来も直後の getIds() の中で同じ getLocationDetails を 1 回呼んでいた。
			//     ここでは同じ Promise を使い回すので、ネットワーク呼び出しは今までどおり 1 回。
			//   - closeLocationModal() の閉じアニメーションと並走するため、体感の待ちはほぼ増えない。
			//   - 解決に失敗しても遷移は止めない（従来と同じ挙動）。座標が無ければ退避導線は出せないが、
			//     それは #1243 以前と同じ状態で、退避導線が減る方向の変化ではない。
			const locationDetailsPromise = getLocationDetails(location);
			const locationDetails = await locationDetailsPromise.catch(() => null);

			const { mediaIdsByKey, isLoadingByKey, upsertDishMediaEntries, updateMediaIdsByKeyAsync } =
				useDishMediaEntriesStore.getState();

			if (mediaIdsByKey[entriesKey] === undefined && !isLoadingByKey[entriesKey]) {
				const getIds = async () => {
					// Get location details including coordinates and language code
					// 失敗していた場合は元のエラーがそのまま伝播し、ストアは「0 件かつ非ロード中」になる（従来と同じ）。
					const locationDetails = await locationDetailsPromise;

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
					// #1243 0 件確定時の Google Maps 退避導線に使う（topics.tsx handleViewDetails と同じ形）。
					...(locationDetails && { location: JSON.stringify(locationDetails.location) }),
					// bulk-import に渡しているのと同じ文字列を渡す。表示名（labels[locale]）ではなく
					// 実際に検索したカテゴリ名を Google Maps のクエリにする（result.tsx の topic.category と同じ考え方）。
					category: selectedTopic.label_en,
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

	// #947 【仕様】空状態から検索画面へ1タップで戻れるCTA
	const handleSearchByMood = useCallback(() => {
		lightImpact();
		router.push({
			pathname: "/[locale]/(tabs)/search",
			params: { locale },
		});
		logFrontendEvent({
			event_name: "saved_topics_empty_cta_pressed",
			error_level: "log",
			payload: {},
		});
	}, [lightImpact, locale, logFrontendEvent]);

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
				emptyActionLabel={i18n.t("Profile.buttons.searchByMood")}
				onEmptyAction={handleSearchByMood}
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
