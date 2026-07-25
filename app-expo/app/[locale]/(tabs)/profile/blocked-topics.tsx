import React, { useCallback, useEffect, useState, useRef, memo } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/EmptyState";
import i18n from "@/lib/i18n";
import { useDialog } from "@/contexts/DialogProvider";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";

import { QueryMeBlockedDishCategoriesResponse, UnblockDishCategoryResponse } from "@shared/api/v1/res";
import type { SupabaseDishCategories } from "@shared/converters/convert_dish_categories";

type BlockedCategory = SupabaseDishCategories;

// ============================================================================
// [ベストプラクティス] リストアイテムのメモ化
// FlatList内の各アイテムを `React.memo` で囲むことで、他のアイテムのブロック解除時などに
// 関係のないアイテムまで再レンダリングされるのを防ぎ、パフォーマンスを最適化します。
// ============================================================================
interface BlockedCategoryItemProps {
	item: BlockedCategory;
	localeCode: string;
	onUnblock: (item: BlockedCategory) => void;
}

const BlockedCategoryItem = memo(({ item, localeCode, onUnblock }: BlockedCategoryItemProps) => {
	const labels = (item.labels || {}) as Record<string, string>;
	// 多言語対応のフォールバック処理を安全に行う
	const categoryLabel = labels[localeCode] || labels.en || item.label_en || item.id;

	return (
		<View style={styles.itemContainer}>
			{/* 画像のURIが存在しない場合のフォールバックを考慮し、空文字列を回避 */}
			{/* #937 【仕様】隣接する categoryLabel テキストと内容が重複するため、画像自体は装飾扱いにする */}
			<Image
				source={{ uri: item.image_url || undefined }}
				style={styles.categoryImage}
				accessible={false}
				accessibilityElementsHidden
				importantForAccessibility="no"
			/>
			<Text style={styles.categoryLabel} numberOfLines={2}>
				{categoryLabel}
			</Text>
			<TouchableOpacity
				style={styles.unblockButton}
				onPress={() => onUnblock(item)}
				activeOpacity={0.7}
				// [ベストプラクティス] アクセシビリティの向上
				accessibilityRole="button"
				accessibilityLabel={`${categoryLabel} ${i18n.t("Settings.blockedTopics.unblockButton")}`}>
				<Text style={styles.unblockButtonText}>{i18n.t("Settings.blockedTopics.unblockButton")}</Text>
			</TouchableOpacity>
		</View>
	);
});
BlockedCategoryItem.displayName = "BlockedCategoryItem";

// ============================================================================
// メインスクリーンコンポーネント
// ============================================================================
export default function BlockedTopicsScreen() {
	const { showDialog } = useDialog();
	const { showSnackbar } = useSnackbar();
	const { callBackend } = useAPICall();
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();

	const [categories, setCategories] = useState<BlockedCategory[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(true);

	const isFetchingRef = useRef(false);
	const localeCode = locale.split("-")[0];

	// #747 【設計】ブロック済みカテゴリを取得（cursor対応）
	// [レビュー対応] isRefreshフラグを追加し、状態管理の競合（Race condition）を防止
	const fetchBlockedCategories = useCallback(
		async (options: { cursor?: string; isRefresh?: boolean } = {}) => {
			if (isFetchingRef.current) return;
			isFetchingRef.current = true;

			const { cursor, isRefresh = false } = options;

			try {
				// [レビュー対応] Refresh中は既にisRefreshingがtrueなので、isLoadingは変更しない
				if (!isRefresh) {
					if (!cursor) {
						setIsLoading(true); // 初回ロード
					} else {
						setIsLoadingMore(true); // 追加ロード
					}
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

				// [レビュー対応] データの更新はAPIリクエストが「成功」した後のみ行う。
				// これによりエラー時にnextCursorが失われるのを防ぐ。
				if (!cursor || isRefresh) {
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
				// エラー時は既存のStateを維持するため、セット処理は行わない
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
	}, [fetchBlockedCategories]);

	// #747 【設計】無限スクロール：次ページを読み込み
	const handleLoadMore = useCallback(() => {
		if (!isLoadingMore && !isRefreshing && !isLoading && hasMore && nextCursor) {
			fetchBlockedCategories({ cursor: nextCursor });
		}
	}, [isLoadingMore, isRefreshing, isLoading, hasMore, nextCursor, fetchBlockedCategories]);

	// #747 【設計】引っ張って更新：先頭から再取得
	const handleRefresh = useCallback(async () => {
		if (isFetchingRef.current) return;
		setIsRefreshing(true);

		// [レビュー対応] 事前にnextCursorやStateをクリアしない（失敗時に備えるため）
		try {
			await fetchBlockedCategories({ isRefresh: true });
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

						// #747 【設計】成功時は該当行を除去（オプティミスティックUIアップデート）
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
		[callBackend, showDialog, showSnackbar, logFrontendEvent], // localeへの依存は剥がし、UI責務を分離
	);

	// #949 【設計】Stack push 画面のため戻る導線が存在しなかった。ScreenHeader で router.back() に接続する。
	const handleBack = useCallback(() => {
		lightImpact();
		router.back();
	}, [lightImpact]);

	// [ベストプラクティス] keyExtractorは安定した参照にするため関数化するか外に出す
	const keyExtractor = useCallback((item: BlockedCategory) => item.id, []);

	const renderItem = useCallback(
		({ item }: { item: BlockedCategory }) => (
			<BlockedCategoryItem item={item} localeCode={localeCode} onUnblock={handleUnblock} />
		),
		[handleUnblock, localeCode],
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
	// #947 【仕様】EmptyState 共通コンポーネントへ置き換え。ブロック中料理画面は「ブロック解除」導線が
	// 主目的の画面のため、他タブと異なりCTA(検索へ誘導)は付与しない(PRレビュー指摘)。
	const renderEmpty = useCallback(() => {
		if (isLoading) return null;
		return <EmptyState message={i18n.t("Settings.blockedTopics.empty")} testID="blocked-topics-empty-state" />;
	}, [isLoading]);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader title={i18n.t("Settings.blockedTopics.pageTitle")} onPressBack={handleBack} />

				<View style={styles.blockedTopicsContainer}>
					<View style={styles.sheet}>
						{isLoading ? (
							<View style={styles.loaderContainer}>
								<LoadingIndicator size="large" />
							</View>
						) : (
							<FlatList
								data={categories}
								keyExtractor={keyExtractor}
								renderItem={renderItem}
								ListEmptyComponent={renderEmpty}
								ListFooterComponent={renderFooter}
								onEndReached={handleLoadMore}
								onEndReachedThreshold={0.5}
								refreshing={isRefreshing}
								onRefresh={handleRefresh}
								contentContainerStyle={styles.listContent}
								// [ベストプラクティス] 長いリストのメモリ最適化
								removeClippedSubviews={true}
								initialNumToRender={10}
								maxToRenderPerBatch={10}
								windowSize={5}
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
	footerLoader: {
		paddingVertical: 20,
		alignItems: "center",
	},
});
