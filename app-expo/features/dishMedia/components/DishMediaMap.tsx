import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { StyleSheet, View, Dimensions, Text } from "react-native";
import { Carousel } from "react-native-reanimated-carousel";
import MapView, { Region } from "@/components/MapView";
import DishMediaContent from "./DishMediaContent";
import { AvatarBubbleMarker } from "@/features/mapMarkers";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { generateUUID } from "@/lib/uuid";
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
	DishMediaEntriesStore,
	IdType,
	NormalizedDishMediaEntry,
	selectEntryByMediaId,
	selectEntryByReviewId,
	selectIdsByKey,
	useDishMediaEntriesStore,
} from "@/stores/useDishMediaEntriesStore";
import { shallow } from "zustand/shallow";
import i18n from "@/lib/i18n";
import { useActionSheet } from "@expo/react-native-action-sheet";
import { useDishMediaActions } from "../hooks/useDishMediaActions";
import { PrimaryButton } from "@/components/PrimaryButton";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useDishMediaBackgroundImageResources } from "@/features/dishMedia/hooks/useDishMediaBackgroundImageResources";
import { computePreloadIds } from "@/features/dishMedia/preloadWindow";
import { useContentWidth } from "@/hooks/useContentWidth";
import { useSheetBottomPadding } from "@/hooks/useSheetBottomPadding";
import { FixedColors } from "@/constants/Palette";

// #958 【修正】カルーセルの幅は window 実幅ではなく中央カラム幅に追従させる必要があるため、
// コンポーネント内の useContentWidth() を使う(下の contentWidth)。height はカルーセルの
// 高さ比率計算にのみ使い、横レイアウトには影響しないため据え置き
const { height } = Dimensions.get("window");

// #605 【設計】Carousel の展開/縮小比率（画面高さに対する割合）
const EXPANDED_RATIO = 0.8;
const COLLAPSED_RATIO = 0.4;
const CAROUSEL_HEIGHT = height * EXPANDED_RATIO;
// parallaxScrollingScale
const PARALLAX_SCALE = 0.85;
// #605 【設計】ハンドル高さ（ドラッグ可能領域）
const HANDLE_HEIGHT = 44;
// #605 【設計】スナップ判定の閾値（0.5 = 中間点）
const SNAP_THRESHOLD = 0.5;
// #605 【設計】ハンドルの色（半透明白）
// #1509 元表記は 8 桁 HEX "#FFFFFFFF"（alpha FF = 不透明）。FixedColors.onMedia（6 桁 #FFFFFF）と描画は完全に同一
const HANDLE_COLOR = FixedColors.onMedia;
// #638 【設計】フローティングボタンのマージン（右端からの距離）
const FLOATING_BUTTON_MARGIN = 8;

/*
#1729 【設計】**件数が 2 以下のときは loop しない。**

オーナー実機報告（2026-08-31・お店提案で検索結果が 1 件のとき）:

> 検索結果が一件しかないときカルーセルを同じ dish media でぐるぐるさせる必要はない。
> 動画にしたことで音がおかしくなるバグの温床。

`react-native-reanimated-carousel` は `loop` かつ `autoFillData`（既定 true）のとき、
**data を複製して 3 枚（1 件）/ 4 枚（2 件）に水増しする**
（`utils/computed-with-auto-fill-data.ts` の `computedFillDataWithAutoFillData`）。
さらに `renderItem` へ渡る `index` は水増し前へ畳み戻される
（同ファイル `computedRealIndexWithAutoFillData` = `index % rawDataLength`）。

つまり **1 件のときは 3 枚のセルが全部 `index === 0` で描かれる**。このセルの
`isActive` は `index === currentIndex` なので、同じ dish media の
`VideoPlayer` / `ExternalEmbedPlayer` が **同時に 3 つ再生状態になり、音が重なる**。
2 件でも同じ形で 2 つ重なる（`index % 2` が 2 セルずつ当たる）。

複製が起きない件数（3 件以上）でだけ loop する。1〜2 件はそのまま端で止まる。
*/
const MIN_LOOPABLE_COUNT = 3;

interface DishMediaMapProps {
	initialIndex?: number;
	onIndexChange?: (index: number) => void;
	initialLocation?: {
		latitude: number;
		longitude: number;
	};
	getTitle?: (item: NormalizedDishMediaEntry) => string | null;
	// 呼び出し元コンテキスト（画面用途キー）
	entriesKey: string;
	// ID の種類（dish_media / dish_reviews）
	idType: IdType;
}

export default function DishMediaMap({
	initialIndex = 0,
	onIndexChange,
	initialLocation,
	getTitle,
	entriesKey,
	idType,
}: DishMediaMapProps) {
	// #958 【修正】web の中央カラム内では window 実幅でカルーセルを描画するとカードが
	// カラムからはみ出すため、カラム幅(native では画面幅)を基準にする
	const contentWidth = useContentWidth();

	const selector = useCallback(
		(state: DishMediaEntriesStore) => selectIdsByKey(entriesKey, idType)(state),
		[entriesKey, idType],
	);
	const { ids: liveIds, isLoading, error } = useDishMediaEntriesStore(selector, shallow);

	// 画面を開いた時点の並びを固定するための state
	// liked/unlike 等のリアルタイム反映は行わない
	const [ids, setIds] = useState<string[]>(() => liveIds);
	// #1629【35】固定した並びから «削除されたもの» だけ落とす。
	// 理由と «liveIds を判定に使わない» 理由は `DishMediaFeed.tsx` の同じ箇所に書いてある
	const deletedIds = useDishMediaEntriesStore((state) => state.deletedIds);
	// #1629【40】背景画像のセッションを «並びの文字列» で作らない理由は
	// `DishMediaFeed.tsx` の同じ箇所（`idsSession`）に書いてある。両画面で同じ規則にする
	const [idsSession, setIdsSession] = useState(0);
	useEffect(() => {
		if (ids.length === 0) {
			if (liveIds.length > 0) {
				setIds(liveIds);
				setIdsSession((session) => session + 1);
			}
			return;
		}
		if (!ids.some((id) => deletedIds[id])) return;
		setIds((prev) => prev.filter((id) => !deletedIds[id]));
	}, [liveIds, ids, deletedIds]);
	/*
	#1743 【設計】**ピンの絵は «そのカードのサムネイル» から取る。店の写真は落とし先。**

	オーナー実機報告（2026-08-31・お店提案）:

	> お店提案でマップに出てくるピンの画像が、サムネの画像が反映されていない

	`restaurant.imageUrls` は **`restaurants.image_path` を持つ行にだけ付く**
	（`api/src/v1/restaurants/restaurants.assembler.ts` が `if (restaurants.image_path)` で分岐）。
	写真が無い Google Place・#843 のカタログ同期由来の行・`image_url` しか持たない行
	（#1680 の実測で 102 行）は `imageUrls` が `undefined` になり、
	`AvatarBubbleMarker` は **中身が空の白い丸**を描く。

	一方カルーセルのカードは `dish_media.thumbnailImageUrl` を描いており、こちらは
	外部埋め込みでも料理カテゴリの絵まで受け皿が用意されている（`dish-media.assembler.ts`）。
	**ピンとカードは 1 対 1 に対応しているのだから、ピンにも同じ絵を出すのが正しい。**
	my-dishes の Map は既に同じ規則（`representativeThumbnailUrl` → 店の写真）で描いている
	（`MyDishesMapView.tsx`）。ここだけが店の写真しか見ていなかった。
	*/
	const restaurants = useMemo(() => {
		if (ids.length === 0) return [];
		const state = useDishMediaEntriesStore.getState(); // ← subscribe しない snapshot 読み
		return ids
			.map((id) => (idType === "dish_media" ? selectEntryByMediaId(id)(state) : selectEntryByReviewId(id)(state)))
			.filter((entry): entry is NonNullable<typeof entry> => !!entry?.restaurant)
			.map((entry) => ({
				/*
				#1743 ピンの key は **カード（entry）ごと**に採る。

				以前は `google_place_id` を key にしていた。検索結果は 1 店 1 件
				（`unique_per_restaurant`）なので衝突しないが、この Map は投稿詳細
				（`posts.tsx`）とプロフィールの検索結果（`profile/search-results.tsx`）でも
				使われ、そちらは **同じ店の投稿が複数並びうる**。key が重複すると React は
				片方を捨て、カードの枚数とピンの数がずれる（`index` で対応付けている
				ハイライトとタップ先も 1 つずつずれる）。
				*/
				key: entry.dish_media.id,
				id: entry.restaurant.id,
				name: entry.restaurant.name,
				coordinate: { latitude: entry.restaurant.latitude, longitude: entry.restaurant.longitude },
				// 空文字は `<Image>` へ渡すと «壊れた画像» になるので `||` で次の候補へ畳む
				pinImageUrl: entry.dish_media.thumbnailImageUrl || entry.restaurant.imageUrls?.sm || undefined,
				google_place_id: entry.restaurant.google_place_id,
			}));
	}, [ids, idType]);

	// #802 【責務分離】Map は ids とレイアウト/Carousel 制御だけを担い、背景画像 preload の最小購読は hook に閉じる。
	// #1629【40】⚠️ ここへ `ids.join(",")` を戻さないこと（`DishMediaFeed.tsx` の設計コメント）
	const backgroundImagesSessionKey = useMemo(
		() => `${entriesKey}::${idType}::${idsSession}`,
		[entriesKey, idType, idsSession],
	);
	const [currentIndex, setCurrentIndex] = useState(initialIndex);

	/*
	#1375（全画面のクラッシュ棚卸し）**preload は «見えている周辺» だけ。**

	以前は ids 全件を同時に `Image.loadAsync` していた。全画面サイズのビットマップを
	一斉にデコードするので、開いた瞬間にメモリが跳ね、Android の低メモリ端末で落ちる。
	`DishMediaFeed` は同じ理由で既に窓化してあり（そちらのコメント参照）、
	**この検索結果カルーセルだけが全件のまま残っていた。** 窓の外は表示時に通常経路で読まれる。
	*/
	/*
	#1629【30】⚠️ **お店提案（`search/result.tsx`）が使っているのはこの Map であって Feed ではない。**

	オーナー実機報告（2026-08-27）:

	> このお店提案は 5 件しか表示されないんで、今の状態だとチカチカするんですよね。
	> 今までこのお店提案はそんな性能が悪かったことないんで、そういう先読みは
	> あえて入れてないんですよ。むしろチカチカして見にくい。

	これを受けて `DishMediaFeed` 側だけを直し「直った」と報告したが、**お店提案は
	この `DishMediaMap` を描いている**（`search/result.tsx:203`。コメントの
	「店舗5件のローディング画面」がその画面）。直した先が違ったので、実機では
	何も変わっていなかった（2026-08-28 にオーナーから «まだチカチカする» と再指摘）。

	`useDishMediaBackgroundImageResources` は集合から外れた画像を release するので、
	窓が動くたびに «取得 → 破棄 → 取得» が繰り返される。件数が窓より少し多いだけの
	画面（お店提案は 5 件）ではこれが毎回起きる。**判断のロジックは Feed と同じ
	`computePreloadIds` に一本化する**（しきい値を 2 箇所に散らすと、また片方だけ直す）。
	*/
	const preloadIds = useMemo(() => computePreloadIds(ids, currentIndex), [ids, currentIndex]);
	const { getBackgroundImageState } = useDishMediaBackgroundImageResources({
		ids: preloadIds,
		idType,
		sessionKey: backgroundImagesSessionKey,
	});

	const carouselRef = useRef<any>(null);
	const mapRef = useRef<any>(null);
	const { selectionChanged } = useHaptics();
	const { logFrontendEvent } = useLogger();

	// 一意なセッションID（DishMediaContent へ伝搬）
	const sessionId = useRef(generateUUID());

	// #605 【設計】Carousel の上下移動量（0 = Expanded, MAX_TRANSLATE_Y = Collapsed）
	const MAX_TRANSLATE_Y = height * (EXPANDED_RATIO - COLLAPSED_RATIO);
	const translateY = useSharedValue(MAX_TRANSLATE_Y);
	const gestureStartY = useSharedValue(0);

	// #605 【設計】 初期表示時に展開状態にアニメーション
	useEffect(() => {
		// #605 TODO: withTiming に変更検討
		translateY.value = withSpring(0, {
			duration: 3000,
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// #605 【設計】ドラッグジェスチャーハンドラー（ハンドル領域でのみ有効）
	const panGesture = Gesture.Pan()
		.onStart(() => {
			gestureStartY.value = translateY.value;
		})
		.onUpdate((event) => {
			const newY = gestureStartY.value + event.translationY;
			// 0 〜 MAX_TRANSLATE_Y の範囲に制限
			translateY.value = Math.max(0, Math.min(newY, MAX_TRANSLATE_Y));
		})
		.onEnd((event) => {
			// #605 【設計】スナップ判定（中間点 or 速度ベース）
			const velocity = event.velocityY;
			const shouldCollapse =
				velocity > 500 || (Math.abs(velocity) < 500 && translateY.value > MAX_TRANSLATE_Y * SNAP_THRESHOLD);

			translateY.value = withSpring(shouldCollapse ? MAX_TRANSLATE_Y : 0, {
				damping: 20,
				stiffness: 200,
			});
		});

	// #605 【設計】Carousel コンテナのアニメーションスタイル
	const animatedCarouselStyle = useAnimatedStyle(() => ({
		transform: [{ translateY: translateY.value }],
	}));

	// マップの表示領域計算（全ピンが見えるように調整）
	const getMapRegion = useCallback((): Region => {
		if (restaurants.length === 0) {
			return {
				latitude: initialLocation?.latitude ?? 35.6762,
				longitude: initialLocation?.longitude ?? 139.6503,
				latitudeDelta: 0.01,
				longitudeDelta: 0.01,
			};
		}

		// マップのアスペクト比
		const aspectRatio = contentWidth / height;

		// 全ピンの最小・最大座標を取得
		const latitudes = restaurants.map((restaurant) => restaurant.coordinate.latitude);
		const longitudes = restaurants.map((restaurant) => restaurant.coordinate.longitude);

		const minLat = Math.min(...latitudes);
		const maxLat = Math.max(...latitudes);
		const minLng = Math.min(...longitudes);
		const maxLng = Math.max(...longitudes);

		// ピン群の中心
		const centerLat = (minLat + maxLat) / 2;
		const centerLng = (minLng + maxLng) / 2;

		// Δ計算（安全マージン込み）
		let latDelta = Math.max((maxLat - minLat) * 1.5, 0.01) * 1.2; // 20% 余裕
		let lngDelta = Math.max((maxLng - minLng) * 1.5, 0.01) * 1.2;

		// 上1/5にピン群を表示するためのオフセット計算
		// 通常は centerLat が画面中央になる → ピン群の下に 4/5 スペースが欲しい
		const verticalSpaceRatio = 0.5; // 下に 30% の余白を持たせる
		const verticalOffset = latDelta * verticalSpaceRatio;
		return {
			latitude: centerLat - verticalOffset,
			longitude: centerLng,
			latitudeDelta: latDelta,
			longitudeDelta: lngDelta,
		};
	}, [restaurants, initialLocation, contentWidth]);
	const region = useMemo(() => getMapRegion(), [getMapRegion]);

	useEffect(() => {
		// 初期位置設定
		if (mapRef.current && restaurants.length > 0) {
			mapRef.current.animateToRegion(getMapRegion(), 1000);
		}
	}, [getMapRegion, restaurants]);

	const handleIndexChange = useCallback(
		(index: number) => {
			selectionChanged();
			// ログ追加【仕様】dish_media_swiped_next ログ送信（前のインデックスと異なる場合のみ）
			if (
				index !== currentIndex &&
				index >= 0 &&
				index < ids.length &&
				currentIndex >= 0 &&
				currentIndex < ids.length
			) {
				const state = useDishMediaEntriesStore.getState();
				const previousEntry =
					idType === "dish_media"
						? selectEntryByMediaId(ids[currentIndex])(state)
						: selectEntryByReviewId(ids[currentIndex])(state);
				const newEntry =
					idType === "dish_media" ? selectEntryByMediaId(ids[index])(state) : selectEntryByReviewId(ids[index])(state);

				logFrontendEvent({
					event_name: "dish_media_swiped_next",
					error_level: "log",
					payload: {
						previous_index: currentIndex,
						new_index: index,
						previous_dish_media_id: previousEntry?.dish_media.id ?? null,
						new_dish_media_id: newEntry?.dish_media.id ?? null,
					},
				});
			}
			setCurrentIndex(index);
			onIndexChange?.(index);
		},
		[onIndexChange, selectionChanged, currentIndex, ids, idType, logFrontendEvent],
	);

	const handleMarkerPress = useCallback((index: number) => {
		carouselRef.current?.scrollTo({ index, animated: true });
	}, []);

	// #613 【設計】カード押下時に ActionSheet を開く処理（DishMediaContent から entry を受け取る）
	const { showActionSheetWithOptions } = useActionSheet();
	/*
	#1742 【設計】Android の ActionSheet は `@expo/react-native-action-sheet` の JS 実装
	（`CustomActionSheet`）で、`position: "absolute"` の `bottom: 0` に貼るだけで safe area を見ない。
	edge-to-edge の Android では最下行（キャンセル）がナビゲーションバーへ潜るため、
	**外から `containerStyle` で下余白を足す以外に手が無い**（ライブラリに inset の設定は無い）。

	`containerStyle` はシートの白い器（ActionGroup の groupContainer）へ当たるので、
	背景はナビバーの裏まで伸びたまま、行だけがバーの上へ持ち上がる。
	iOS はネイティブの `ActionSheetIOS` を使う経路で `containerStyle` を見ないが、
	そちらは OS 側が safe area を持つので何もしなくてよい（web は inset が 0）。
	*/
	const actionSheetPaddingBottom = useSheetBottomPadding();
	const { openInGoogleMaps, shareRestaurant } = useDishMediaActions({
		source: "DishMediaMap",
	});
	const handleCardPress = useCallback(
		async (entry: NormalizedDishMediaEntry) => {
			const dishMediaId = entry.dish_media.id;
			const restaurant = entry.restaurant;

			const options = [
				i18n.t("ActionSheet.openInGoogleMaps"),
				i18n.t("ActionSheet.shareWithFriends"),
				i18n.t("ActionSheet.cancel"),
			];
			const cancelButtonIndex = 2;

			showActionSheetWithOptions(
				{
					title: i18n.t("ActionSheet.title"),
					options,
					cancelButtonIndex,
					containerStyle: { paddingBottom: actionSheetPaddingBottom },
				},
				async (selectedIndex?: number) => {
					if (selectedIndex === undefined || selectedIndex === cancelButtonIndex) return;

					switch (selectedIndex) {
						case 0: {
							// #613 【設計】Google マップで開く
							await openInGoogleMaps({
								dishMediaId,
								restaurant,
							});
							break;
						}
						case 1: {
							// #613 【設計】友人に共有する
							await shareRestaurant({
								dishMediaId,
								restaurant,
							});
							break;
						}
					}
				},
			);
		},
		[showActionSheetWithOptions, actionSheetPaddingBottom, openInGoogleMaps, shareRestaurant],
	);

	// #1729 件数が 2 以下だとライブラリがセルを複製し、同じ media が同時再生される（MIN_LOOPABLE_COUNT 参照）
	const canLoop = ids.length >= MIN_LOOPABLE_COUNT;

	const renderCarouselItem = useCallback(
		({ item, index }: { item: string; index: number }) => (
			<View style={styles.carouselItem}>
				{/* #940 【設計】1枚のカードの描画中例外(entry未取得等)で結果画面全体を巻き込まないよう、
				    カード単位で ErrorBoundary を設置する(アプリ全体の ErrorBoundary は最終防波堤として別途設置済み) */}
				<ErrorBoundary>
					<DishMediaContent
						id={item}
						carouselRef={carouselRef}
						isActive={index === currentIndex}
						// #1375（全画面のクラッシュ棚卸し）動画プレイヤーは «見えている ±1» だけ実体化する。
						// 既定は true なので、指定しないとカルーセルがマウントしたセルぶん
						// デコーダが同時に立つ（`DishMediaContent` の isNearActive の申し送り参照）。
						// `DishMediaFeed` は同じ理由で既に絞ってあり、ここだけ既定のままだった
						isNearActive={Math.abs(index - currentIndex) <= 1}
						getTitle={getTitle}
						sessionId={sessionId.current}
						entriesKey={entriesKey}
						idType={idType}
						onCardPress={handleCardPress} // #613 【設計】カード押下時のコールバックを渡す
						displayIndex={index}
						backgroundImageState={getBackgroundImageState(item)}
						// #1375 実機確認（3 巡目）: 検索動線のフィードに「食べたを記録」は出さない。
						// 探している段階で記録する人は居ない（オーナー判断）。記録の入口は
						// my-dishes（保存後の棚）と店舗フィード側にある
						showRecordEaten={false}
					/>
				</ErrorBoundary>
			</View>
		),
		[currentIndex, getTitle, entriesKey, idType, handleCardPress, getBackgroundImageState],
	);

	// #638 【設計】現在選択中のエントリーを取得
	const getCurrentEntry = useCallback(() => {
		if (ids.length === 0 || currentIndex >= ids.length) return null;
		const currentId = ids[currentIndex];
		const state = useDishMediaEntriesStore.getState();
		return idType === "dish_media" ? selectEntryByMediaId(currentId)(state) : selectEntryByReviewId(currentId)(state);
	}, [ids, currentIndex, idType]);

	// #638 【設計】フローティングボタン押下時に Google マップで開く
	const handleOpenInGoogleMaps = useCallback(async () => {
		const currentEntry = getCurrentEntry();
		if (!currentEntry) return;
		await openInGoogleMaps({
			dishMediaId: currentEntry.dish_media.id,
			restaurant: currentEntry.restaurant,
		});
	}, [getCurrentEntry, openInGoogleMaps]);

	return (
		<View style={styles.container}>
			{/* この位置に置かないとマップが起動しなくなる */}
			{isLoading && (
				<View style={styles.centerContainer}>
					<LoadingIndicator size="large" />
					<Text style={styles.loadingText}>{i18n.t("Profile.loading")}</Text>
				</View>
			)}

			{/* #940 【修正】centerContainer が通常のフローに置かれ zIndex も無かったため、
			    直後に絶対配置される mapContainer(zIndex:1) の下敷きになり実質見えなくなっていた。
			    最前面に絶対配置し、地図の下敷きにならないようにする */}
			{error && (
				<View style={styles.errorOverlay}>
					<Text style={styles.errorText}>{error}</Text>
				</View>
			)}

			{/* Map View - Top 1/5 of screen */}
			<View style={styles.mapContainer}>
				<MapView ref={mapRef} style={styles.map} initialRegion={region}>
					{restaurants.map((restaurant, index) => (
						<AvatarBubbleMarker
							key={`marker-${restaurant.key}`}
							coordinate={restaurant.coordinate}
							onPress={() => handleMarkerPress(index)}
							uri={restaurant.pinImageUrl}
							color={
								// 地図タイルは常にライト配色のため、ピンはテーマで振らない（FixedColors 参照）
								index === currentIndex ? FixedColors.brandOnMap : FixedColors.mapMarkerSurface
							}
							isActive={index === currentIndex}
						/>
					))}
				</MapView>
			</View>

			{/* #605 【設計】Carousel を Animated.View で包み、translateY で上下移動 */}
			<Animated.View style={[styles.carouselWrapper, animatedCarouselStyle]}>
				{/* #638 【設計】Google マップで開くフローティングボタン（カード上部に配置） */}
				<View style={styles.floatingButtonContainer} pointerEvents="box-none">
					<PrimaryButton
						label={i18n.t("Map.buttons.openInGoogle")}
						onPress={handleOpenInGoogleMaps}
						// 地図の上に浮くボタン。地図タイルが常にライト配色のため、テーマで振らない（FixedColors 参照）
						labelStyle={{ color: FixedColors.brandOnMap }}
						colors={[FixedColors.brandTintOnMap, FixedColors.brandTintOnMap]}
						shadowColor="transparent"
						borderRadius={8}
					/>
				</View>

				{/* #605 【設計】ドラッグハンドル（上端バー周辺のみドラッグ可能） */}
				<GestureDetector gesture={panGesture}>
					<View style={styles.handleContainer}>
						<View style={styles.handle} />
					</View>
				</GestureDetector>

				{/* Carousel - Bottom 4/5 of screen, overlapping map */}
				{/* #1156 carousel v5: width/height は style へ、mode/modeConfig は layout へ、
				    containerStyle は contentContainerStyle へ移行。loop の既定が false になったため明示する。 */}
				<Carousel
					ref={carouselRef}
					data={ids}
					renderItem={renderCarouselItem}
					onSnapToItem={handleIndexChange}
					defaultIndex={initialIndex}
					// #1729 データを複製されない件数でだけ loop する（この定数の宣言箇所に理由）
					loop={canLoop}
					layout={{
						type: "parallax",
						scale: PARALLAX_SCALE,
						offset: 75,
					}}
					style={[styles.carousel, { width: contentWidth, height: CAROUSEL_HEIGHT }]}
					contentContainerStyle={styles.carouselContainer}
				/>
			</Animated.View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: FixedColors.mediaBackground,
	},
	mapContainer: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		zIndex: 1,
	},
	map: {
		flex: 1,
	},
	// #605 【設計】Carousel 全体を包むラッパー（translateY でアニメーション）
	carouselWrapper: {
		position: "absolute",
		height: CAROUSEL_HEIGHT,
		left: 0,
		right: 0,
		bottom: -(CAROUSEL_HEIGHT * (1 - PARALLAX_SCALE)) / 2,
		zIndex: 2,
	},
	// #605 【設計】ドラッグハンドルコンテナ（タップ可能領域）
	handleContainer: {
		position: "absolute",
		top: (CAROUSEL_HEIGHT * (1 - PARALLAX_SCALE)) / 2,
		height: HANDLE_HEIGHT,
		width: "100%",
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "transparent",
		zIndex: 3,
	},
	// #605 【設計】ハンドル（短い横棒）
	handle: {
		width: 40,
		height: 5,
		borderRadius: 2.5,
		backgroundColor: HANDLE_COLOR,
		shadowColor: FixedColors.shadow,
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.55,
		shadowRadius: 3,
		elevation: 4,
	},
	// #638 【設計】フローティングボタンコンテナ（カード上部に配置）
	floatingButtonContainer: {
		position: "absolute",
		right: FLOATING_BUTTON_MARGIN,
		zIndex: 4,
	},
	carouselContainer: {
		height: CAROUSEL_HEIGHT,
		left: 0,
		right: 0,
	},
	carousel: {
		flex: 1,
	},
	carouselItem: {
		flex: 1,
		borderRadius: 24,
		overflow: "hidden",
		shadowColor: FixedColors.shadow,
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 32,
		elevation: 12,
	},
	centerContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: FixedColors.mediaBackground,
	},
	loadingText: {
		marginTop: 16,
		color: FixedColors.onMedia,
		fontSize: 16,
	},
	// #940 【修正】mapContainer(zIndex:1)より前面に絶対配置し、地図の下敷きにならないようにする
	errorOverlay: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		zIndex: 5,
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "rgba(0, 0, 0, 0.85)",
		paddingHorizontal: 20,
	},
	errorText: {
		color: FixedColors.errorOnMedia,
		fontSize: 16,
		textAlign: "center",
		paddingHorizontal: 20,
	},
});
