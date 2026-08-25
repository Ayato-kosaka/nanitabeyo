/*
このファイルの責務
- Map ビューの下部に **常設**で出る料理メディアのシート（#1375 実機確認）。
- 「いま Map に出ているピン」＝そのエリアの自分の記録を横 1 列に並べ、押すと Dish Feed へ行く。

## 常設である理由

以前は「ピンを押すと開く」`MyDishesRestaurantSheet` だけがあり、下部に何も出ていなかった。
Issue が想定していたのは «地図を眺めながら、下の帯で記録を流し見できる» 形なので、
ピン選択に依存しない常設の帯にした。ピンを押したときは Feed へ遷移する（Map ビュー側）。

## 新しい API は増やさない

データは `useMyDishesMapPinsQuery` が既に返しているピン（`representativeThumbnailUrl` /
`restaurant`）をそのまま使う。ここで «そのエリアのメディア一覧» を別に引くと、
約 964MB の `dish_reviews` への問い合わせがもう 1 本増える。

## サムネイルが無いピンも落とさない

`representativeThumbnailUrl` が無いピン（写真なしの記録しかない店舗）も並べる。
落とすと「Map にピンはあるのに下の帯に居ない」というズレが出る。
画像が無いときは店舗の画像 → 何も無ければ店名だけのタイルへ落とす
（一覧・Calendar と同じ «灰色プレースホルダーにしない» 方針。#1375 追補2 決定3）。
*/
import React, { memo, useCallback, useMemo, useRef } from "react";
import { FlatList, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import { getCacheKeyForImage } from "@/lib/image";
import i18n from "@/lib/i18n";
import type { MyDishPin } from "@shared/api/v1/res";
import { MyDishStatusLegend } from "@/features/myDishes/components/MyDishStatusLegend";
import { MyDishStatusCountBadges } from "@/features/myDishes/components/MyDishStatusCountBadges";
import { DeletedMediaTombstone } from "@/components/DeletedMediaTombstone";

/** 1 枚あたりの幅。3 枚強が見える幅にして「横に続きがある」ことを見せる */
const TILE_WIDTH = 104;
/** タイルの間隔（`listContent` の `gap` と必ず同じ値にすること） */
const TILE_GAP = 8;

/**
 * タイルは固定幅なので、位置は計算で出せる。
 * 渡さないと 300 件ぶんのレイアウトを実測で積み上げることになる。
 */
const getTileLayout = (_data: ArrayLike<MyDishPin> | null | undefined, index: number) => ({
	length: TILE_WIDTH,
	offset: (TILE_WIDTH + TILE_GAP) * index,
	index,
});

const PinTile = memo(function PinTile({ pin, onPress }: { pin: MyDishPin; onPress: (pin: MyDishPin) => void }) {
	const styles = useThemedStyles(createStyles);
	const handlePress = useCallback(() => onPress(pin), [onPress, pin]);
	// #1513 «自分の投稿が削除済み» のピンは `restaurant.image_url` へも落とさない
	// （跡地に別の絵を入れない）。帯のタイルもピンと同じ墓標にする。ピン側の分岐は
	// `MyDishesMapView.tsx` の AvatarBubbleMarker にある
	const uri = pin.isOwnMediaDeleted ? null : (pin.representativeThumbnailUrl ?? pin.restaurant.image_url ?? null);

	return (
		<Pressable
			testID="my-dishes-map-sheet-tile"
			onPress={handlePress}
			style={styles.tile}
			accessibilityRole="button"
			accessibilityLabel={i18n.t("MyDishes.map.tileA11yLabel", {
				name: pin.restaurant.name,
				want: pin.counts.want,
				eaten: pin.counts.eaten,
			})}>
			<View style={styles.tileImage}>
				{pin.isOwnMediaDeleted ? (
					<DeletedMediaTombstone style={StyleSheet.absoluteFill} />
				) : uri ? (
					<Image
						source={{ uri, cacheKey: getCacheKeyForImage(uri) }}
						cachePolicy="memory-disk"
						transition={100}
						style={StyleSheet.absoluteFill}
						contentFit="cover"
						alt=""
						accessibilityElementsHidden
						importantForAccessibility="no"
					/>
				) : null}
				{/* #1375 実機確認（5 巡目）: その店に «食べたい» と «食べた» が何件あるかを
				    画像へ重ねて右下に出す。`pin.counts` は API が既に返している内訳なので
				    問い合わせは 1 本も増えない。0 件の側は描かない */}
				<View style={styles.countRow}>
					<MyDishStatusCountBadges counts={pin.counts} size="md" testIDPrefix="my-dishes-map-tile-count" />
				</View>
			</View>
			<Text style={styles.tileLabel} numberOfLines={2}>
				{pin.restaurant.name}
			</Text>
		</Pressable>
	);
});

export function MyDishesMapSheet({
	pins,
	onSelectPin,
	onSwipeUp,
}: {
	pins: MyDishPin[];
	onSelectPin: (pin: MyDishPin) => void;
	/** #1375 実機確認（2 巡目）: 帯を上へ引き上げたら Feed へ行く */
	onSwipeUp?: () => void;
}) {
	const styles = useThemedStyles(createStyles);
	const renderItem = useCallback(
		({ item }: { item: MyDishPin }) => <PinTile pin={item} onPress={onSelectPin} />,
		[onSelectPin],
	);

	// PanResponder は 1 度だけ作る（毎レンダー作り直すとジェスチャが途中で切れる）
	const onSwipeUpRef = useRef(onSwipeUp);
	onSwipeUpRef.current = onSwipeUp;
	const SWIPE_UP_DISTANCE = 48;
	const swipeUpGesture = useMemo(
		() =>
			PanResponder.create({
				// 上方向のドラッグだけを拾う。横はタイルの FlatList スクロールに渡す
				onMoveShouldSetPanResponder: (_event, gesture) =>
					gesture.dy < -8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
				onPanResponderRelease: (_event, gesture) => {
					if (gesture.dy < -SWIPE_UP_DISTANCE) onSwipeUpRef.current?.();
				},
			}),
		[],
	);

	// ピンが 0 件のときは帯ごと出さない。空の帯が地図を隠すだけになる
	if (pins.length === 0) return null;

	return (
		<View
			style={styles.container}
			testID="my-dishes-map-sheet"
			pointerEvents="box-none"
			{...swipeUpGesture.panHandlers}>
			<View style={styles.handle} />
			{/* #1375 実機確認（5 巡目）: 見出しは «レストランの件数»（ピン = 店舗 1 件）。
			    以前の「記録 N 件」は数えているものと言葉が食い違っていた */}
			<View style={styles.titleRow}>
				<Text style={styles.title}>{i18n.t("MyDishes.map.sheetTitle", { count: pins.length })}</Text>
				<MyDishStatusLegend testID="my-dishes-map-sheet-legend" />
			</View>
			<FlatList
				data={pins}
				keyExtractor={(pin) => pin.restaurant.id}
				renderItem={renderItem}
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={styles.listContent}
				// ピンは最大 300 件来る。画面に見えるのは数枚なので、マウントを絞らないと
				// Map と合わせて同じサムネイルを二重に一括取得してしまう（独立レビュー指摘）
				initialNumToRender={5}
				windowSize={3}
				/*
				#1375 **`removeClippedSubviews` は付けない。**
				横向きの FlatList では «スクロールするとタイルが白いまま戻らない» という
				既知の不具合があり（RN 自身が横向きでの使用を勧めていない）、
				節約できるぶんより «帯が真っ白» の方が損である。
				代わりに `getItemLayout` で 300 件ぶんのレイアウト計算を消す。
				*/
				getItemLayout={getTileLayout}
			/>
		</View>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			position: "absolute",
			left: 0,
			right: 0,
			bottom: 0,
			paddingTop: 8,
			paddingBottom: 12,
			backgroundColor: c.surface,
			borderTopLeftRadius: 16,
			borderTopRightRadius: 16,
			shadowColor: FixedColors.badgeBackground,
			shadowOffset: { width: 0, height: -2 },
			shadowOpacity: 0.12,
			shadowRadius: 8,
			elevation: 8,
		},
		handle: {
			alignSelf: "center",
			width: 36,
			height: 4,
			borderRadius: 2,
			backgroundColor: c.borderMuted,
		},
		titleRow: {
			marginTop: 8,
			marginHorizontal: 16,
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 8,
		},
		title: {
			fontSize: 13,
			fontWeight: "700",
			color: c.textSecondaryStrong,
			// 凡例に押し出されて見出しが消えないようにする（狭い端末・長い翻訳）
			flexShrink: 1,
		},
		countRow: {
			position: "absolute",
			right: 4,
			bottom: 4,
		},
		listContent: {
			paddingHorizontal: 16,
			paddingTop: 8,
			gap: TILE_GAP,
			// #1375（5 巡目・デザインレビュー #8）右下の FAB（＋、56pt + 右余白 16）が
			// 最後のタイルと店名を隠していた。タイルが FAB の下へ入らないよう右を空ける
			paddingRight: 88,
		},
		tile: {
			width: TILE_WIDTH,
		},
		tileImage: {
			width: TILE_WIDTH,
			height: TILE_WIDTH,
			borderRadius: 8,
			overflow: "hidden",
			backgroundColor: c.surfaceSubtle,
		},
		tileLabel: {
			marginTop: 4,
			fontSize: 11,
			color: c.textSecondaryStrong,
		},
	});
