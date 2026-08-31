import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, RefreshControl, ScrollView, TouchableOpacity } from "react-native";
import { Tabs } from "@/components/collapsible-tabs";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useAppTheme } from "@/contexts/ThemeProvider";
import i18n from "@/lib/i18n";
import type { QueryRestaurantBidsDto } from "@shared/api/v1/dto";
import type { QueryRestaurantBidsResponse } from "@shared/api/v1/res";
import { SupabaseRestaurantBids } from "@shared/converters/convert_restaurant_bids";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";

type BidStatus = { id: SupabaseRestaurantBids["status"]; label: string; color: string };

interface RestaurantBidsTabProps {
	/** レストランID（Google Place ID） */
	restaurantId: string;
}

/**
 * レストランの入札履歴タブコンポーネント
 *
 * useCursorPaginationを使用してレストランの入札履歴を取得し、
 * ステータスフィルター付きのリスト形式で表示する。
 * SavedDishCategoriesTabの実装パターンに倣い、カーソル式ページネーションを実装。
 * フィルター機能により、ステータス別の入札履歴を絞り込み表示可能。
 */
export function RestaurantBidsTab({ restaurantId }: RestaurantBidsTabProps) {
	// #1629 入札履歴はレストラン詳細シートの中身（地図タイルの上ではない）ので、
	// 面・文字はテーマへ追従させる。ステータスの色だけは «識別子» なので固定（下記参照）。
	const styles = useThemedStyles(createStyles);
	const { callBackend } = useAPICall();
	const { lightImpact } = useHaptics();
	// #1629 引っ張って更新のスピナー色だけテーマから取る（この画面の他の色は main 由来の直書きのまま）
	const { colors } = useAppTheme();

	// 入札ステータスの定義（既存実装を維持）
	// #1629 ステータスの色は面の色ではなく «識別子»（緑 = 進行中 / 青 = 完了 / 橙 = 返金）。
	// ウォレットの同じ 3 状態と同じ値・同じ理由なので `FixedColors.walletStatus*` を再利用する
	// （テーマで振ると、同じ入札が別の状態に見えてしまう）。
	// **useMemo で包まないこと。** ラベルは `i18n.t` の戻り値で、このファイルは locale を購読していない
	// （`useLocale` を使っていない）。依存を空にして memo 化すると **初回描画の言語でラベルが固定され、
	// 言語切り替えで更新されなくなる**。毎レンダー作り直しているのは現在の locale を反映し続けるためである。
	// eslint-disable-next-line react-hooks/exhaustive-deps -- 上記のとおり毎レンダー作り直すのが正しい
	const bidStatuses: BidStatus[] = [
		{ id: "pending", label: i18n.t("Profile.statusLabels.active"), color: FixedColors.walletStatusActive },
		{ id: "paid", label: i18n.t("Profile.statusLabels.completed"), color: FixedColors.walletStatusCompleted },
		{ id: "refunded", label: i18n.t("Profile.statusLabels.refunded"), color: FixedColors.walletStatusPending },
	];

	// 選択されたステータスフィルター（初期状態は全て選択）
	const [selectedBidStatuses, setSelectedBidStatuses] = useState<string[]>(bidStatuses.map((b) => b.id));

	// ステータスフィルターの切り替え処理
	const toggleBidStatus = useCallback(
		(statusId: string) => {
			lightImpact();
			setSelectedBidStatuses((prev) =>
				prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId],
			);
		},
		[lightImpact],
	);

	// レストランの入札履歴取得用のカーソルページネーション
	// APIエンドポイント: GET /v1/restaurants/:id/restaurant-bids
	const bids = useCursorPagination<QueryRestaurantBidsDto, QueryRestaurantBidsResponse[number]>(
		useCallback(
			async ({ cursor }) => {
				// レストランIDをパスパラメータに含めてAPIを呼び出し
				const response = [] as QueryRestaurantBidsResponse;
				// await callBackend<QueryRestaurantBidsDto, QueryRestaurantBidsResponse>(
				// 	`v1/restaurants/${restaurantId}/restaurant-bids`,
				// 	{
				// 		method: "GET",
				// 		requestPayload: cursor ? { cursor } : {},
				// 	},
				// );
				// レスポンスは配列形式なので、PaginatedResponseに変換
				return {
					data: response || [],
					nextCursor: null, // 現在は配列レスポンスなのでページネーションなし
				};
			},
			[callBackend, restaurantId],
		),
	);

	// コンポーネントのマウント時、またはレストランIDが変更された時にデータを初期読み込み
	useEffect(() => {
		if (restaurantId) {
			bids.loadInitial();
		}
	}, [restaurantId, bids.loadInitial]);

	// フィルタリング済みの入札履歴
	// 選択されたステータスに基づいて入札履歴をフィルタリング
	const filteredBidHistory = bids.items.filter((bid) => selectedBidStatuses.includes(bid.status));

	// ステータスフィルターヘッダーのレンダリング（既存実装を維持）
	const renderBidHeader = useCallback(
		() => (
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				style={styles.statusFilterContainer}
				contentContainerStyle={styles.statusFilterContent}>
				{bidStatuses.map((status) => (
					<TouchableOpacity
						key={status.id}
						style={[styles.statusChip, selectedBidStatuses.includes(status.id) && { backgroundColor: status.color }]}
						onPress={() => toggleBidStatus(status.id)}>
						<Text
							style={[styles.statusChipText, selectedBidStatuses.includes(status.id) && styles.statusChipTextActive]}>
							{status.label}
						</Text>
					</TouchableOpacity>
				))}
			</ScrollView>
		),
		[bidStatuses, selectedBidStatuses, styles, toggleBidStatus],
	);

	// 入札アイテムのレンダリング関数（既存実装を維持）
	const renderBidItem = useCallback(
		({ item }: { item: QueryRestaurantBidsResponse[number] }) => (
			<View style={styles.bidHistoryCard}>
				<View style={styles.bidHistoryHeader}>
					<Text style={styles.bidHistoryAmount}>
						{i18n.t("Search.currencySuffix")}
						{item.amount_cents.toLocaleString()}
					</Text>
					<View
						style={[
							styles.bidStatusChip,
							{
								backgroundColor:
									bidStatuses.find((b) => b.id === item.status)?.color || FixedColors.walletStatusUnknown,
							},
						]}>
						<Text style={styles.bidStatusText}>
							{bidStatuses.find((b) => b.id === item.status)?.label || item.status}
						</Text>
					</View>
				</View>
				<Text style={styles.bidHistoryDate}>{item.end_date}</Text>
				<Text style={styles.bidHistoryDays}>
					{i18n.t("Common.daysRemaining", {
						count: Math.max(
							0,
							Math.ceil((new Date(item.end_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)),
						),
					})}
				</Text>
			</View>
		),
		[bidStatuses, styles],
	);

	// 空状態のレンダリング（既存実装を維持）
	const renderBidEmpty = useCallback(
		() => (
			<View style={styles.emptyState}>
				<Text style={styles.emptyStateText}>{i18n.t("Map.empty.bidHistory")}</Text>
			</View>
		),
		[styles],
	);

	return (
		<Tabs.FlatList
			data={filteredBidHistory}
			renderItem={renderBidItem}
			keyExtractor={(item) => item.id}
			ListHeaderComponent={renderBidHeader}
			ListEmptyComponent={renderBidEmpty}
			contentContainerStyle={styles.bidsContent}
			// ページネーション関連のプロパティ
			onEndReached={bids.loadMore}
			// #1629 `refreshing` / `onRefresh` を直接渡すと RN が色を持たない RefreshControl を作り、
			// ダークの地に OS 既定の暗いスピナーが出て見えない。GridList と同じ渡し方に揃える
			refreshControl={
				<RefreshControl
					refreshing={bids.isLoadingInitial}
					onRefresh={bids.refresh}
					colors={[colors.brand]}
					tintColor={colors.brand}
				/>
			}
		/>
	);
}

// 既存のスタイルを完全に維持
const createStyles = (c: Palette) =>
	StyleSheet.create({
		bidsContent: {
			paddingHorizontal: 16,
			gap: 12,
		},
		bidHistoryCard: {
			backgroundColor: c.surfaceMuted,
			padding: 16,
			borderRadius: 12,
		},
		bidHistoryHeader: {
			flexDirection: "row",
			justifyContent: "space-between",
			alignItems: "center",
			marginBottom: 4,
		},
		bidHistoryAmount: {
			fontSize: 18,
			fontWeight: "bold",
			color: c.brand,
		},
		bidHistoryDate: {
			fontSize: 12,
			color: c.textMuted,
			marginBottom: 2,
		},
		bidHistoryDays: {
			fontSize: 12,
			color: c.textMuted,
		},
		bidStatusChip: {
			paddingHorizontal: 12,
			paddingVertical: 4,
			borderRadius: 12,
		},
		bidStatusText: {
			fontSize: 12,
			color: FixedColors.onFilled,
			fontWeight: "500",
		},
		statusFilterContainer: {
			marginBottom: 16,
		},
		statusFilterContent: {
			paddingHorizontal: 4,
			gap: 8,
		},
		statusChip: {
			paddingHorizontal: 16,
			paddingVertical: 8,
			borderRadius: 20,
			marginHorizontal: 4,
			// #1629 borderWidth が 0 なので枠は描かれない（色を持つ意味が無いので borderColor は置かない）
			borderWidth: 0,
		},
		statusChipText: {
			fontSize: 14,
			color: c.textMuted,
			fontWeight: "500",
		},
		statusChipTextActive: {
			color: FixedColors.onFilled,
			fontWeight: "600",
		},
		emptyState: {
			alignItems: "center",
			justifyContent: "center",
			paddingVertical: 40,
		},
		emptyStateText: {
			fontSize: 16,
			color: c.textMuted,
			textAlign: "center",
		},
	});
