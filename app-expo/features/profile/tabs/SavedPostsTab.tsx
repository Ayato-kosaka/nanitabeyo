import React, { useCallback, useEffect, useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { SavePostTab } from "./save/SavePostTab";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useLocale } from "@/hooks/useLocale";
import { router } from "expo-router";
import type { QueryMeSavedDishMediaDto } from "@shared/api/v1/dto";
import type { QueryMeSavedDishMediaResponse, DishMediaEntry } from "@shared/api/v1/res";

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

	const posts = useCursorPagination<QueryMeSavedDishMediaDto, QueryMeSavedDishMediaResponse["data"][number]>(
		useCallback(
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
		),
	);

	useEffect(() => {
		posts.loadInitial();
	}, []);

	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { setDishePromises, setDishEntry, dishEntriesById } = useDishMediaEntriesStore();
	const locale = useLocale();

	// #433 【設計】フェッチ結果をストアに保存（Promise と個別エンティティの両方）
	useEffect(() => {
		if (posts.items.length > 0) {
			setDishePromises("saved", Promise.resolve(posts.items));
			posts.items.forEach((item) => {
				setDishEntry(item.dish_media.id, item);
			});
		}
	}, [posts.items, setDishePromises, setDishEntry]);

	// #433 【設計】表示用データはストアから取得（保存状態の即時反映）
	const displayItems = useMemo(() => {
		return posts.items.map((item) => {
			const storeEntry = dishEntriesById[item.dish_media.id];
			// ストアに最新状態があればそれを使用、なければフェッチ結果を使用
			return storeEntry || item;
		}).filter((item) => {
			// 保存済みアイテムのみ表示（楽観的更新で unsave した場合は非表示）
			const storeEntry = dishEntriesById[item.dish_media.id];
			return storeEntry?.isSaved ?? item.dish_media.isSaved;
		});
	}, [posts.items, dishEntriesById]);

	const handlePostPress = useCallback(
		(item: QueryMeSavedDishMediaResponse["data"][number], index: number) => {
			lightImpact();
			// #433 【設計】displayItems を使用（ストアから最新状態を取得したデータ）
			setDishePromises("saved", Promise.resolve(displayItems));
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
		[lightImpact, setDishePromises, displayItems, locale, logFrontendEvent],
	);

	const error = posts.error ? (posts.error instanceof Error ? posts.error.message : String(posts.error)) : null;

	return (
		<SavePostTab
			data={displayItems}
			isLoading={posts.isLoadingInitial}
			isLoadingMore={posts.isLoadingMore}
			refreshing={posts.isLoadingInitial}
			onRefresh={posts.refresh}
			onEndReached={posts.loadMore}
			onItemPress={handlePostPress}
			error={error}
			onRetry={posts.refresh}
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
