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
import type { LocationDetailsResponse, QueryMeSavedDishCategoriesResponse } from "@shared/api/v1/res";
import type { SelectedLocation } from "@/features/search/hooks/useLocationField";
import { useRecentLocations } from "@/features/search/hooks/useRecentLocations";
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
	// #1133 【設計】「最近使った場所」への登録はここで行う。登録できるのは details が解決した後
	// (＝遷移後に走る getIds() の中)であり、その時点でモーダル内の LocationSearchForm は
	// 閉じているため、フォーム側が持つ useLocationField の registerRecentLocation は使えない。
	// ストレージはホームと共有する(#953 の recent_locations_v1)ので、キーは増やさない。
	const { addRecentLocation } = useRecentLocations();

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
		async (selected: SelectedLocation) => {
			if (!selectedTopic) return;

			// Close modal first
			closeLocationModal();

			const { mediaIdsByKey, isLoadingByKey, upsertDishMediaEntries, updateMediaIdsByKeyAsync } =
				useDishMediaEntriesStore.getState();
			const entriesKey = makeDishMediaEntriesKey({
				categoryId: selectedTopic.id,
				// #1133 【設計】経路によって手元にある情報が違うため、location キーを作り分ける。
				// サジェストは place_id しか持たず(緯度経度は details API を叩くまで不明)、
				// 現在地・最近使った場所は緯度経度だけを持ち place_id を持たない。
				// makeDishMediaEntriesKey(#633) は両形式を受けるので、ここで詰め替えは不要。
				// ⚠️ 結果として同じ地点でも経路が違えば別キーになる(`pid:` と `ll:`)。これは
				// ホーム(常に `ll:`)と保存料理(従来 `pid:`)の間に元からある非対称で、今回広げない。
				location:
					selected.kind === "prediction"
						? { place_id: selected.prediction.place_id }
						: {
								latitude: selected.location.location.latitude,
								longitude: selected.location.location.longitude,
							},
				radius: DEFAULT_SEARCH_RADIUS,
				priceLevels: [...DEFAULT_PRICE_LEVELS],
				// #817 端末言語でレビューの並びが変わるためキーに含める
				viewerLanguageCode: locale,
			});

			if (mediaIdsByKey[entriesKey] === undefined && !isLoadingByKey[entriesKey]) {
				const getIds = async () => {
					// #1133 サジェスト経由だけ details を取りに行く。現在地・最近使った場所は緯度経度が
					// 確定済みなので、遷移前にも遷移後にも API 待ちを増やさない。
					let locationDetails: Omit<LocationDetailsResponse, "viewport">;
					if (selected.kind === "prediction") {
						const details = await getLocationDetails(selected.prediction);
						// #1133 【仕様】details が取れて初めて緯度経度が判るので、ここで初めて登録できる。
						// viewport はスプレッドすると型上は Omit していても実行時に残るため明示的に除く。
						// 最近使った場所経由は既にリストにあり、MRU の先頭移動(#1129)は useLocationField 側が担う。
						const { viewport: _viewport, ...locationWithoutViewport } = details;
						addRecentLocation({ ...locationWithoutViewport, locationQuery: selected.locationQuery });
						locationDetails = locationWithoutViewport;
					} else {
						locationDetails = selected.location;
					}

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

			// #1133 【既知の制約】getIds() は entriesKey が未取得のときしか走らないため、
			// 同じカテゴリ×同じ地点で 2 回目に検索したときは「最近使った場所」への登録が起きない。
			// 解消には遷移前に getLocationDetails を await する必要があり、モーダル上に
			// ローディングとエラー処理を新設することになるため今回は採らない(別 Issue)。

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
					location: selected.locationQuery,
					categoryId: selectedTopic.id,
					// #1133 どの経路で地点が決まったかを出所として残す(サジェスト / 現在地・最近使った場所)
					source: selected.kind,
				},
			});
		},
		[
			selectedTopic,
			closeLocationModal,
			createDishItemsPromise,
			locale,
			logFrontendEvent,
			getLocationDetails,
			addRecentLocation,
		],
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
