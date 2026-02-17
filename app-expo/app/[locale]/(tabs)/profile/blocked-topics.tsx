import React, { useCallback, useEffect, useState, useRef } from "react";
import {
	View,
	Text,
	StyleSheet,
	FlatList,
	TouchableOpacity,
	Image,
	ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import i18n from "@/lib/i18n";
import { useDialog } from "@/contexts/DialogProvider";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useAPICall } from "@/hooks/useAPICall";
import { useLocale } from "@/hooks/useLocale";
import { QueryMeBlockedDishCategoriesResponse, UnblockDishCategoryResponse } from "@shared/api/v1/res";
import type { SupabaseDishCategories } from "@shared/converters/convert_dish_categories";

type BlockedCategory = SupabaseDishCategories;

export default function BlockedTopicsScreen() {
	const { showDialog } = useDialog();
	const { showSnackbar } = useSnackbar();
	const { callBackend } = useAPICall();
	const { locale } = useLocale();
	const [categories, setCategories] = useState<BlockedCategory[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(true);
	const isFetchingRef = useRef(false);

	// #【設計】ブロック済みカテゴリを取得（cursor対応）
	const fetchBlockedCategories = useCallback(
		async (cursor?: string) => {
			if (isFetchingRef.current) return;
			isFetchingRef.current = true;

			try {
				const isFirstLoad = !cursor;
				if (isFirstLoad) {
					setIsLoading(true);
				} else {
					setIsLoadingMore(true);
				}

				const params = new URLSearchParams();
				if (cursor) params.append("cursor", cursor);

				const response = await callBackend<Record<string, never>, QueryMeBlockedDishCategoriesResponse>(
					`/v1/users/me/blocked-dish-categories?${params.toString()}`,
					{
						method: "GET",
						requestPayload: {},
					},
				);

				if (isFirstLoad) {
					setCategories(response.data);
				} else {
					setCategories((prev) => [...prev, ...response.data]);
				}

				setNextCursor(response.nextCursor);
				setHasMore(!!response.nextCursor);
			} catch (error) {
				console.error("Failed to fetch blocked categories:", error);
				showSnackbar(i18n.t("Common.error"));
			} finally {
				setIsLoading(false);
				setIsLoadingMore(false);
				isFetchingRef.current = false;
			}
		},
		[callBackend, showSnackbar],
	);

	// #【設計】初回ロード
	useEffect(() => {
		fetchBlockedCategories();
	}, []);

	// #【設計】無限スクロール：次ページを読み込み
	const handleLoadMore = useCallback(() => {
		if (!isLoadingMore && hasMore && nextCursor) {
			fetchBlockedCategories(nextCursor);
		}
	}, [isLoadingMore, hasMore, nextCursor, fetchBlockedCategories]);

	// #【設計】ブロック解除API呼び出し
	const handleUnblock = useCallback(
		(category: BlockedCategory) => {
			const localeCode = locale.split("-")[0];
			const labels = (category.labels || {}) as Record<string, string>;
			const categoryLabel = labels[localeCode] || labels.en || category.label_en || category.id;

			showDialog(i18n.t("Settings.blockedTopics.unblockMessage"), {
				title: i18n.t("Settings.blockedTopics.unblockTitle"),
				okLabel: i18n.t("Settings.blockedTopics.unblockConfirm"),
				cancelLabel: i18n.t("Common.cancel"),
				onConfirm: async () => {
					try {
						await callBackend<Record<string, never>, UnblockDishCategoryResponse>(
							`/v1/users/me/blocked-dish-categories/${category.id}`,
							{
								method: "DELETE",
								requestPayload: {},
							},
						);

						// #【設計】成功時は該当行を除去
						setCategories((prev) => prev.filter((item) => item.id !== category.id));
						showSnackbar(i18n.t("Settings.blockedTopics.unblocked"));
					} catch (error) {
						console.error("Failed to unblock category:", error);
						showSnackbar(i18n.t("Common.error"));
					}
				},
			});
		},
		[callBackend, showDialog, showSnackbar, locale],
	);

	// #【設計】リストアイテムのレンダリング
	const renderItem = useCallback(
		({ item }: { item: BlockedCategory }) => {
			const localeCode = locale.split("-")[0];
			const labels = (item.labels || {}) as Record<string, string>;
			const categoryLabel = labels[localeCode] || labels.en || item.label_en || item.id;

			return (
				<View style={styles.itemContainer}>
					<Image source={{ uri: item.image_url || "" }} style={styles.categoryImage} />
					<Text style={styles.categoryLabel}>{categoryLabel}</Text>
					<TouchableOpacity style={styles.unblockButton} onPress={() => handleUnblock(item)}>
						<Text style={styles.unblockButtonText}>{i18n.t("Settings.blockedTopics.unblockButton")}</Text>
					</TouchableOpacity>
				</View>
			);
		},
		[handleUnblock, locale],
	);

	// #【設計】フッター：次ページ読み込みインジケータ
	const renderFooter = useCallback(() => {
		if (!isLoadingMore) return null;
		return (
			<View style={styles.footerLoader}>
				<ActivityIndicator size="small" color="#1A1A1A" />
			</View>
		);
	}, [isLoadingMore]);

	// #【設計】空表示
	const renderEmpty = useCallback(() => {
		if (isLoading) return null;
		return (
			<View style={styles.emptyContainer}>
				<Text style={styles.emptyText}>{i18n.t("Settings.blockedTopics.empty")}</Text>
			</View>
		);
	}, [isLoading]);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<Stack.Screen
				options={{
					title: i18n.t("Settings.blockedTopics.pageTitle"),
					headerBackTitle: i18n.t("Common.back"),
				}}
			/>
			<SafeAreaView style={styles.safeArea} edges={["bottom"]}>
				{isLoading ? (
					<View style={styles.loaderContainer}>
						<ActivityIndicator size="large" color="#1A1A1A" />
					</View>
				) : (
					<FlatList
						data={categories}
						keyExtractor={(item) => item.id}
						renderItem={renderItem}
						ListEmptyComponent={renderEmpty}
						ListFooterComponent={renderFooter}
						onEndReached={handleLoadMore}
						onEndReachedThreshold={0.5}
						contentContainerStyle={styles.listContent}
					/>
				)}
			</SafeAreaView>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	safeArea: {
		flex: 1,
	},
	loaderContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	listContent: {
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
	itemContainer: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#FFFFFF",
		borderRadius: 12,
		padding: 12,
		marginBottom: 12,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.05,
		shadowRadius: 2,
		elevation: 2,
	},
	categoryImage: {
		width: 56,
		height: 56,
		borderRadius: 8,
		backgroundColor: "#F3F4F6",
	},
	categoryLabel: {
		flex: 1,
		fontSize: 16,
		fontWeight: "500",
		color: "#1A1A1A",
		marginLeft: 12,
	},
	unblockButton: {
		paddingHorizontal: 16,
		paddingVertical: 8,
		backgroundColor: "#F3F4F6",
		borderRadius: 8,
	},
	unblockButtonText: {
		fontSize: 14,
		fontWeight: "600",
		color: "#1A1A1A",
	},
	emptyContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingVertical: 60,
	},
	emptyText: {
		fontSize: 16,
		color: "#6B7280",
	},
	footerLoader: {
		paddingVertical: 20,
		alignItems: "center",
	},
});
