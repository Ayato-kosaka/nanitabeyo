import React, { useEffect, useMemo, useRef, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import { View, StyleSheet, Text, TouchableOpacity, useWindowDimensions, Platform } from "react-native";
import { DetentChangeEvent, TrueSheet } from "@lodev09/react-native-true-sheet";
import { presentSheetSafely, dismissSheetSafely } from "@/lib/trueSheet";
import { SheetGestureRoot } from "@/components/SheetGestureRoot";
import { Carousel, type CarouselRef } from "react-native-reanimated-carousel";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Image } from "expo-image";
import i18n from "@/lib/i18n";
import { getCacheKeyForImage } from "@/lib/image";
import type { QueryMeSavedRestaurantsResponse } from "@shared/api/v1/res";
import { SkeletonShimmer } from "@/components/SkeletonShimmer";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { InteractionManager } from "react-native";
import { ScrollView } from "react-native";
import { useContentWidth } from "@/hooks/useContentWidth";
import { CARD_HEIGHT, LARGE_DETENT, computeSmallDetent } from "./savedRestaurantsSheetDetents";
import {
	CAROUSEL_DRAG_RESET_TIMEOUT_MS,
	configureCarouselPanGesture,
	isSheetDraggable,
} from "./savedRestaurantsSheetGesture";

type SavedRestaurant = QueryMeSavedRestaurantsResponse["data"][number];

/**
 * #1126 横スワイプ中にシートのドラッグを止める必要があるのは Android だけ。
 *
 * Android の `BottomSheetBehavior`(`ViewDragHelper`) は `abs(dy) > touchSlop(8dp)` だけで
 * ドラッグを開始し、横方向の移動量と比較しない（詳細は savedRestaurantsSheetGesture.ts）。
 * iOS（UIKit のシート）と web（@gorhom/bottom-sheet）はこの判定を持たないため、
 * 挙動と見た目を変えないよう Android に限定する。
 *
 * なお TrueSheet は `draggable` が変わるたびにネイティブのグラバーを作り直し、
 * `draggable === false` の間はグラバーを消してしまう（横スワイプのたびに点滅する）。
 * そのため Android ではネイティブのグラバーを無効化し、ヘッダー内に同じ見た目
 * （32x4dp / 角丸 / 黒 40% / シート上端から 16dp）のグラバーを自前で描画する。
 *
 * ## ⚠️ 残っている競合窓（既知。JS からは閉じ切れない）
 * `draggable` を false にするのは `onScrollStart`、つまりカルーセルの Pan が
 * `activeOffsetX = 10dp` を超えて **活性化したあと**。一方 Android のシートは
 * `abs(dy) > 8dp` で掴む。したがって
 *
 *   「横へ 10dp 動くより先に、縦へ 8dp ぶれた入力」
 *
 * では**シートが先に掴み、#1126 の症状（横スワイプで縦に広がる）が残る**。
 * 角度でいうと水平から約 38.7°(= atan(8/10)) より急な入力が該当する。
 * さらに `draggable` は React の prop なので、UI スレッドで判定できても
 * ネイティブへ反映されるまで 1 フレーム前後の遅れがあり、非常に速いスワイプでは
 * その遅れぶんの窓も残る。
 *
 * **これを「タッチダウン時点で false にする」方向へ直すのは見送っている。**
 * その場合、意図的な縦ドラッグでもカルーセルの Pan が fail するまで
 * （`failOffsetY = 20dp`）シートを掴めず、展開操作に遅れが出る。
 * どちらの体感がましかは実機でしか判断できないため、#1126 は実機確認へ残している
 * （Issue #1126）。
 */
const GATES_SHEET_DRAG = Platform.OS === "android";

export type SavedRestaurantsSheetHandle = {
	present: () => Promise<void>;
	dismiss: () => Promise<void>;
};

export type SavedRestaurantsSheetProps = {
	visible: boolean;
	/** #1375（3 巡目）pick モードでは「写真・動画を投稿」を出さない（カードタップ = 選択） */
	showReviewButton?: boolean;
	savedRestaurants: QueryMeSavedRestaurantsResponse["data"];
	isLoadingSavedRestaurants: boolean;
	activeRestaurantId: string | null;
	onRestaurantCardPress: (restaurant: SavedRestaurant) => void;
	onRestaurantReviewPress: (restaurant: SavedRestaurant) => void;
	onSnapToRestaurant?: (restaurant: SavedRestaurant) => void;
};

/**
 * #1067 幅に依存するスタイル・寸法をコンポーネント内で算出する。
 *
 * 以前はモジュール評価時の `Dimensions.get("window").width`（= ブラウザの実幅）を
 * `StyleSheet.create` 内で使っていたため、web の中央カラム(#958, maxWidth 560px)の
 * 外側にカードが描画され、1280px 幅ではカードも「写真・動画を投稿」ボタンも
 * 可視領域に出てこなかった。`useContentWidth` でカラム幅にクランプして揃える
 * （native ではウィンドウ幅がそのまま返るため挙動は変わらない）。
 */
function useWidthMetrics() {
	const contentWidth = useContentWidth();
	return useMemo(() => {
		const cardWidth = contentWidth * 0.92;
		return {
			contentWidth,
			cardWidth,
			carouselWrapper: { width: contentWidth },
			carousel: { width: contentWidth },
			savedRestaurantItemContainer: {
				width: cardWidth,
				marginHorizontal: (contentWidth - cardWidth) / 2,
			},
			listItemContainer: { width: cardWidth },
		};
	}, [contentWidth]);
}

/**
 * #1074 native で回転するとウィンドウ高さが変わりうる（web のリサイズ、Android の分割画面・
 * フリーフォーム、OS が orientation 指定を無視する大画面デバイスなど）ため、`SMALL_DETENT` を
 * モジュール評価時の固定値ではなく `useWindowDimensions()` の高さから算出する。
 * `useWidthMetrics` と同様、`TrueSheet` の `detents` へ渡す配列を毎レンダー新規生成しないよう
 * `useMemo` でまとめる。
 */
function useSheetDetents() {
	const { height: windowHeight } = useWindowDimensions();
	return useMemo(() => {
		return [computeSmallDetent(windowHeight), LARGE_DETENT];
	}, [windowHeight]);
}

/**
 * SavedRestaurantsSheet
 *
 * - 表示/非表示は `visible` props をソースオブトゥルースとして管理する
 * - TrueSheet の present/dismiss は useEffect + setTimeout(0) で iOS のマウントタイミング問題を回避
 * - 画面側からは `visible` props と ref からの dismiss/present で開閉を制御する
 */
export const SavedRestaurantsSheet = forwardRef<SavedRestaurantsSheetHandle, SavedRestaurantsSheetProps>(
	function SavedRestaurantsSheetInner(props, ref) {
		const {
			visible,
			showReviewButton = true,
			savedRestaurants,
			isLoadingSavedRestaurants,
			activeRestaurantId,
			onRestaurantCardPress,
			onRestaurantReviewPress,
			onSnapToRestaurant,
		} = props;
		const { colors } = useAppTheme();
		const styles = useThemedStyles(createStyles);
		const widthMetrics = useWidthMetrics();
		const sheetDetents = useSheetDetents();
		const sheetRef = useRef<TrueSheet>(null);
		const carouselRef = useRef<CarouselRef | null>(null);
		const isDraggingRef = useRef(false);
		// #1092 PR3 `number` 決め打ちにしない。@types/node を app-expo の devDependency へ明示したことで
		// setTimeout の戻り値型が環境によって number / NodeJS.Timeout のどちらにも解決しうるため
		const draggingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

		// 親コンポーネントから present/dismiss を呼び出せるようにする
		useImperativeHandle(ref, () => ({
			present: async () => {
				await presentSheetSafely(sheetRef);
			},
			dismiss: async () => {
				await dismissSheetSafely(sheetRef);
			},
		}));

		useEffect(() => {
			// visible の変化に応じて TrueSheet を開閉
			if (!visible) {
				void dismissSheetSafely(sheetRef);
				return;
			}

			let cancelled = false;
			let raf1: number | null = null;
			let raf2: number | null = null;
			const task = InteractionManager.runAfterInteractions(() => {
				// Android は初回レイアウトが 1 フレームじゃ足りないことがあるので rAF を二段にする
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
				if (raf1) cancelAnimationFrame(raf1);
				if (raf2) cancelAnimationFrame(raf2);
			};
		}, [visible]);

		useEffect(() => {
			return () => {
				// #644 コンポーネントアンマウント時にタイムアウトをクリーンアップ
				if (draggingTimeoutRef.current) {
					clearTimeout(draggingTimeoutRef.current);
				}
				// #644 コンポーネントアンマウント時に確実に閉じておく
				void dismissSheetSafely(sheetRef);
			};
		}, []);

		const [detentIndex, setDetentIndex] = useState(0);
		// #1126 カルーセルの横スワイプが成立している間だけシートのドラッグを止めるためのフラグ。
		// isDraggingRef（カード誤タップ抑止）と違い、TrueSheet へ props で渡すので state が必要。
		const [isSwipingCarousel, setIsSwipingCarousel] = useState(false);

		const endCarouselSwipe = useCallback(() => {
			isDraggingRef.current = false;
			setIsSwipingCarousel(false);
			if (draggingTimeoutRef.current) {
				clearTimeout(draggingTimeoutRef.current);
				draggingTimeoutRef.current = null;
			}
		}, []);

		const beginCarouselSwipe = useCallback(() => {
			isDraggingRef.current = true;
			setIsSwipingCarousel(true);
			// #644 【バグ】タイムアウトフォールバックを追加して isDraggingRef が true のまま固まるのを防ぐ
			// #1126 シートのドラッグ抑止も同じタイマーで必ず解除する（解除漏れでシートが動かせなくなるのを防ぐ）
			if (draggingTimeoutRef.current) {
				clearTimeout(draggingTimeoutRef.current);
			}
			draggingTimeoutRef.current = setTimeout(endCarouselSwipe, CAROUSEL_DRAG_RESET_TIMEOUT_MS);
		}, [endCarouselSwipe]);

		const handleDetentChange = useCallback(
			(event: DetentChangeEvent) => {
				setDetentIndex(event.nativeEvent.index);
				// #1126 detent が変わるとカルーセル自体がアンマウントされ onScrollEnd が来ないことがあるため、
				// ここでも抑止を解除しておく
				endCarouselSwipe();
			},
			[endCarouselSwipe],
		);

		/**
		 * #1126 `onSnapToItem` の関数 ID は reanimated-carousel の内部で
		 * `onScrollEnd` → `onGestureEnd` → Pan ジェスチャの useMemo の依存に伝播する。
		 * インライン関数のままだと、横スワイプ中の再レンダー（isSwipingCarousel の更新）で
		 * ジェスチャオブジェクトが作り直され、進行中のスワイプが切れてしまう。
		 */
		const handleSnapToItem = useCallback(
			(index: number) => {
				endCarouselSwipe();
				const restaurant = savedRestaurants[index];
				if (restaurant) onSnapToRestaurant?.(restaurant);
			},
			[endCarouselSwipe, savedRestaurants, onSnapToRestaurant],
		);

		const activeIndex = useMemo(() => {
			return savedRestaurants.findIndex((r) => r.restaurant.id === activeRestaurantId);
		}, [savedRestaurants, activeRestaurantId]);

		useEffect(() => {
			if (activeIndex >= 0) {
				carouselRef.current?.scrollTo({ index: activeIndex, animated: true });
			}
		}, [activeIndex]);

		const renderItem = useCallback(
			({ item }: { item: SavedRestaurant }) => (
				<View style={[styles.savedRestaurantItemContainer, widthMetrics.savedRestaurantItemContainer]}>
					<PrimaryCard
						item={item}
						onPress={() => {
							if (isDraggingRef.current) return;
							onRestaurantCardPress(item);
						}}
						/* #1375（6 巡目）**ここが showReviewButton を無視していた。**
						   下の縦リスト側（PrimaryCard の 2 つ目の呼び出し）は pick モードで
						   «写真・動画を投稿» を隠していたのに、横スクロールの帯だけ常に渡しており、
						   «お店を選ぶだけ» の画面にこのボタンが出続けていた（実機で指摘） */
						onReview={
							showReviewButton
								? () => {
										if (isDraggingRef.current) return;
										onRestaurantReviewPress(item);
									}
								: undefined
						}
					/>
				</View>
			),
			[
				onRestaurantCardPress,
				onRestaurantReviewPress,
				showReviewButton,
				widthMetrics.savedRestaurantItemContainer,
				styles,
			],
		);

		return (
			<TrueSheet
				ref={sheetRef}
				detents={sheetDetents}
				grabber={!GATES_SHEET_DRAG}
				// #1126 横スワイプ中はシートを掴ませない（縦へ引いた場合はカルーセルが fail するので true のまま）
				draggable={isSheetDraggable(detentIndex, GATES_SHEET_DRAG && isSwipingCarousel)}
				cornerRadius={24}
				backgroundColor={colors.surface}
				dismissible={false}
				dimmed={false}
				scrollable={detentIndex === 1}
				header={
					<View style={styles.header}>
						{/* #1126 ネイティブのグラバーは draggable の切り替えで点滅するため、Android では自前で描画する */}
						{GATES_SHEET_DRAG ? <View style={styles.grabber} /> : null}
						<Text style={styles.savedRestaurantsTitle}>{i18n.t("SelectRestaurant.savedRestaurantList")}</Text>
						{/* #1375 実機確認: このシートに出るのは «保存済みの店» だけなので、
						    保存していない店を選ぶ道が無いように見えていた。実際は上の検索に店名を打つか
						    地図の店アイコンを押せば選べる。その 2 本を、常に見えるところに書いておく */}
						<Text style={styles.headerHint} testID="saved-restaurants-sheet-unsaved-hint">
							{i18n.t("SelectRestaurant.unsavedHint")}
						</Text>
					</View>
				}
				onDetentChange={handleDetentChange}>
				{/* #1126 ⚠️ ここを素の View へ戻さないこと。Android の TrueSheet は中身を
				    android.R.id.content へ付け替えるため、アプリの GestureHandlerRootView の外へ出る。
				    RNGH のジェスチャ（カルーセルの Pan）が一切届かなくなり、
				    「ドラッグしても動かないが、離すとカードが押される」という形で壊れる。
				    詳細は components/SheetGestureRoot.tsx */}
				<SheetGestureRoot
					testID="saved-restaurants-sheet"
					style={[styles.container, detentIndex === 1 ? { flex: 1 } : {}]}>
					{/* #644 【UX】ローディング中はスケルトンを表示 */}
					{isLoadingSavedRestaurants && savedRestaurants.length === 0 ? (
						<>
							{detentIndex === 0 ? (
								// カルーセル表示時のスケルトン（2-3件）
								<View style={[styles.carouselWrapper, widthMetrics.carouselWrapper]}>
									<View style={[styles.savedRestaurantItemContainer, widthMetrics.savedRestaurantItemContainer]}>
										<SkeletonCard />
									</View>
								</View>
							) : (
								// リスト表示時のスケルトン（3-5件）
								<View style={styles.listContent}>
									{[1, 2, 3, 4, 5].map((key) => (
										<View key={key} style={[styles.listItemContainer, widthMetrics.listItemContainer]}>
											<SkeletonCard />
										</View>
									))}
								</View>
							)}
						</>
					) : savedRestaurants.length > 0 ? (
						<>
							{detentIndex === 0 ? (
								<View style={[styles.carouselWrapper, widthMetrics.carouselWrapper]}>
									{/* #1156 carousel v5: width/height は style へ、mode/modeConfig は layout へ、
									    pagingEnabled/snapEnabled/maxScrollDistancePerSwipe は snapMode へ集約された。 */}
									<Carousel<SavedRestaurant>
										ref={carouselRef}
										data={savedRestaurants}
										loop={false}
										style={[
											styles.carousel,
											widthMetrics.carousel,
											{ width: widthMetrics.contentWidth, height: CARD_HEIGHT + 24 },
										]}
										// #1194 【回帰修正】1 スワイプで 1 枚だけ送る。
										//
										// v4 の `pagingEnabled` は既定 true（＝1 枚送り）だったが、#1156 の v4→v5 移行で
										// `snapMode="nearest"` になった。`nearest` は**慣性が減衰し切った位置の最寄り**へ
										// 吸着するため、ゆっくりした横スワイプでも数枚まとめて飛ぶ。
										// 実機フィードバックで「遅い横スワイプでも一気に飛ぶ。一件一件が標準」と指摘された。
										//
										// `"page"` は 1 スワイプ＝1 ページに制限するので、v4 の挙動へ戻る。
										// `"none"` にすると吸着自体が消えてカードが半端な位置で止まるので使わない。
										snapMode="page"
										layout={{
											type: "parallax",
											scale: 1,
											adjacentScale: 1,
											offset: ((widthMetrics.contentWidth - widthMetrics.cardWidth) * 3) / 4,
										}}
										// #1126 横方向専用の Pan にして、縦ジェスチャ（シートの展開）と排他にする。
										// v5 でも onConfigurePanGesture は残っており、渡されるのは RNGH の PanGesture を
										// 包んだ CarouselPanGesture（activeOffsetX / failOffsetY はそのまま使える）
										onConfigurePanGesture={configureCarouselPanGesture}
										onScrollStart={beginCarouselSwipe}
										// #1156 carousel v5 は onScrollEnd を廃止した。#1126 のシートドラッグ抑止は
										// 「onSnapToItem」「beginCarouselSwipe が張るタイムアウト」「detent 変化」の
										// 3 経路で必ず解除される（endCarouselSwipe を共有）。
										// ⚠️ ここをインライン関数へ戻さないこと。onSnapToItem の関数 ID は
										// carousel 内部で Pan ジェスチャの依存へ伝播するため、横スワイプ中の
										// 再レンダー（isSwipingCarousel の更新）で進行中のスワイプが切れる
										onSnapToItem={handleSnapToItem}
										// #1156 carousel v5: scrollAnimationDuration は animation へ集約された
										animation={{ type: "timing", duration: 350 }}
										renderItem={renderItem}
									/>
								</View>
							) : (
								// TrueSheet のドラッグ（パン）ジェスチャが勝ってしまって、FlatList のスクロールが途中で奪われるため、
								// ScrollView を利用する。保存店が limit:20 なので、パフォーマンス的にも問題ないはず。
								<ScrollView
									contentContainerStyle={styles.listContent}
									showsVerticalScrollIndicator={false}
									nestedScrollEnabled>
									{savedRestaurants.map((item) => (
										<View key={item.restaurant.id} style={[styles.listItemContainer, widthMetrics.listItemContainer]}>
											<PrimaryCard
												item={item}
												onPress={() => onRestaurantCardPress(item)}
												onReview={showReviewButton ? () => onRestaurantReviewPress(item) : undefined}
											/>
										</View>
									))}
									<View style={{ height: 60 }} />
								</ScrollView>
							)}
						</>
					) : (
						// 空状態（ローディング完了後、データなし）
						<>
							<Text style={styles.emptyStateText}>{i18n.t("SelectRestaurant.noSavedRestaurantsInArea")}</Text>
							<Text style={styles.emptyStateText}>{i18n.t("SelectRestaurant.unsavedHint")}</Text>
						</>
					)}
				</SheetGestureRoot>
			</TrueSheet>
		);
	},
);

function PrimaryCard({
	item,
	onPress,
	onReview,
}: {
	item: SavedRestaurant;
	onPress: () => void;
	onReview?: () => void;
}) {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	return (
		<TouchableOpacity style={styles.savedRestaurantCard} activeOpacity={0.7} onPress={onPress}>
			<Image
				source={{
					uri: item.restaurant.imageUrls?.md,
					cacheKey: getCacheKeyForImage(item.restaurant.imageUrls?.md),
				}}
				style={styles.savedRestaurantImage}
			/>
			<View style={styles.savedRestaurantInfo}>
				<Text style={styles.savedRestaurantName} numberOfLines={1} ellipsizeMode="tail">
					{item.restaurant.name}
				</Text>
				{onReview && (
					<PrimaryButton
						onPress={onReview}
						label={i18n.t("SelectRestaurant.postPhotoVideo")}
						colors={[colors.brand, colors.brand]}
						shadowColor={"transparent"}
						// ブランド色の塗りはライト / ダークで変わらないため、上の文字は固定の白でよい
						labelStyle={{ color: FixedColors.onFilled, fontSize: 12 }}
						style={{ alignSelf: "flex-end" }}
					/>
				)}
			</View>
		</TouchableOpacity>
	);
}

// #644 【UX】ローディングスケルトンカードコンポーネント
function SkeletonCard() {
	const styles = useThemedStyles(createStyles);
	return (
		<View style={styles.savedRestaurantCard}>
			{/* 画像エリア */}
			<SkeletonShimmer width={100} height={CARD_HEIGHT} style={styles.savedRestaurantImage} />
			{/* テキスト部分 */}
			<View style={styles.savedRestaurantInfo}>
				{/* 店名エリア（2行分） */}
				<View>
					<SkeletonShimmer width="80%" height={16} borderRadius={4} style={{ marginBottom: 8 }} />
					<SkeletonShimmer width="60%" height={16} borderRadius={4} />
				</View>
				{/* ボタンエリア */}
				<SkeletonShimmer width={120} height={32} borderRadius={8} style={{ alignSelf: "flex-end" }} />
			</View>
		</View>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			paddingTop: 12,
			paddingBottom: 20,
		},
		header: {
			paddingHorizontal: 16,
			marginVertical: 8,
		},
		// #1126 TrueSheet のネイティブグラバー（32x4dp / 角丸 / 黒 40% / シート上端から 16dp）の写し。
		// header の marginTop が 8 なので、top: 8 でシート上端から 16 になる。
		grabber: {
			position: "absolute",
			top: 8,
			alignSelf: "center",
			width: 32,
			height: 4,
			borderRadius: 2,
			backgroundColor: "rgba(0, 0, 0, 0.4)",
		},
		savedRestaurantsTitle: {
			fontSize: 14,
			fontWeight: "600",
			color: c.textMuted,
		},
		// 幅は useWidthMetrics で算出してスタイル配列で合成する（#1067）
		carouselWrapper: {
			alignItems: "center",
			paddingVertical: 4,
			alignSelf: "center",
		},
		carousel: {
			height: CARD_HEIGHT + 24,
		},
		savedRestaurantItemContainer: {
			height: CARD_HEIGHT,
			marginVertical: 12,
		},
		listContent: {
			position: "relative",
			top: 0,
			alignItems: "center",
			paddingVertical: 8,
			paddingBottom: 40,
		},
		listItemContainer: {
			marginBottom: 12,
		},
		savedRestaurantCard: {
			flex: 1,
			flexDirection: "row",
			backgroundColor: c.surface,
			borderRadius: 12,
			height: CARD_HEIGHT,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.2,
			shadowRadius: 8,
			elevation: 5,
		},
		savedRestaurantImage: {
			width: 100,
			height: CARD_HEIGHT,
			borderTopLeftRadius: 12,
			borderBottomLeftRadius: 12,
		},
		savedRestaurantInfo: {
			flex: 1,
			padding: 12,
			justifyContent: "space-between",
		},
		savedRestaurantName: {
			fontSize: 16,
			fontWeight: "600",
			color: c.textPrimary,
			marginBottom: 8,
		},
		headerHint: {
			fontSize: 12,
			color: c.textSecondary,
			lineHeight: 17,
			marginTop: 4,
		},
		emptyStateText: {
			fontSize: 14,
			color: c.textMuted,
			textAlign: "center",
			marginTop: 8,
			marginBottom: 16,
		},
	});
