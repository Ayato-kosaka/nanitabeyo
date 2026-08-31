import React, { useState, useCallback } from "react";
import { View, ScrollView, TouchableOpacity, Text, StyleSheet } from "react-native";
import { GridList } from "@/components/collapsible-tabs/GridList";
import { ImageCard } from "@/components/ImageCardGrid";
import i18n from "@/lib/i18n";
import { EarningItem } from "../../constants";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";

interface EarningsTabProps {
	data: EarningItem[];
	isLoading?: boolean;
	isLoadingMore?: boolean;
	refreshing?: boolean;
	onRefresh?: () => void;
	onEndReached?: () => void;
	onItemPress?: (item: EarningItem, index: number) => void;
	onScroll?: any;
	contentContainerStyle?: any;
	error?: string | null;
	onRetry?: () => void;
}

export function EarningsTab({
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
}: EarningsTabProps) {
	const styles = useThemedStyles(createStyles);
	const [selectedEarningStatuses, setSelectedEarningStatuses] = useState<string[]>(["paid", "pending"]);

	// #1509 ステータスの色は «識別子» なのでテーマで振らない（constants/Palette.ts の FixedColors 参照）
	// **useMemo で包まないこと。** ラベルは `i18n.t` の戻り値で、このファイルは locale を購読していない
	// （`useLocale` を使っていない）。依存を空にして memo 化すると **初回描画の言語でラベルが固定され、
	// 言語切り替えで更新されなくなる**。毎レンダー作り直しているのは現在の locale を反映し続けるためである。
	// eslint-disable-next-line react-hooks/exhaustive-deps -- 上記のとおり毎レンダー作り直すのが正しい
	const earningStatuses = [
		{ id: "paid", label: i18n.t("Profile.statusLabels.paid"), color: FixedColors.walletStatusActive },
		{ id: "pending", label: i18n.t("Profile.statusLabels.pending"), color: FixedColors.walletStatusPending },
	];

	const toggleEarningStatus = useCallback((statusId: string) => {
		setSelectedEarningStatuses((prev) =>
			prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId],
		);
	}, []);

	const filteredData = data.filter((earning) => selectedEarningStatuses.includes(earning.status));

	const renderHeaderComponent = useCallback(() => {
		return (
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				style={styles.statusFilterContainer}
				contentContainerStyle={styles.statusFilterContent}>
				{earningStatuses.map((status) => (
					<TouchableOpacity
						key={status.id}
						style={[
							styles.statusFilterChip,
							selectedEarningStatuses.includes(status.id) && {
								backgroundColor: status.color,
							},
						]}
						onPress={() => toggleEarningStatus(status.id)}>
						<Text
							style={[
								styles.statusFilterChipText,
								selectedEarningStatuses.includes(status.id) && styles.statusFilterChipTextActive,
							]}>
							{status.label}
						</Text>
					</TouchableOpacity>
				))}
			</ScrollView>
		);
	}, [selectedEarningStatuses, earningStatuses, toggleEarningStatus, styles]);

	const renderEarningItem = useCallback(
		({ item, index }: { item: EarningItem; index: number }) => {
			return (
				<ImageCard
					item={{
						id: item.id,
						imageUrl: item.imageUrl,
						title: `${i18n.t("Search.currencySuffix")}${item.earnings.toLocaleString()}`,
					}}
					onPress={() => onItemPress?.(item, index)}>
					<View style={styles.earningCardOverlay}>
						<Text style={styles.earningCardAmount}>
							{i18n.t("Search.currencySuffix")}
							{item.earnings.toLocaleString()}
						</Text>
						<View
							style={[
								styles.statusChip,
								{
									backgroundColor:
										item.status === "paid" ? FixedColors.walletStatusActive : FixedColors.walletStatusPending,
								},
							]}>
							<Text style={styles.statusText}>
								{item.status === "paid" ? i18n.t("Profile.statusLabels.paid") : i18n.t("Profile.statusLabels.pending")}
							</Text>
						</View>
					</View>
				</ImageCard>
			);
		},
		[onItemPress, styles],
	);

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
					<Text style={styles.emptyStateText}>{i18n.t("Profile.emptyState.noEarnings")}</Text>
				</View>
			</View>
		);
	}, [error, onRetry, styles]);

	return (
		<GridList
			data={filteredData}
			renderItem={renderEarningItem}
			numColumns={3}
			contentContainerStyle={[styles.gridContent, contentContainerStyle]}
			columnWrapperStyle={styles.gridRow}
			isLoading={isLoading}
			isLoadingMore={isLoadingMore}
			refreshing={refreshing}
			onRefresh={onRefresh}
			onEndReached={onEndReached}
			ListHeaderComponent={renderHeaderComponent}
			ListEmptyComponent={renderEmptyState}
			onScroll={onScroll}
			testID="earnings-tab-grid"
		/>
	);
}

// #1509 【設計】`StyleSheet.create` はモジュール評価時に 1 度だけ走るためテーマを追従できない。
// パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		gridContent: {
			paddingHorizontal: 16,
			paddingVertical: 8,
		},
		gridRow: {
			gap: 1,
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
			borderRadius: 16,
			backgroundColor: c.surfaceChipAlt,
			marginHorizontal: 4,
			// 影はテーマに依らず黒。暗面では実質見えないだけで、値としては黒のままでよい
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 2 },
			shadowOpacity: 0.1,
			shadowRadius: 4,
			elevation: 3,
		},
		statusFilterChipText: {
			fontSize: 13,
			color: c.textSecondary,
			fontWeight: "500",
		},
		statusFilterChipTextActive: {
			// 選択中はステータス色（テーマ非追従）で塗り潰されるので、その上の字も振らない
			color: FixedColors.onFilled,
			fontWeight: "600",
		},
		earningCardOverlay: {
			position: "absolute",
			bottom: 0,
			left: 0,
			right: 0,
			padding: 8,
		},
		earningCardAmount: {
			fontSize: 15,
			fontWeight: "700",
			// 料理写真の上に載る金額。メディアの上は常に暗いので白のまま振らない
			color: FixedColors.onMedia,
			marginBottom: 4,
			textShadowColor: "rgba(0, 0, 0, 0.8)",
			textShadowOffset: { width: 0, height: 1 },
			textShadowRadius: 2,
		},
		statusChip: {
			alignSelf: "flex-start",
			paddingVertical: 4,
			paddingHorizontal: 4,
			borderRadius: 8,
		},
		statusText: {
			fontSize: 10,
			fontWeight: "600",
			// 地がステータス色（テーマ非追従の塗り潰し）なので、字も振らない
			color: FixedColors.onFilled,
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
