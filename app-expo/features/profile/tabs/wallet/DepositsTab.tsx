import React, { useState, useCallback } from "react";
import { View, ScrollView, TouchableOpacity, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Tabs } from "@/components/collapsible-tabs";
import i18n from "@/lib/i18n";
import { BidItem } from "../../constants";
import { getCacheKeyForImage } from "@/lib/image";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";

interface DepositsTabProps {
	data: BidItem[];
	isLoading?: boolean;
	isLoadingMore?: boolean;
	refreshing?: boolean;
	onRefresh?: () => void;
	onEndReached?: () => void;
	onItemPress?: (item: BidItem, index: number) => void;
	onScroll?: any;
	contentContainerStyle?: any;
	error?: string | null;
	onRetry?: () => void;
}

export function DepositsTab({
	data,
	isLoading = false,
	isLoadingMore = false,
	refreshing = false,
	onRefresh,
	onEndReached,
	onItemPress,
	onScroll,
	contentContainerStyle,
	error,
	onRetry,
}: DepositsTabProps) {
	const styles = useThemedStyles(createStyles);
	const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["active", "completed", "refunded"]);

	// #1509 ステータスの色は «識別子» なのでテーマで振らない（constants/Palette.ts の FixedColors 参照）
	// **useMemo で包まないこと。** ラベルは `i18n.t` の戻り値で、このファイルは locale を購読していない
	// （`useLocale` を使っていない）。依存を空にして memo 化すると **初回描画の言語でラベルが固定され、
	// 言語切り替えで更新されなくなる**。毎レンダー作り直しているのは現在の locale を反映し続けるためである。
	// eslint-disable-next-line react-hooks/exhaustive-deps -- 上記のとおり毎レンダー作り直すのが正しい
	const depositStatuses = [
		{ id: "active", label: i18n.t("Profile.statusLabels.active"), color: FixedColors.walletStatusActive },
		{ id: "completed", label: i18n.t("Profile.statusLabels.completed"), color: FixedColors.walletStatusCompleted },
		{ id: "refunded", label: i18n.t("Profile.statusLabels.refunded"), color: FixedColors.walletStatusPending },
	];

	const toggleStatus = useCallback((statusId: string) => {
		setSelectedStatuses((prev) =>
			prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId],
		);
	}, []);

	const filteredData = data.filter((bid) => selectedStatuses.includes(bid.status));

	const renderHeaderComponent = useCallback(() => {
		return (
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				style={styles.statusFilterContainer}
				contentContainerStyle={styles.statusFilterContent}>
				{depositStatuses.map((status) => (
					<TouchableOpacity
						key={status.id}
						style={[
							styles.statusFilterChip,
							selectedStatuses.includes(status.id) && {
								backgroundColor: status.color,
							},
						]}
						onPress={() => toggleStatus(status.id)}>
						<Text
							style={[
								styles.statusFilterChipText,
								selectedStatuses.includes(status.id) && styles.statusFilterChipTextActive,
							]}>
							{status.label}
						</Text>
					</TouchableOpacity>
				))}
			</ScrollView>
		);
	}, [selectedStatuses, depositStatuses, toggleStatus, styles]);

	const renderBidItem = useCallback(
		({ item, index }: { item: BidItem; index: number }) => (
			<TouchableOpacity style={styles.depositCard} onPress={() => onItemPress?.(item, index)}>
				<View style={styles.depositHeader}>
					<Image
						source={{ uri: item.restaurantImageUrl, cacheKey: getCacheKeyForImage(item.restaurantImageUrl) }}
						style={styles.depositAvatar}
						onError={() => console.log("Failed to load restaurant image")}
					/>
					<View style={styles.depositInfo}>
						<Text style={styles.depositRestaurantName}>{item.restaurantName}</Text>
						<Text style={styles.depositAmount}>
							{i18n.t("Search.currencySuffix")}
							{item.bidAmount.toLocaleString()}
						</Text>
					</View>
					<View style={[styles.statusChip, { backgroundColor: getStatusColor(item.status) }]}>
						<Text style={styles.statusText}>{getStatusText(item.status)}</Text>
					</View>
				</View>
				<Text style={styles.depositDays}>{i18n.t("Common.daysRemaining", { count: item.remainingDays })}</Text>
			</TouchableOpacity>
		),
		[onItemPress, styles],
	);

	// #1509 ステータスチップの地。テーマ非追従の識別子（上の depositStatuses と同じ組）
	const getStatusColor = (status: string) => {
		switch (status) {
			case "active":
				return FixedColors.walletStatusActive;
			case "completed":
				return FixedColors.walletStatusCompleted;
			case "refunded":
				return FixedColors.walletStatusPending;
			default:
				return FixedColors.walletStatusUnknown;
		}
	};

	const getStatusText = (status: string) => {
		switch (status) {
			case "active":
				return i18n.t("Profile.statusLabels.active");
			case "completed":
				return i18n.t("Profile.statusLabels.completed");
			case "refunded":
				return i18n.t("Profile.statusLabels.refunded");
			default:
				return status;
		}
	};

	const renderEmptyState = useCallback(() => {
		if (error) {
			return (
				<View style={styles.emptyStateContainer}>
					<View style={styles.emptyStateCard}>
						<Text style={styles.emptyStateText}>{i18n.t("Profile.tabError.failedToLoad", { error })}</Text>
						<TouchableOpacity style={styles.retryButton} onPress={onRetry}>
							<Text style={styles.retryButtonText}>{i18n.t("Profile.tabError.retry")}</Text>
						</TouchableOpacity>
					</View>
				</View>
			);
		}

		return (
			<View style={styles.emptyStateContainer}>
				<View style={styles.emptyStateCard}>
					<Text style={styles.emptyStateText}>{i18n.t("Profile.emptyState.noDeposits")}</Text>
				</View>
			</View>
		);
	}, [error, onRetry, styles]);

	return (
		<Tabs.FlatList
			data={filteredData}
			renderItem={renderBidItem}
			keyExtractor={(item) => item.id}
			ListHeaderComponent={renderHeaderComponent}
			ListEmptyComponent={renderEmptyState}
			contentContainerStyle={[styles.container, contentContainerStyle]}
			showsVerticalScrollIndicator={false}
			onEndReached={onEndReached}
			onEndReachedThreshold={0.5}
			onScroll={onScroll}
			scrollEventThrottle={16}
		/>
	);
}

// #1509 【設計】`StyleSheet.create` はモジュール評価時に 1 度だけ走るためテーマを追従できない。
// パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			padding: 16,
		},
		statusFilterContainer: {
			marginVertical: 16,
		},
		statusFilterContent: {
			gap: 8,
		},
		statusFilterChip: {
			paddingHorizontal: 16,
			paddingVertical: 8,
			borderRadius: 20,
			backgroundColor: c.surfaceChip,
			borderWidth: 1,
			borderColor: c.borderFaint,
		},
		statusFilterChipText: {
			fontSize: 14,
			fontWeight: "500",
			color: c.textSecondary,
		},
		statusFilterChipTextActive: {
			// 選択中はステータス色（テーマ非追従）で塗り潰されるので、その上の字も振らない
			color: FixedColors.onFilled,
			fontWeight: "600",
		},
		depositCard: {
			backgroundColor: c.surface,
			borderRadius: 16,
			padding: 16,
			marginBottom: 12,
			// 影はテーマに依らず黒。暗面では実質見えないだけで、値としては黒のままでよい
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.08,
			shadowRadius: 16,
			elevation: 4,
		},
		depositHeader: {
			flexDirection: "row",
			alignItems: "center",
			marginBottom: 8,
		},
		depositAvatar: {
			width: 40,
			height: 40,
			borderRadius: 20,
			marginRight: 12,
			borderWidth: 2,
			borderColor: c.surface,
		},
		depositInfo: {
			flex: 1,
		},
		depositRestaurantName: {
			fontSize: 14,
			fontWeight: "700",
			color: c.textPrimary,
			marginBottom: 2,
			letterSpacing: -0.3,
		},
		depositAmount: {
			fontSize: 16,
			fontWeight: "700",
			color: c.brand,
			letterSpacing: -0.3,
		},
		depositDays: {
			fontSize: 15,
			color: c.textSecondary,
			fontWeight: "500",
		},
		statusChip: {
			paddingVertical: 4,
			paddingHorizontal: 4,
			borderRadius: 16,
			alignItems: "center",
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 2 },
			shadowOpacity: 0.1,
			shadowRadius: 4,
			elevation: 3,
		},
		statusText: {
			fontSize: 13,
			// 地がステータス色（テーマ非追従の塗り潰し）なので、字も振らない
			color: FixedColors.onFilled,
			fontWeight: "600",
		},
		emptyStateContainer: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
		},
		emptyStateCard: {
			backgroundColor: c.surface,
			borderRadius: 20,
			padding: 32,
			width: "100%",
			alignItems: "center",
			justifyContent: "center",
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.08,
			shadowRadius: 16,
			elevation: 4,
		},
		emptyStateText: {
			fontSize: 16,
			color: c.textSecondary,
			textAlign: "center",
		},
		retryButton: {
			marginTop: 16,
			backgroundColor: c.brand,
			paddingHorizontal: 20,
			paddingVertical: 10,
			borderRadius: 20,
		},
		retryButtonText: {
			// ブランド色で塗り潰したボタンの上の字。地がライト / ダークで変わらないので振らない
			color: FixedColors.onFilled,
			fontWeight: "600",
		},
	});
