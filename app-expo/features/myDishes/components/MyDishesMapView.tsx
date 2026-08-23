import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { RotateCw } from "lucide-react-native";
import MapViewClass from "react-native-maps";
import MapView, { type Region } from "@/components/MapView";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { AvatarBubbleMarker } from "@/features/mapMarkers";
import { INITIAL_REGION, REGION_JP } from "@/features/map/constants";
import { useHaptics } from "@/hooks/useHaptics";
import { router } from "expo-router";
import { useLocale } from "@/hooks/useLocale";
import { getCurrentLocationPosition } from "@/hooks/useCurrentLocationPosition";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import type { MyDishPin } from "@shared/api/v1/res";
import { MY_DISHES_EVENTS, buildMapAreaPayload } from "../analytics";
import { boundingRegionForCoordinates, regionToArea } from "../geo";
import { useMyDishesFilterStore } from "../stores/useMyDishesFilterStore";
import { useMyDishesMapPinsQuery } from "../hooks/useMyDishesMapPinsQuery";
import { useMyDishesFeedScopeStore } from "../stores/useMyDishesFeedScopeStore";
import { MyDishesMapSheet } from "./MyDishesMapSheet";

/**
 * #1396 my-dishes の Map ビュー（設計書 (2/2) §7 の PR4）。
 *
 * ## ⚠️ viewport（`Region`）を filter store に絶対に入れない（設計書 (2/2) §3-2）
 *
 * pan / zoom は毎フレーム発火する。`onRegionChangeComplete` は下の `currentRegionRef`
 * （`useRef`）へ書くだけで、**`useMyDishesFilterStore` には一切触れない**。
 * store（= `queryKey`）を書くのは「このエリアで再検索」ボタン押下時の `commitArea` だけ。
 * これは既存 `select-restaurant.tsx` の `currentRegion` ref の先例をそのまま踏襲している。
 *
 * ピンは一覧ビューと**同じ `queryKey`**（`useMyDishesMapPinsQuery` 内部）を使うので、
 * フィルタ変更は一覧・Map の両方に同時に効き、ビュー切替では取り直さない。
 *
 * ## #1397 ピンタップは «料理メディア Sheet» を開く（ルートにしない。設計 (2/2) §9-1）
 *
 * 選択中の店舗は下の `selectedPin`（このコンポーネントの内部 state）だけが持つ。
 *
 * - **ルートにしない。** push / pop で Map が再マウントされると、`hasFitPinsRef` の
 *   «一度きり» のフィットが二度目も走る（= 開閉のたびに viewport が飛ぶ）。
 * - **`useMyDishesFilterStore` に `restaurantId` を入れない**（設計 (2/2) §7-1）。
 *   共有フィルタへ店舗を混ぜた瞬間、Sheet を開いただけで一覧と Map まで 1 店舗に絞られる。
 *   Sheet が使うのは `useMyDishesRestaurantQuery` の **派生 queryKey** だけである。
 * - ピンタップで全画面 Feed へ直行することはできない（`MyDishPin` が `dish_media.id` を
 *   1 つも持たないため。設計 (1/2) §0-1 / リーダー判断 Q1）。**常に Sheet を開く**。
 */
export function MyDishesMapView() {
	const { isJapanese, locale } = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const commitArea = useMyDishesFilterStore((s) => s.commitArea);
	const { pins, isLoading, error, hasFetchedInitial, truncated, refresh } = useMyDishesMapPinsQuery();

	const initialRegion = useMemo<Region>(() => (isJapanese ? REGION_JP : INITIAL_REGION), [isJapanese]);

	const mapRef = useRef<MapViewClass>(null);
	// #1396 【設計】生の viewport はここにだけ置く。store には絶対に書かない（§3-2）
	const currentRegionRef = useRef<Region>(initialRegion);
	// #1375 実機確認（2 巡目）: 「ズームインしてから…」の注意文とボタン無効化は廃止した。
	// 広すぎる表示域では `regionToArea` が MAX_AREA_RADIUS_M（50km）へ黙って丸める。
	// 「押せない理由を説明する」より「押したら常識的な範囲で動く」方が短い
	const handleRegionChangeComplete = useCallback((region: Region) => {
		currentRegionRef.current = region;
	}, []);

	// #1396 【設計】store（= queryKey）を書く唯一の口。ボタン押下時にのみ呼ばれる
	const handleSearchThisArea = useCallback(() => {
		lightImpact();
		const nextArea = regionToArea(currentRegionRef.current);
		if (!nextArea) return;
		commitArea(nextArea);
		// #1403 (PR2) 絞り込み自体は `nextArea` の生値で行い、**ログに載せる座標だけ丸める**。
		// 生の緯度経度は「どのあたりを見ていたか」ではなく「どこに居たか」になりうるので、
		// `frontend_event_logs` へはエリアの粒度（約 110m）まで落として入れる（analytics.ts）
		logFrontendEvent({
			event_name: MY_DISHES_EVENTS.mapSearchThisArea,
			error_level: "log",
			payload: buildMapAreaPayload(nextArea),
		});
	}, [commitArea, lightImpact, logFrontendEvent]);

	// #1396 M-3: web は `initialRegion`（uncontrolled）を読まないため、`onMapReady` 後に
	// `animateToRegion` で明示的に補正する（先例: select-restaurant.tsx の `pendingRegionRef`）。
	const [mapReady, setMapReady] = useState(false);
	const pendingRegionRef = useRef<Region | null>(initialRegion);
	const handleMapReady = useCallback(() => setMapReady(true), []);
	useEffect(() => {
		if (!mapReady) return;
		const region = pendingRegionRef.current;
		if (!region) return;
		mapRef.current?.animateToRegion(region, 1);
		pendingRegionRef.current = null;
	}, [mapReady]);

	// #1375 独立レビュー（仕様ギャップ G2）: 仕様 §7「位置情報が利用可能なら **現在地周辺**を初期表示」。
	// 実装は «ロケール依存の固定領域 → 初回取得後にピンの外接矩形» しか無く、保存が全国に
	// 散っていると日本全体まで引かれて「渋谷で何食べよう？」が 1 タップで始まらなかった。
	//
	// ⚠️ 権限ダイアログをこの画面から出すが、**拒否・失敗は静かに縮退**する（従来の挙動へ戻すだけ）。
	// store は書かない（= 再取得を起こさない）。viewport を動かすだけなのは «このエリアで再検索» と同じ契約
	//
	// ⚠️ 判定が決着するまで «ピンの外接矩形» を走らせない。先に矩形へ寄せてから現在地へ飛ぶと
	// 画面が 2 回動いて見える（自分で足したテストで気づいた）
	const [locationProbe, setLocationProbe] = useState<"pending" | "resolved" | "unavailable">("pending");
	const hasRequestedLocationRef = useRef(false);
	useEffect(() => {
		if (hasRequestedLocationRef.current) return;
		hasRequestedLocationRef.current = true;
		let cancelled = false;
		getCurrentLocationPosition()
			.then(({ latitude, longitude }) => {
				if (cancelled) return;
				const region: Region = { latitude, longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 };
				currentRegionRef.current = region;
				pendingRegionRef.current = region;
				mapRef.current?.animateToRegion(region, 500);
				setLocationProbe("resolved");
			})
			.catch(() => {
				// 権限拒否 / タイムアウト: 既存のフォールバック（固定領域 → ピン外接矩形）へ委ねる
				if (!cancelled) setLocationProbe("unavailable");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// #1396 m-1: エリア未確定だと全世界のピンが返るため、初回取得後に一度だけピンの外接矩形へ寄せる。
	// ⚠️ store は書かない・再取得も起こさない・二度目以降の取得では発火しない（ref で一度きりに固定する）
	const hasFitPinsRef = useRef(false);
	useEffect(() => {
		if (hasFitPinsRef.current) return;
		// #1375 G2: 現在地の判定中は待つ。取れたなら現在地が優先なので、こちらは二度と走らせない
		if (locationProbe === "pending") return;
		if (locationProbe === "resolved") {
			hasFitPinsRef.current = true;
			return;
		}
		if (!hasFetchedInitial) return;
		hasFitPinsRef.current = true;
		const region = boundingRegionForCoordinates(
			pins.map((pin) => ({ latitude: pin.restaurant.latitude, longitude: pin.restaurant.longitude })),
		);
		if (!region) return;
		mapRef.current?.animateToRegion(region, 1000);
	}, [hasFetchedInitial, pins, locationProbe]);

	// #1375 実機確認: ピンを押したら **Dish Feed へ遷移**する。
	//
	// 以前はここで料理メディア Sheet（`MyDishesRestaurantSheet`）を開いていた。記録を
	// その場で見られる代わりに、Map の上に別の一覧が重なる形になっていた。
	// Feed へ push すれば、縦 = その店舗の記録 になり、閉じれば Map がそのまま残る。
	//
	// Sheet は «常設の下部シート»（下の `MyDishesMapSheet`）として役割を変えた。
	// そちらは「いま Map に出ているピン」を横に並べるもので、押すと同じく Feed へ行く。
	// ⚠️ `pins` は ref 経由で読む（独立レビュー指摘 High）。ハンドラを `pins` に依存させると、
	// ピンが届くたびに identity が変わり、マーカー最大 300 個へ新しい props が流れて
	// Android では 300 回のビットマップ再生成に繋がる
	const pinsRef = useRef(pins);
	useEffect(() => {
		pinsRef.current = pins;
	}, [pins]);

	const handlePinPress = useCallback(
		(pin: MyDishPin) => {
			lightImpact();
			logFrontendEvent({
				event_name: MY_DISHES_EVENTS.mapPinSelected,
				error_level: "log",
				payload: { restaurantId: pin.restaurant.id },
			});
			// 横スクロールで «前後の店舗» へ行けるよう、いま出ているピンの並びを置いてから push する。
			// 並びは viewport 依存なので filter store にも URL にも入れない（§3-2 / #1397）
			useMyDishesFeedScopeStore.getState().setRestaurantIds(pinsRef.current.map((p) => p.restaurant.id));
			router.push({
				pathname: "/[locale]/(tabs)/my-dishes/feed",
				params: { locale, scope: "restaurant", restaurantId: pin.restaurant.id },
			});
		},
		[lightImpact, locale, logFrontendEvent],
	);

	const handleSheetSwipeUp = useCallback(() => {
		const first = pinsRef.current[0];
		if (first) handlePinPress(first);
	}, [handlePinPress]);

	// マーカー配列は memo で固定する。`pins` が同じ参照である限り、activeIndex 等の
	// 無関係な state 更新で 300 個のマーカーへ props が流れない
	const markers = useMemo(
		() =>
			pins.map((pin) => (
				<AvatarBubbleMarker
					key={pin.restaurant.id}
					testID="my-dishes-map-pin"
					coordinate={{ latitude: pin.restaurant.latitude, longitude: pin.restaurant.longitude }}
					onPress={() => handlePinPress(pin)}
					// #1398 PR5 写真なし（representativeThumbnailUrl === null）でも灰色プレースホルダーに
					// しない（#1375 追補2 決定3）。`MyDishPin` はピン＝店舗単位で `dish` を持たないため、
					// list / calendar と違い `categoryImageUrl` の段は無く `restaurant.image_url` へ直接
					// 落ちる（設計書 (2/2) §5-2 で確定。GET .../map-pins のレスポンスは変えない）
					uri={pin.representativeThumbnailUrl ?? pin.restaurant.image_url ?? undefined}
				/>
			)),
		[handlePinPress, pins],
	);

	const showInitialLoading = isLoading && !hasFetchedInitial && !error;
	// #1396 M-1: 取得失敗時（hasFetchedInitial === false のまま）でも EmptyState を出し、
	// 再試行の口（refresh）へ UI から到達できるようにする。一覧ビュー（GridList の
	// ListEmptyComponent）と同じく hasFetchedInitial の成否に関わらず error を優先する。
	const showEmpty = !isLoading && (error !== null || (hasFetchedInitial && pins.length === 0));
	// #1396 n-1: 初回失敗後の再取得（hasFetchedInitial === false）でもボタンのスピナーを出す
	const showButtonLoading = isLoading && (hasFetchedInitial || error !== null);

	return (
		<View style={styles.container} testID="my-dishes-map">
			<MapView
				ref={mapRef}
				style={styles.map}
				initialRegion={initialRegion}
				onMapReady={handleMapReady}
				onRegionChangeComplete={handleRegionChangeComplete}>
				{markers}
			</MapView>

			{showInitialLoading && (
				<View style={styles.loadingOverlay} pointerEvents="none">
					<LoadingIndicator size="large" />
				</View>
			)}

			<View style={styles.topOverlay} pointerEvents="box-none">
				<View style={styles.searchButtonContainer}>
					<PrimaryButton
						testID="my-dishes-search-this-area"
						onPress={handleSearchThisArea}
						label={i18n.t("MyDishes.searchThisArea")}
						icon={<RotateCw size={16} color="#357AFF" />}
						colors={["#ffffff", "#ffffff"]}
						shadowColor="transparent"
						labelStyle={{ color: "#357AFF", fontSize: 14 }}
						loading={showButtonLoading}
						loadingIndicatorType="native"
						nativeLoadingColor="#357AFF"
					/>
				</View>
				{/* #1375 実機確認: 「このエリアで絞り込み中」の帯は廃止した。
				    Map ではエリア＝いま見えている viewport そのもので、地図を動かせば
				    「このエリアで再検索」ボタンがそのまま «いまの範囲で引き直す» 導線になる。
				    見えているものを文字で言い直すだけの帯は、地図を隠すぶんだけ損である。
				    エリアが効いていることの表示と解除は、フィルタ画面（MyDishes.filters.area）に集約した */}
				{truncated && (
					<View style={styles.truncatedBanner} testID="my-dishes-map-truncated">
						<Text style={styles.truncatedText}>{i18n.t("MyDishes.map.truncated")}</Text>
					</View>
				)}
			</View>

			{showEmpty && (
				<View style={styles.emptyOverlay} pointerEvents={error ? "auto" : "none"} testID="my-dishes-map-empty-overlay">
					<EmptyState
						message={i18n.t("MyDishes.empty.description")}
						error={error}
						onRetry={refresh}
						testID="my-dishes-map-empty"
					/>
				</View>
			)}

			{/* #1375 実機確認: Map 下部の常設シート。いま出ているピンを横に並べ、押すと Feed へ行く。
			    データは `useMyDishesMapPinsQuery` が返すピンをそのまま使う（新しい API は増やさない） */}
			{/* #1375 実機確認（2 巡目）: 帯を上へ引き上げたら、先頭のピンから Feed を開く
			    （タイルを押したときと同じ経路。並びも同じものを置く） */}
			<MyDishesMapSheet
				pins={pins}
				onSelectPin={handlePinPress}
				onSwipeUp={pins.length > 0 ? handleSheetSwipeUp : undefined}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	map: {
		flex: 1,
	},
	loadingOverlay: {
		...StyleSheet.absoluteFillObject,
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "rgba(255, 255, 255, 0.5)",
	},
	topOverlay: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		zIndex: 100,
	},
	searchButtonContainer: {
		marginTop: 12,
		alignItems: "center",
	},
	truncatedBanner: {
		marginTop: 8,
		marginHorizontal: 24,
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 8,
		backgroundColor: "rgba(17, 24, 39, 0.85)",
	},
	truncatedText: {
		fontSize: 12,
		color: "#FFFFFF",
		textAlign: "center",
	},
	emptyOverlay: {
		position: "absolute",
		top: 80,
		left: 24,
		right: 24,
		bottom: 24,
	},
});
