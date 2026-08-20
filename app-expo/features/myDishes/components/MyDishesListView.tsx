import React, { memo, useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ImageOff } from "lucide-react-native";
import { router } from "expo-router";
import { GridList } from "@/components/collapsible-tabs/GridList";
import { EmptyState } from "@/components/EmptyState";
import { useContentWidth } from "@/hooks/useContentWidth";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { getCacheKeyForImage } from "@/lib/image";
import i18n from "@/lib/i18n";
import type { MyDishItem } from "@shared/api/v1/res";
import { useMyDishesQuery } from "../hooks/useMyDishesQuery";

/**
 * #1396 my-dishes のリストビュー（設計書 (2/2) §7 の PR3）。
 *
 * - **料理画像主体のグリッド**。3 ビューのうち一番単純なので、共有フィルタ store の
 *   挙動（フィルタ変更で取り直す / ビュー切替では取り直さない）をここで固定する。
 * - `dishMedia === null` は**プレースホルダー**を描く。写真なしの「食べた」記録が実際に来る
 *   （#1395 で `dish_reviews.created_dish_media_id` の NOT NULL を解除済み）。
 *   ここを `thumbnailImageUrl` の直参照にすると、写真なし記録で落ちる。
 */

const COLUMNS = 3;
const GAP = 1;
const PADDING_HORIZONTAL = 16;
const ASPECT_RATIO = 9 / 16;

type MyDishGridItem = { id: string; item: MyDishItem };

const MyDishCard = memo(function MyDishCard({ item, onPress }: { item: MyDishItem; onPress: (i: MyDishItem) => void }) {
	const { lightImpact } = useHaptics();
	// #958 と同じ理由で useWindowDimensions ではなく CenteredAppShell の中央カラム幅を使う
	const contentWidth = useContentWidth();
	const width = useMemo(
		() => (contentWidth - PADDING_HORIZONTAL * 2 - GAP * (COLUMNS - 1)) / COLUMNS,
		[contentWidth],
	);
	const height = width / ASPECT_RATIO;

	const thumbnailUrl = item.dishMedia?.thumbnailImageUrl ?? null;
	const source = useMemo(
		() => (thumbnailUrl ? { uri: thumbnailUrl, cacheKey: getCacheKeyForImage(thumbnailUrl) } : null),
		[thumbnailUrl],
	);

	const handlePress = useCallback(() => {
		lightImpact();
		onPress(item);
	}, [item, lightImpact, onPress]);

	const dishName = item.dish.name ?? undefined;
	const rating = item.myReview?.rating ?? null;

	return (
		<Pressable
			testID="my-dishes-list-item"
			style={[styles.card, { width, height }]}
			onPress={handlePress}
			android_ripple={{ color: "rgba(0,0,0,0.06)" }}
			accessibilityRole="button"
			accessibilityLabel={dishName ?? item.restaurant.name ?? i18n.t("ImageCardGrid.openItemDetails")}>
			{source ? (
				<Image
					source={source}
					cachePolicy="memory-disk"
					transition={100}
					style={StyleSheet.absoluteFill}
					contentFit="cover"
					alt=""
					accessibilityElementsHidden
					importantForAccessibility="no"
				/>
			) : (
				// #1396 【仕様】写真なしの「食べた」記録（dishMedia === null）のプレースホルダー
				<View testID="my-dishes-list-item-placeholder" style={[StyleSheet.absoluteFill, styles.placeholder]}>
					<ImageOff size={20} color="#9CA3AF" />
					<Text style={styles.placeholderText} numberOfLines={2}>
						{dishName ?? i18n.t("MyDishes.list.noPhoto")}
					</Text>
				</View>
			)}

			<LinearGradient
				colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.55)"]}
				style={StyleSheet.absoluteFill}
				pointerEvents="box-none">
				<View style={styles.badgeRow}>
					<View style={[styles.statusBadge, item.status === "want" ? styles.statusWant : styles.statusEaten]}>
						<Text style={styles.statusBadgeText}>{i18n.t(`MyDishes.filters.status.${item.status}`)}</Text>
					</View>
				</View>
				<View style={styles.footer}>
					{rating !== null && <Text style={styles.ratingText}>{`★${rating}`}</Text>}
					<Text style={styles.footerText} numberOfLines={1}>
						{dishName ?? item.restaurant.name ?? ""}
					</Text>
				</View>
			</LinearGradient>
		</Pressable>
	);
});

export function MyDishesListView() {
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const { items, isLoading, isLoadingMore, error, hasNextPage, loadMore, refresh } = useMyDishesQuery();

	const data = useMemo<MyDishGridItem[]>(() => items.map((item) => ({ id: item.key, item })), [items]);

	const handlePressItem = useCallback(
		(item: MyDishItem) => {
			logFrontendEvent({
				event_name: "my_dishes_list_item_selected",
				error_level: "log",
				payload: { itemKey: item.key, status: item.status },
			});
			router.push({
				pathname: "/[locale]/restaurant/[restaurantId]",
				params: { locale, restaurantId: item.restaurant.id },
			});
		},
		[locale, logFrontendEvent],
	);

	const renderItem = useCallback(
		({ item }: { item: MyDishGridItem }) => <MyDishCard item={item.item} onPress={handlePressItem} />,
		[handlePressItem],
	);

	const renderEmpty = useCallback(
		() => (
			<EmptyState
				message={i18n.t("MyDishes.empty.description")}
				error={error}
				onRetry={refresh}
				testID="my-dishes-empty"
			/>
		),
		[error, refresh],
	);

	// #1396 【設計】終端（nextCursor === null）では onEndReached で何も投げない。
	// 追加取得の同時実行を 1 本に絞るのは store 側（fetchMore）の責務（設計書 (2/2) §4-4）
	const handleEndReached = useCallback(() => {
		if (!hasNextPage) return;
		loadMore();
	}, [hasNextPage, loadMore]);

	return (
		<GridList
			data={data}
			renderItem={renderItem}
			keyExtractor={(item) => item.id}
			numColumns={COLUMNS}
			contentContainerStyle={styles.gridContent}
			columnWrapperStyle={styles.gridRow}
			isLoading={isLoading}
			isLoadingMore={isLoadingMore}
			refreshing={isLoading}
			onRefresh={refresh}
			onEndReached={handleEndReached}
			ListEmptyComponent={renderEmpty}
			testID="my-dishes-list"
			// my-dishes は collapsible-tabs の外にいる単独ルートなので素の FlatList を使う（#1402 と同じ）
			standalone
		/>
	);
}

const styles = StyleSheet.create({
	gridContent: {
		paddingHorizontal: PADDING_HORIZONTAL,
		paddingVertical: 8,
	},
	gridRow: {
		gap: GAP,
	},
	card: {
		marginBottom: GAP,
		borderRadius: 8,
		overflow: "hidden",
		backgroundColor: "#F3F4F6",
	},
	placeholder: {
		alignItems: "center",
		justifyContent: "center",
		gap: 4,
		paddingHorizontal: 6,
		backgroundColor: "#F3F4F6",
	},
	placeholderText: {
		fontSize: 10,
		color: "#6B7280",
		textAlign: "center",
	},
	badgeRow: {
		flexDirection: "row",
		padding: 6,
	},
	statusBadge: {
		paddingHorizontal: 6,
		paddingVertical: 2,
		borderRadius: 10,
	},
	statusWant: {
		backgroundColor: "rgba(59,130,246,0.9)",
	},
	statusEaten: {
		backgroundColor: "rgba(240,85,55,0.9)",
	},
	statusBadgeText: {
		fontSize: 10,
		fontWeight: "700",
		color: "#FFFFFF",
	},
	footer: {
		position: "absolute",
		left: 6,
		right: 6,
		bottom: 6,
		gap: 2,
	},
	ratingText: {
		fontSize: 11,
		fontWeight: "700",
		color: "#FFFFFF",
	},
	footerText: {
		fontSize: 11,
		color: "#FFFFFF",
	},
});
