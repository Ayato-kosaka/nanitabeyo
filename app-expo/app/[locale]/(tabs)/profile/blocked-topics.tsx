import React, { useCallback, useEffect, useState, useRef } from "react";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import i18n from "@/lib/i18n";
import { useDialog } from "@/contexts/DialogProvider";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useAPICall } from "@/hooks/useAPICall";
import { useLocale } from "@/hooks/useLocale";
import { QueryMeBlockedDishCategoriesResponse, UnblockDishCategoryResponse } from "@shared/api/v1/res";
import type { SupabaseDishCategories } from "@shared/converters/convert_dish_categories";
import { useLogger } from "@/hooks/useLogger";

type BlockedCategory = SupabaseDishCategories;

export default function BlockedTopicsScreen() {
	const { showDialog } = useDialog();
	const { showSnackbar } = useSnackbar();
	const { callBackend } = useAPICall();
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const [categories, setCategories] = useState<BlockedCategory[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(true);
	const isFetchingRef = useRef(false);

	// #747 【設計】ブロック済みカテゴリを取得（cursor対応）
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
				logFrontendEvent({
					event_name: "fetch_blocked_categories_failed",
					error_level: "error",
					payload: {
						error: error instanceof Error ? error.message : String(error),
					},
				});
				showSnackbar(i18n.t("Common.error"));
			} finally {
				setIsLoading(false);
				setIsLoadingMore(false);
				isFetchingRef.current = false;
			}
		},
		[callBackend, showSnackbar, logFrontendEvent],
	);

	// #747 【設計】初回ロード
	useEffect(() => {
		fetchBlockedCategories();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// #747 【設計】無限スクロール：次ページを読み込み
	const handleLoadMore = useCallback(() => {
		if (!isLoadingMore && !isRefreshing && hasMore && nextCursor) {
			fetchBlockedCategories(nextCursor);
		}
	}, [isLoadingMore, isRefreshing, hasMore, nextCursor, fetchBlockedCategories]);

	// #747 【設計】引っ張って更新：先頭から再取得
	const handleRefresh = useCallback(async () => {
		if (isFetchingRef.current) return;
		setIsRefreshing(true);
		setNextCursor(null);
		setHasMore(true);
		try {
			await fetchBlockedCategories();
		} finally {
			setIsRefreshing(false);
		}
	}, [fetchBlockedCategories]);

	// #747 【設計】ブロック解除API呼び出し
	const handleUnblock = useCallback(
		(category: BlockedCategory) => {
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

						// #747 【設計】成功時は該当行を除去
						setCategories((prev) => prev.filter((item) => item.id !== category.id));
						showSnackbar(i18n.t("Settings.blockedTopics.unblocked"));
					} catch (error) {
						logFrontendEvent({
							event_name: "unblock_category_failed",
							error_level: "error",
							payload: {
								error: error instanceof Error ? error.message : String(error),
								category_id: category.id,
							},
						});
						showSnackbar(i18n.t("Common.error"));
					}
				},
			});
		},
		[callBackend, showDialog, showSnackbar, locale, logFrontendEvent],
	);

	// #747 【設計】リストアイテムのレンダリング
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

	// #747 【設計】フッター：次ページ読み込みインジケータ
	const renderFooter = useCallback(() => {
		if (!isLoadingMore) return null;
		return (
			<View style={styles.footerLoader}>
				<LoadingIndicator size="small" />
			</View>
		);
	}, [isLoadingMore]);

	// #747 【設計】空表示
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
			<SafeAreaView style={styles.safeArea} edges={["top"]}>
				<View style={styles.header}>
					<Text style={styles.headerTitle}>{i18n.t("Settings.blockedTopics.pageTitle")}</Text>
				</View>

				<View style={styles.blockedTopicsContainer}>
					<View style={styles.sheet}>
						{isLoading ? (
							<View style={styles.loaderContainer}>
								<LoadingIndicator size="large" />
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
								refreshing={isRefreshing}
								onRefresh={handleRefresh}
								contentContainerStyle={styles.listContent}
							/>
						)}
					</View>
				</View>
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
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "flex-start",
		paddingHorizontal: 16,
		paddingVertical: 16,
	},
	headerTitle: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		letterSpacing: -0.5,
	},
	blockedTopicsContainer: {
		flex: 1,
		marginTop: 16,
		borderTopLeftRadius: 32,
		borderTopRightRadius: 32,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.1,
		shadowRadius: 24,
		elevation: 10,
	},
	sheet: {
		flex: 1,
		backgroundColor: "#FFFFFF",
		borderTopLeftRadius: 32,
		borderTopRightRadius: 32,
		overflow: "hidden",
		paddingTop: 24,
	},
	loaderContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	listContent: {
		paddingHorizontal: 16,
		paddingBottom: 32,
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
