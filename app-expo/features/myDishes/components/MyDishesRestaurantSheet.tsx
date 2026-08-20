import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { FlatList, InteractionManager, Pressable, StyleSheet, Text, View } from "react-native";
import { TrueSheet } from "@lodev09/react-native-true-sheet";
import { Image } from "expo-image";
import { router, useFocusEffect, useNavigation } from "expo-router";
import { ChevronRight, Maximize2 } from "lucide-react-native";
import { EmptyState } from "@/components/EmptyState";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { SheetGestureRoot } from "@/components/SheetGestureRoot";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { dismissSheetSafely, presentSheetSafely } from "@/lib/trueSheet";
import type { MyDishItem, MyDishPin } from "@shared/api/v1/res";
import { useMyDishesRestaurantQuery } from "../hooks/useMyDishesRestaurantQuery";
import {
	MyDishStatusBadge,
	formatMyDishOccurredAt,
	resolveMyDishTitle,
	useMyDishImageSource,
} from "./myDishCard";

/**
 * #1397 (PR3/5) Map のピンをタップして開く「料理メディア Sheet」。
 *
 * ## 何で作っているか（設計 (1/2) §6 / R6・R7）
 *
 * `@lodev09/react-native-true-sheet` + 縦 `FlatList` の**素の構成**。
 *
 * - **BlurModal（`react-native-paper` の `Portal`）は使わない。**
 *   `scripts/assert-legacy-blur-modal-boundary.mjs` の許可リストへ新しい画面を足さない。
 * - `TrueSheetProvider` は `app/[locale]/_layout.tsx` で既にアプリ全体に載っている。
 * - 中身は必ず `SheetGestureRoot` で包む（R6）。Android の TrueSheet は中身を
 *   `android.R.id.content` へ付け替えるため、包まないと RNGH のジェスチャが届かない
 *   （`components/SheetGestureRoot.tsx` の実機知見）。
 * - **`savedRestaurantsSheetGesture.ts` は輸入しない**（R6）。あれは #1126 の
 *   «横カルーセル × Android の `ViewDragHelper`» 専用の対策で、縦スクロールしかしない
 *   この Sheet に持ち込むと既知の競合窓ごと持ち込むことになる。
 *
 * ## `scrollable` を必ず立てる（縦リストが動く条件）
 *
 * `scrollable` は「中の ScrollView / FlatList をシートの可視領域に収める」ためのスイッチで、
 * プラットフォームごとに実装が違う（v3.11.9 の実装を読んで確認した）:
 *
 * | | `scrollable` が何をするか |
 * | --- | --- |
 * | iOS | ScrollView をシートの余白へピン留めする |
 * | Android | content へ追加のスタイルを当てる |
 * | native 共通 | ライブラリが content の `style` へ `flex: 1` を足す（`TrueSheet.js` の `scrollableContent`） |
 * | web | 中身を `overflowY: auto` の div で包む（`TrueSheet.web.js` の `scrollableContainerStyle`）。`flex: 1` は足さない |
 *
 * ⚠️ **web で縦スクロールを担うのは FlatList ではなく «シート自身の器» である。**
 * chromium（Playwright）で TrueSheet の web 実装を直接動かして実測した結果:
 *
 * - `scrollable` あり … `data-vaul-scroll-locked` の div が `clientHeight 458 / scrollHeight 3552` になり、
 *   ホイールでもプログラムからも最下行まで到達する
 * - `scrollable` なし … スクロールできる器が **1 つも生まれず**、リストは伸びたまま切れる
 *
 * つまり `scrollable` を落とすと web で «開くが読めない» Sheet になる。必ず立てること。
 *
 * なお「web では `flex: 1` を書くと潰れるのでは」という懸念は、同じ実測で
 * **本体・FlatList のどちらへ付けても挙動が変わらない**ことを確認済みである
 * （器が block なので flex が効かない）。そのため native / web でスタイルを分けていない。
 */

/** 1 行のサムネイル寸法 */
const THUMBNAIL_SIZE = 72;

export type MyDishesRestaurantSheetProps = {
	/**
	 * 開く対象のピン。`null` の間は Sheet を閉じ、取得も一切行わない
	 * （`useMyDishesRestaurantQuery(null)` は 1 本もクエリを投げない）。
	 */
	pin: MyDishPin | null;
	/**
	 * Sheet が閉じ切ったときに呼ばれる。呼び出し側はここで `pin` を `null` に戻す。
	 *
	 * ⚠️ 閉じる経路（スワイプ / 背景タップ / 「一覧で見る」）を **`onDidDismiss` の 1 本**へ集約している。
	 * 呼び出し側で先に `pin` を `null` にすると、閉じるアニメーションの途中で中身が空になる。
	 */
	onDismissed: () => void;
};

const MyDishSheetRow = memo(function MyDishSheetRow({
	item,
	locale,
	onPress,
}: {
	item: MyDishItem;
	locale: string;
	onPress: (item: MyDishItem) => void;
}) {
	// #1375 追補2 決定3: 写真なしの記録も **実画像**（categoryImageUrl → restaurant.image_url）で並べる。
	// 灰色プレースホルダーにしない（一覧ビューとの意図的な非対称。myDishCard.tsx 参照）
	const source = useMyDishImageSource(item, "category");
	const hasPhoto = item.dishMedia !== null;
	const title = resolveMyDishTitle(item);
	const rating = item.myReview?.rating ?? null;
	const occurredAt = formatMyDishOccurredAt(item.occurredAt, locale);

	const handlePress = useCallback(() => onPress(item), [item, onPress]);

	return (
		<Pressable
			// #1396 §6-1 / #1397 §11-2: 動的な testID は作らない。E2E は nth() で指す
			testID="my-dishes-sheet-item"
			style={styles.row}
			onPress={handlePress}
			android_ripple={{ color: "rgba(0,0,0,0.06)" }}
			accessibilityRole="button"
			accessibilityLabel={title ?? i18n.t("ImageCardGrid.openItemDetails")}>
			<View
				// 写真なしの行を E2E から指せるようにする。**灰色の箱ではなく実画像が入っている**
				// （n-1: 一覧ビューの `my-dishes-list-item-placeholder` とは逆の意味なので同じ名前にしない）
				testID={hasPhoto ? undefined : "my-dishes-sheet-item-no-photo"}
				style={styles.thumbnailWrapper}>
				{source ? (
					<Image
						source={source}
						cachePolicy="memory-disk"
						transition={100}
						style={styles.thumbnail}
						contentFit="cover"
						alt=""
						accessibilityElementsHidden
						importantForAccessibility="no"
					/>
				) : (
					<View style={[styles.thumbnail, styles.thumbnailFallback]} />
				)}
			</View>

			<View style={styles.rowBody}>
				<Text style={styles.rowTitle} numberOfLines={2}>
					{title ?? ""}
				</Text>
				<View style={styles.rowMeta}>
					<MyDishStatusBadge status={item.status} />
					{rating !== null && <Text style={styles.rowRating}>{`★${rating}`}</Text>}
					{occurredAt !== null && <Text style={styles.rowDate}>{occurredAt}</Text>}
				</View>
				{!hasPhoto && (
					// タップ先が Feed ではなく店舗詳細であることを明示する（設計 (1/2) §3）
					<Text style={styles.rowHint} numberOfLines={2}>
						{i18n.t("MyDishes.sheet.noPhotoHint")}
					</Text>
				)}
			</View>

			<ChevronRight size={16} color="#9CA3AF" />
		</Pressable>
	);
});

export function MyDishesRestaurantSheet({ pin, onDismissed }: MyDishesRestaurantSheetProps) {
	const { locale } = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const navigation = useNavigation();
	const sheetRef = useRef<TrueSheet>(null);

	const restaurantId = pin?.restaurant.id ?? null;
	const { items, isLoading, error, hasFetchedInitial, hasNextPage, refresh } =
		useMyDishesRestaurantQuery(restaurantId);

	// #1397 §9-1: 開閉は «ルートではなく» 内部 state。Map を再マウントさせないことが目的なので、
	// ここから router.push / setParams で Map を巻き込むことはしない（行の遷移は除く）
	useEffect(() => {
		if (restaurantId === null) {
			void dismissSheetSafely(sheetRef);
			return;
		}

		// 先例（SavedRestaurantsSheet）と同じ手順。Android は初回レイアウトが 1 フレームで
		// 足りないことがあるので InteractionManager + rAF 2 段で present を遅らせる
		let cancelled = false;
		let raf1: number | null = null;
		let raf2: number | null = null;
		const task = InteractionManager.runAfterInteractions(() => {
			raf1 = requestAnimationFrame(() => {
				raf2 = requestAnimationFrame(async () => {
					if (cancelled) return;
					await presentSheetSafely(sheetRef);
				});
			});
		});

		return () => {
			cancelled = true;
			task.cancel();
			if (raf1 !== null) cancelAnimationFrame(raf1);
			if (raf2 !== null) cancelAnimationFrame(raf2);
		};
	}, [restaurantId]);

	// レビュー M-1: `/[locale]/restaurant/[restaurantId]` への push は root stack への push なので
	// my-dishes/index.tsx はアンマウントされない（#1439 M-1 の keep-alive でビュー切替でも残る）。
	// つまり unmount 頼みのクリーンアップは一度も走らず、この Sheet が提供する唯一の遷移（行タップ・
	// ヘッダの店名タップ）の遷移先が、自分が開いた Sheet に覆われる。
	// 先例 #644（select-restaurant.tsx）と同じ 2 本で閉じる:
	// 1. フォーカスを失ったとき（他画面へ push した瞬間）に dismiss する
	useFocusEffect(
		useCallback(() => {
			return () => {
				void dismissSheetSafely(sheetRef);
			};
		}, []),
	);
	// 2. 画面を離れる直前（戻る操作の開始時）にも dismiss する
	useEffect(() => {
		const unsubscribe = navigation.addListener("beforeRemove", () => {
			void dismissSheetSafely(sheetRef);
		});
		return unsubscribe;
	}, [navigation]);

	// 上の 2 本の上に載る保険。#644 の対策はこれだけでは一度も走らないことが今回の Major だった
	useEffect(() => {
		return () => {
			void dismissSheetSafely(sheetRef);
		};
	}, []);

	const handlePressRestaurant = useCallback(() => {
		if (restaurantId === null) return;
		lightImpact();
		logFrontendEvent({
			event_name: "my_dishes_sheet_restaurant_selected",
			error_level: "log",
			payload: { restaurantId },
		});
		// Q6: 店舗詳細への導線だけ残す。「この店の全レビューを見る」は置かない
		router.push({ pathname: "/[locale]/restaurant/[restaurantId]", params: { locale, restaurantId } });
	}, [lightImpact, locale, logFrontendEvent, restaurantId]);

	// #1397 (PR4/5) 行タップの遷移先は写真の有無で分かれる（設計 (1/2) §3）。
	// - 写真あり … 全画面 Feed へ。**index ではなく `itemKey` を渡す**（R1）。
	//   Sheet の並びは写真なしを含み Feed の並びは含まないので、index を渡すと
	//   写真なしが 1 件混ざった瞬間に別の料理が開く
	// - 写真なし … `dish_media.id` が無く Feed に入れられないので、従来どおり店舗詳細へ
	const handlePressItem = useCallback(
		(item: MyDishItem) => {
			lightImpact();
			const hasPhoto = item.dishMedia !== null;
			logFrontendEvent({
				event_name: "my_dishes_sheet_item_selected",
				error_level: "log",
				payload: { itemKey: item.key, status: item.status, hasPhoto },
			});
			if (hasPhoto) {
				router.push({
					pathname: "/[locale]/(tabs)/my-dishes/feed",
					params: { locale, restaurantId: item.restaurant.id, itemKey: item.key },
				});
				return;
			}
			router.push({
				pathname: "/[locale]/restaurant/[restaurantId]",
				params: { locale, restaurantId: item.restaurant.id },
			});
		},
		[lightImpact, locale, logFrontendEvent],
	);

	/**
	 * #1397 (PR4/5)「全画面で見る」。Feed には写真ありの行しか入れられないので、
	 * **その店の記録が全部写真なしのときは出さない**（設計 (1/2) §3）。
	 * 開始位置は先頭の写真あり行を `itemKey` で指す（R1: index は渡さない）。
	 */
	const firstPhotoItem = useMemo(() => items.find((item) => item.dishMedia !== null) ?? null, [items]);

	const handleExpand = useCallback(() => {
		if (firstPhotoItem === null || restaurantId === null) return;
		lightImpact();
		logFrontendEvent({
			event_name: "my_dishes_sheet_expanded",
			error_level: "log",
			payload: { restaurantId, itemKey: firstPhotoItem.key },
		});
		router.push({
			pathname: "/[locale]/(tabs)/my-dishes/feed",
			params: { locale, restaurantId, itemKey: firstPhotoItem.key },
		});
	}, [firstPhotoItem, lightImpact, locale, logFrontendEvent, restaurantId]);

	/**
	 * §8-3: Sheet の中に無限スクロールを持ち込まない。1 ページ（42 件）を超えるぶんは
	 * 一覧ビューへ送る。`router.setParams` なので履歴は積まず、Map は再マウントしない。
	 */
	const handleSeeAllInList = useCallback(() => {
		lightImpact();
		logFrontendEvent({ event_name: "my_dishes_sheet_see_all_in_list", error_level: "log", payload: {} });
		void dismissSheetSafely(sheetRef);
		router.setParams({ view: "list" });
	}, [lightImpact, logFrontendEvent]);

	const handleDidDismiss = useCallback(() => {
		onDismissed();
	}, [onDismissed]);

	const renderItem = useCallback(
		({ item }: { item: MyDishItem }) => <MyDishSheetRow item={item} locale={locale} onPress={handlePressItem} />,
		[handlePressItem, locale],
	);

	const keyExtractor = useCallback((item: MyDishItem) => item.key, []);

	const showInitialLoading = isLoading && !hasFetchedInitial && !error;
	// 一覧ビュー / Map ビューと揃える: 取得に失敗したときも EmptyState を出して再試行の口を残す
	// n-2（#1450 からの申し送り。PR4 で対応）: `items.length === 0` を条件へ足した。
	// PR4 の Q4（Feed を閉じるときに店舗スコープの Sheet スライスだけ invalidate する）が入り、
	// 「行があるのに error が立つ」が到達可能になったため。これが無いと、**保存を外して戻った
	// ときに通信が一瞬こけただけで、記録が全部消えたように見える**（読めているリストごと
	// EmptyState に差し替わる）。行が 1 行でもあるなら、それを出したまま黙って耐えるのが正しい
	const showEmpty = !isLoading && items.length === 0 && (error !== null || hasFetchedInitial);

	const header = useMemo(
		() => (
			<View style={styles.header}>
				<Pressable
					testID="my-dishes-sheet-title"
					onPress={handlePressRestaurant}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("MyDishes.sheet.openRestaurant")}
					style={styles.headerTitleRow}
					hitSlop={8}>
					<Text style={styles.headerTitle} numberOfLines={1}>
						{i18n.t("MyDishes.sheet.title", { restaurant: pin?.restaurant.name ?? "" })}
					</Text>
					<ChevronRight size={16} color="#6B7280" />
				</Pressable>
				<Text style={styles.headerCounts}>
					{i18n.t("MyDishes.sheet.counts", {
						want: pin?.counts.want ?? 0,
						eaten: pin?.counts.eaten ?? 0,
					})}
				</Text>
				{/* 写真ありの記録が 1 件も無い店舗では出さない（Feed に入れるものが無い） */}
				{firstPhotoItem !== null && (
					<Pressable
						testID="my-dishes-sheet-expand"
						onPress={handleExpand}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("MyDishes.sheet.expand")}
						style={styles.expand}
						hitSlop={8}>
						<Maximize2 size={14} color="#357AFF" />
						<Text style={styles.expandText}>{i18n.t("MyDishes.sheet.expand")}</Text>
					</Pressable>
				)}
			</View>
		),
		[firstPhotoItem, handleExpand, handlePressRestaurant, pin],
	);

	return (
		<TrueSheet
			ref={sheetRef}
			detents={[0.6, 1]}
			cornerRadius={24}
			backgroundColor="#FFFFFF"
			// 縦 FlatList を «シートの可視領域» に収めるための唯一のスイッチ（冒頭コメントの表を参照）
			scrollable
			header={header}
			onDidDismiss={handleDidDismiss}>
			{/* ⚠️ 素の View へ戻さないこと。Android は中身を android.R.id.content へ付け替えるため、
			    RNGH のジェスチャが届かなくなる（components/SheetGestureRoot.tsx） */}
			<SheetGestureRoot testID="my-dishes-sheet" style={styles.body}>
				{restaurantId === null ? null : showInitialLoading ? (
					<View style={styles.centered}>
						<LoadingIndicator size="large" />
					</View>
				) : showEmpty ? (
					<View style={styles.centered}>
						<EmptyState
							message={i18n.t("MyDishes.empty.description")}
							error={error}
							onRetry={refresh}
							testID="my-dishes-sheet-empty"
						/>
					</View>
				) : (
					<FlatList
						data={items}
						renderItem={renderItem}
						keyExtractor={keyExtractor}
						style={styles.list}
						contentContainerStyle={styles.listContent}
						showsVerticalScrollIndicator={false}
						// §8-3: onEndReached を持たない。追加読み込みはこの Sheet の責務ではない
						ListFooterComponent={
							hasNextPage ? (
								<Pressable
									testID="my-dishes-sheet-see-all-in-list"
									style={styles.seeAll}
									onPress={handleSeeAllInList}
									accessibilityRole="button"
									accessibilityLabel={i18n.t("MyDishes.sheet.seeAllInList")}>
									<Text style={styles.seeAllText}>{i18n.t("MyDishes.sheet.seeAllInList")}</Text>
									<ChevronRight size={16} color="#357AFF" />
								</Pressable>
							) : null
						}
					/>
				)}
			</SheetGestureRoot>
		</TrueSheet>
	);
}

const styles = StyleSheet.create({
	// native は `scrollable` がライブラリ側で content へ flex:1 を足すので、こちらも伸ばして
	// FlatList へ高さを渡す。web では器（block）が高さを持つので、この flex は効かない（実測済み）
	body: {
		flex: 1,
	},
	list: {
		flex: 1,
	},
	header: {
		paddingHorizontal: 16,
		paddingTop: 16,
		paddingBottom: 8,
		gap: 2,
	},
	headerTitleRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
	},
	headerTitle: {
		flexShrink: 1,
		fontSize: 16,
		fontWeight: "700",
		color: "#111827",
	},
	headerCounts: {
		fontSize: 12,
		color: "#6B7280",
	},
	expand: {
		flexDirection: "row",
		alignItems: "center",
		alignSelf: "flex-start",
		gap: 4,
		marginTop: 6,
	},
	expandText: {
		fontSize: 13,
		fontWeight: "600",
		color: "#357AFF",
	},
	centered: {
		paddingVertical: 32,
		paddingHorizontal: 24,
	},
	listContent: {
		paddingHorizontal: 16,
		paddingBottom: 32,
	},
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		paddingVertical: 8,
	},
	thumbnailWrapper: {
		width: THUMBNAIL_SIZE,
		height: THUMBNAIL_SIZE,
		borderRadius: 8,
		overflow: "hidden",
		backgroundColor: "#F3F4F6",
	},
	thumbnail: {
		width: THUMBNAIL_SIZE,
		height: THUMBNAIL_SIZE,
	},
	thumbnailFallback: {
		backgroundColor: "#F3F4F6",
	},
	rowBody: {
		flex: 1,
		gap: 4,
	},
	rowTitle: {
		fontSize: 14,
		fontWeight: "600",
		color: "#111827",
	},
	rowMeta: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	rowRating: {
		fontSize: 12,
		fontWeight: "700",
		color: "#F05537",
	},
	rowDate: {
		fontSize: 12,
		color: "#6B7280",
	},
	rowHint: {
		fontSize: 11,
		color: "#9CA3AF",
	},
	seeAll: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 4,
		marginTop: 8,
		paddingVertical: 12,
	},
	seeAllText: {
		fontSize: 14,
		fontWeight: "600",
		color: "#357AFF",
	},
});
