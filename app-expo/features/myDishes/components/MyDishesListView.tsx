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
import { MyDishEatenButton } from "./myDishCard";
import { MY_DISHES_EVENTS } from "../analytics";
import { buildMarkAsEatenRoute } from "../markAsEaten";
import { beginMarkAsEaten } from "../markAsEatenFunnel";
import { resolveMyDishThumbnailUrl } from "../thumbnail";
import { useMyDishesQuery } from "../hooks/useMyDishesQuery";
import { MY_DISH_STATUS_COLORS } from "@/features/myDishes/statusColors";

/**
 * #1396 my-dishes のリストビュー（設計書 (2/2) §7 の PR3）。
 *
 * - **料理画像主体のグリッド**。3 ビューのうち一番単純なので、共有フィルタ store の
 *   挙動（フィルタ変更で取り直す / ビュー切替では取り直さない）をここで固定する。
 * - `dishMedia === null`（写真なしの「食べた」記録）は**灰色プレースホルダーにしない**。
 *   `resolveMyDishThumbnailUrl`（`categoryImageUrl` → `restaurant.image_url` の順）で実画像へ
 *   フォールバックしつつ、「写真なし」であること自体は `MyDishes.list.noPhoto` バッジで示す
 *   （#1398 PR5 / #1375 追補2 決定3）。3 つとも無いときだけ従来どおりの無地プレースホルダー。
 */

const COLUMNS = 3;
const GAP = 1;
const PADDING_HORIZONTAL = 16;
const ASPECT_RATIO = 9 / 16;

type MyDishGridItem = { id: string; item: MyDishItem };

const MyDishCard = memo(function MyDishCard({
	item,
	onPress,
	onPressMarkAsEaten,
}: {
	item: MyDishItem;
	onPress: (i: MyDishItem) => void;
	onPressMarkAsEaten: (i: MyDishItem) => void;
}) {
	const { lightImpact } = useHaptics();
	// #958 と同じ理由で useWindowDimensions ではなく CenteredAppShell の中央カラム幅を使う
	const contentWidth = useContentWidth();
	const width = useMemo(() => (contentWidth - PADDING_HORIZONTAL * 2 - GAP * (COLUMNS - 1)) / COLUMNS, [contentWidth]);
	const height = width / ASPECT_RATIO;

	// #1398 PR5 写真なし（dishMedia === null）でも categoryImageUrl → restaurant.image_url へ
	// フォールバックする。3 つとも無いときだけ null（= 無地プレースホルダー）
	const thumbnailUrl = resolveMyDishThumbnailUrl(item);
	const isNoPhoto = item.dishMedia === null;
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
				// #1398 PR5 【仕様】categoryImageUrl / restaurant.image_url も無い異常系だけがここに来る
				// （dishMedia === null というだけではこの分岐に来ない。#1396 当時の「写真なし記録＝この
				// プレースホルダー」という前提は変わったが、testID は e2e から未参照のため残している）
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
						{/* 白塗りの側は文字も赤でなければ読めない。色は statusColors から 1 組で取る */}
						<Text style={[styles.statusBadgeText, { color: MY_DISH_STATUS_COLORS[item.status].on }]}>
							{i18n.t(`MyDishes.filters.status.${item.status}`)}
						</Text>
					</View>
					{/* #1398 PR5 実画像へフォールバックしても「写真なし」自体は分かるようにする */}
					{source && isNoPhoto && (
						<View style={styles.noPhotoBadge} testID="my-dishes-list-item-no-photo-badge">
							<ImageOff size={10} color="#FFFFFF" />
							<Text style={styles.noPhotoBadgeText}>{i18n.t("MyDishes.list.noPhoto")}</Text>
						</View>
					)}
				</View>
				<View style={styles.footer}>
					{rating !== null && <Text style={styles.ratingText}>{`★${rating}`}</Text>}
					<Text style={styles.footerText} numberOfLines={1}>
						{dishName ?? item.restaurant.name ?? ""}
					</Text>
					{/* #1375 実機確認: 一覧に店舗名も出す。1 行目に料理名が出ているときだけ 2 行目を足す
					    （料理名が無くて店名が 1 行目へ落ちている場合に同じ文字列が 2 行並ぶのを避ける） */}
					{dishName && !!item.restaurant.name && (
						<Text style={styles.footerSubText} numberOfLines={1} testID="my-dishes-list-item-restaurant">
							{item.restaurant.name}
						</Text>
					)}
					{/* #1398 PR4: want 行だけ。押しても親（= 全画面 Feed への遷移）は走らない */}
					<MyDishEatenButton item={item} onPress={onPressMarkAsEaten} />
				</View>
			</LinearGradient>
		</Pressable>
	);
});

export function MyDishesListView() {
	const { locale } = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { items, isLoading, isLoadingMore, error, hasNextPage, loadMore, refresh } = useMyDishesQuery();

	const data = useMemo<MyDishGridItem[]>(() => items.map((item) => ({ id: item.key, item })), [items]);

	// #1397 (PR4/5) Q2 確定: リスト項目のタップ先は **その項目の店舗スコープの Feed**。
	// 代案（フィルタ済み一覧全体を縦スクロールする Feed）は ids を URL に積むか store 前提にするしか
	// なく、**web のリロード・直リンクで壊れる**ので採らない（設計 (2/2) §9-3 / Q2）。
	//
	// ⚠️ **index ではなく `itemKey` を渡す**（R1）。一覧の並びは写真なしの行を含み、Feed の並びは
	// 含まないので、index を渡すと写真なしが 1 件混ざった瞬間に別の料理が開く。
	// 写真なしの行（`dishMedia === null`）は Feed に入れられないので従来どおり店舗詳細へ。
	const handlePressItem = useCallback(
		(item: MyDishItem) => {
			const hasPhoto = item.dishMedia !== null;
			logFrontendEvent({
				event_name: MY_DISHES_EVENTS.listItemSelected,
				error_level: "log",
				payload: { itemKey: item.key, status: item.status, hasPhoto },
			});
			if (hasPhoto && item.dishMedia !== null) {
				router.push({
					pathname: "/[locale]/(tabs)/my-dishes/feed",
					params: {
						locale,
						restaurantId: item.restaurant.id,
						itemKey: item.key,
						dishMediaId: String(item.dishMedia.id),
					},
				});
				return;
			}
			router.push({
				pathname: "/[locale]/restaurant/[restaurantId]",
				params: { locale, restaurantId: item.restaurant.id },
			});
		},
		[locale, logFrontendEvent],
	);

	// #1398 (PR4/7) want カードの「食べたを記録」。カード全体のタップ（= 全画面 Feed）とは別経路。
	// 押しても Feed が開かないことは `MyDishEatenButton` 側の stopPropagation が担保する
	const handleMarkAsEaten = useCallback(
		(item: MyDishItem) => {
			const route = buildMarkAsEatenRoute(item, locale);
			if (route === null) return;
			lightImpact();
			logFrontendEvent({
				event_name: MY_DISHES_EVENTS.markAsEatenPressed,
				error_level: "log",
				payload: { itemKey: item.key, from: "list" },
			});
			// #1403 (PR2) 出口（記録の完了）は共有ルート `review-from-media` にあり、そこは
			// my-dishes 以外からも入ってくる。ここで «my-dishes から押した» ことを預けておき、
			// 完了時に取り出して `my_dishes_mark_as_eaten_completed` を出す（markAsEatenFunnel）
			beginMarkAsEaten({
				from: "list",
				itemKey: item.key,
				restaurantId: route.params.restaurantId,
				dishMediaId: route.params.dishMediaId,
				startedAt: Date.now(),
			});
			router.push(route);
		},
		[lightImpact, locale, logFrontendEvent],
	);

	const renderItem = useCallback(
		({ item }: { item: MyDishGridItem }) => (
			<MyDishCard item={item.item} onPress={handlePressItem} onPressMarkAsEaten={handleMarkAsEaten} />
		),
		[handleMarkAsEaten, handlePressItem],
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
		gap: 4,
	},
	statusBadge: {
		paddingHorizontal: 6,
		paddingVertical: 2,
		borderRadius: 10,
	},
	noPhotoBadge: {
		flexDirection: "row",
		alignItems: "center",
		gap: 2,
		paddingHorizontal: 6,
		paddingVertical: 2,
		borderRadius: 10,
		backgroundColor: "rgba(17,24,39,0.6)",
	},
	noPhotoBadgeText: {
		fontSize: 9,
		fontWeight: "700",
		color: "#FFFFFF",
	},
	// #1375（5 巡目）塗りの有無で区別する: 食べたい = 白塗り赤枠 / 食べた = 赤塗り
	statusWant: {
		backgroundColor: MY_DISH_STATUS_COLORS.want.fill,
		borderWidth: 1,
		borderColor: MY_DISH_STATUS_COLORS.want.border,
	},
	statusEaten: {
		backgroundColor: MY_DISH_STATUS_COLORS.eaten.fill,
		borderWidth: 1,
		borderColor: MY_DISH_STATUS_COLORS.eaten.border,
	},
	statusBadgeText: {
		fontSize: 10,
		fontWeight: "700",
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
	footerSubText: {
		fontSize: 10,
		color: "rgba(255,255,255,0.85)",
	},
});
