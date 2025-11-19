// #454 【設計】useDishMediaEntriesStore のページネーションAPIを使用してサムネイル表示
import React, { useCallback, useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { SavePostTab } from "./save/SavePostTab";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useLocale } from "@/hooks/useLocale";
import { router } from "expo-router";
import type { QueryMeSavedDishMediaDto } from "@shared/api/v1/dto";
import type { QueryMeSavedDishMediaResponse, DishMediaEntry } from "@shared/api/v1/res";
import type { Fetcher } from "@/lib/createCursorController";

interface SavedPostsTabProps {
	isOwnProfile: boolean;
}

export function SavedPostsTab({ isOwnProfile }: SavedPostsTabProps) {
	if (!isOwnProfile) {
		return (
			<View style={styles.privateContainer}>
				<View style={styles.privateCard}>
					<Text style={styles.privateText}>{i18n.t("Profile.privateContent")}</Text>
				</View>
			</View>
		);
	}

	const { callBackend } = useAPICall();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const locale = useLocale();

	// #454 【設計】ストアの画面用途キー（このタブ専用）
	const storeKey = "profileSaved";

	const {
		fetchInitialByKey,
		fetchMoreByKey,
		refreshByKey,
		selectIdsByKey,
		selectEntryById,
		isLoadingByKey,
		isLoadingMoreByKey,
		errorByKey,
		setDishePromises, // 旧互換のため残す（遷移先が使用）
	} = useDishMediaEntriesStore();

	// #454 【設計】データ取得関数（Fetcher型）
	const fetcher = useCallback<Fetcher<QueryMeSavedDishMediaDto, DishMediaEntry>>(
		async ({ cursor }) => {
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
		},
		[callBackend],
	);

	// #454 【設計】初期ロード
	useEffect(() => {
		fetchInitialByKey(storeKey, {}, fetcher);
	}, [storeKey, fetchInitialByKey, fetcher]);

	// #454 【設計】ストアから正規化データを取得
	const mediaIds = selectIdsByKey(storeKey);
	const items = mediaIds.map((id) => selectEntryById(id)).filter((item): item is DishMediaEntry => item !== undefined);

	const handlePostPress = useCallback(
		(item: DishMediaEntry, index: number) => {
			lightImpact();
			// #454 【設計】遷移先が旧実装（dishPromisesMap）を使用しているため、
			// 互換性のため setDishePromises を呼び出す
			setDishePromises("saved", Promise.resolve(items));
			router.push({
				pathname: "/[locale]/(tabs)/profile/food",
				params: { locale, startIndex: index, tabName: "saved" },
			});
			logFrontendEvent({
				event_name: "dish_media_entry_selected",
				error_level: "log",
				payload: { item, tabName: "saved" },
			});
		},
		[lightImpact, setDishePromises, items, locale, logFrontendEvent],
	);

	const error = errorByKey[storeKey];
	const errorMessage = error ? (typeof error === "string" ? error : String(error)) : null;

	const handleLoadMore = useCallback(() => {
		fetchMoreByKey(storeKey, fetcher);
	}, [storeKey, fetchMoreByKey, fetcher]);

	const handleRefresh = useCallback(() => {
		refreshByKey(storeKey);
	}, [storeKey, refreshByKey]);

	return (
		<SavePostTab
			data={items}
			isLoading={isLoadingByKey[storeKey] || false}
			isLoadingMore={isLoadingMoreByKey[storeKey] || false}
			refreshing={isLoadingByKey[storeKey] || false}
			onRefresh={handleRefresh}
			onEndReached={handleLoadMore}
			onItemPress={handlePostPress}
			error={errorMessage}
			onRetry={handleRefresh}
		/>
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
