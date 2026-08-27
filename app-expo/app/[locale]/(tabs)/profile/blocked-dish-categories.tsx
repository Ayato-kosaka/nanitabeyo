import React, { useCallback, useEffect, useState, useRef, memo } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/EmptyState";
import i18n from "@/lib/i18n";
import { asApiList } from "@/lib/apiList";
import { useDialog } from "@/contexts/DialogProvider";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

import { QueryMeBlockedDishCategoriesResponse, UnblockDishCategoryResponse } from "@shared/api/v1/res";
import type { SupabaseDishCategories } from "@shared/converters/convert_dish_categories";
import { toErrorLogMessage } from "@/lib/errorMessage";

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
	// #1509 【設計】行は memo 済みの子なので、スタイルもこの子の中で解決する
	//（親が閉じ込めると memo が効いている間だけ古いテーマの行が残る）
	const styles = useThemedStyles(createStyles);
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
				accessibilityLabel={`${categoryLabel} ${i18n.t("Settings.blockedDishCategories.unblockButton")}`}>
				<Text style={styles.unblockButtonText}>{i18n.t("Settings.blockedDishCategories.unblockButton")}</Text>
			</TouchableOpacity>
		</View>
	);
});
BlockedCategoryItem.displayName = "BlockedCategoryItem";

// ============================================================================
// メインスクリーンコンポーネント
// ============================================================================
export default function BlockedDishCategoriesScreen() {
	const { showDialog } = useDialog();
	const { showSnackbar } = useSnackbar();
	const { callBackend } = useAPICall();
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);

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
					setCategories(asApiList(response.data));
				} else {
					setCategories((prev) => [...prev, ...asApiList(response.data)]);
				}

				setNextCursor(response.nextCursor);
				setHasMore(!!response.nextCursor);
			} catch (error) {
				logFrontendEvent({
					event_name: "fetch_blocked_categories_failed",
					error_level: "error",
					payload: {
						error: toErrorLogMessage(error),
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
			showDialog(i18n.t("Settings.blockedDishCategories.unblockMessage"), {
				title: i18n.t("Settings.blockedDishCategories.unblockTitle"),
				okLabel: i18n.t("Settings.blockedDishCategories.unblockConfirm"),
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
						showSnackbar(i18n.t("Settings.blockedDishCategories.unblocked"));
					} catch (error) {
						logFrontendEvent({
							event_name: "unblock_category_failed",
							error_level: "error",
							payload: {
								error: toErrorLogMessage(error),
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
	}, [isLoadingMore, styles]);

	// #747 【設計】空表示
	// #947 【仕様】EmptyState 共通コンポーネントへ置き換え。ブロック中料理画面は「ブロック解除」導線が
	// 主目的の画面のため、他タブと異なりCTA(検索へ誘導)は付与しない(PRレビュー指摘)。
	const renderEmpty = useCallback(() => {
		if (isLoading) return null;
		return <EmptyState message={i18n.t("Settings.blockedDishCategories.empty")} testID="blocked-dish-categories-empty-state" />;
	}, [isLoading]);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				{/* #1132 【設計】ヘッダーのタイトル文言そのものが検証対象のため testID を付与する
				    （ScreenHeader はタイトル Text へ `${testID}-title` を付ける。見た目は変わらない） */}
				<ScreenHeader
					testID="blocked-dish-categories-header"
					title={i18n.t("Settings.blockedDishCategories.pageTitle")}
					onPressBack={handleBack}
				/>

				<View style={styles.blockedDishCategoriesContainer}>
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
								// #1629 `refreshing` / `onRefresh` を直接渡すと RN が色を持たない RefreshControl を
								// 作り、ダークの地に OS 既定の暗いスピナーが出て見えない。GridList と同じ渡し方に揃える
								refreshControl={
									<RefreshControl
										refreshing={isRefreshing}
										onRefresh={handleRefresh}
										colors={[colors.brand]}
										tintColor={colors.brand}
									/>
								}
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

// #1509 【設計】`StyleSheet.create` はモジュール評価時に 1 度だけ走るためテーマを追従できない。
// パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
		},
		safeArea: {
			flex: 1,
		},
		blockedDishCategoriesContainer: {
			flex: 1,
			marginTop: 16,
			borderTopLeftRadius: 32,
			borderTopRightRadius: 32,
			// 影はテーマに依らず黒。暗面では実質見えないだけで、値としては黒のままでよい
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.1,
			shadowRadius: 24,
			elevation: 10,
		},
		sheet: {
			flex: 1,
			backgroundColor: c.surface,
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
			backgroundColor: c.surface,
			borderRadius: 12,
			padding: 12,
			marginBottom: 12,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 1 },
			shadowOpacity: 0.05,
			shadowRadius: 2,
			elevation: 2,
		},
		categoryImage: {
			width: 56,
			height: 56,
			borderRadius: 8,
			backgroundColor: c.surfaceSubtle,
		},
		categoryLabel: {
			flex: 1,
			fontSize: 16,
			fontWeight: "500",
			color: c.textPrimary,
			marginLeft: 12,
		},
		unblockButton: {
			paddingHorizontal: 16,
			paddingVertical: 8,
			backgroundColor: c.surfaceSubtle,
			borderRadius: 8,
		},
		unblockButtonText: {
			fontSize: 14,
			fontWeight: "600",
			color: c.textPrimary,
		},
		footerLoader: {
			paddingVertical: 20,
			alignItems: "center",
		},
	});
