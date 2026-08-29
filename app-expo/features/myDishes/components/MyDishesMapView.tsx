import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Navigation, RotateCw } from "lucide-react-native";
import MapViewClass from "react-native-maps";
import MapView, { type Region } from "@/components/MapView";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { AvatarBubbleMarker } from "@/features/mapMarkers";
import {
	clusterMyDishPins,
	isSameClusterViewport,
	regionForCluster,
	type ClusterViewport,
	type MyDishPinCluster,
} from "../clustering";
import { INITIAL_REGION, REGION_JP } from "@/features/map/constants";
import { useHaptics } from "@/hooks/useHaptics";
import { router } from "expo-router";
import { useLocale } from "@/hooks/useLocale";
import { getCurrentLocationPosition } from "@/hooks/useCurrentLocationPosition";
import {
	getMyDishesViewportRegion,
	setMyDishesViewportRegion,
} from "@/features/myDishes/stores/useMyDishesViewportStore";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import type { MyDishPin } from "@shared/api/v1/res";
import { MY_DISHES_EVENTS, buildMapAreaPayload } from "../analytics";
import { regionToArea } from "../geo";
import { selectActiveFilterCount, useMyDishesFilterStore } from "../stores/useMyDishesFilterStore";
import { useMyDishesMapPinsQuery } from "../hooks/useMyDishesMapPinsQuery";
import { useMyDishesFeedScopeStore } from "../stores/useMyDishesFeedScopeStore";
import { MyDishesMapSheet } from "./MyDishesMapSheet";
import { DeletedMediaTombstone } from "@/components/DeletedMediaTombstone";
import { MyDishClusterMarker } from "./MyDishClusterMarker";

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
/**
 * @param enabled #1375（5 巡目・性能）取得を始めてよいか。
 *   3 ビューは keep-alive なので、**見えていないビューまで取り直しに行かない**ようにする
 *   （呼び出し元の `my-dishes/index.tsx` が「タブが前面 かつ このビューが選ばれている」を渡す）
 */
export function MyDishesMapView({ enabled = true }: { enabled?: boolean } = {}) {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { isJapanese, locale } = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const commitArea = useMyDishesFilterStore((s) => s.commitArea);
	// #1629【32】空状態の出し分けに使う。エリアが効いているか / 何か絞り込みが効いているか（下の showEmpty 参照）
	const hasAreaFilter = useMyDishesFilterStore((s) => s.filter.area !== null);
	const activeFilterCount = useMyDishesFilterStore(selectActiveFilterCount);
	const { pins, isLoading, error, hasFetchedInitial, truncated, refresh } = useMyDishesMapPinsQuery({ enabled });

	const initialRegion = useMemo<Region>(() => (isJapanese ? REGION_JP : INITIAL_REGION), [isJapanese]);

	const mapRef = useRef<MapViewClass>(null);
	// #1396 【設計】生の viewport はここにだけ置く。store には絶対に書かない（§3-2）
	const currentRegionRef = useRef<Region>(initialRegion);
	// #1375 実機確認（5 巡目）「クラスタリングはやってほしい」。
	// 近すぎて重なるピンを 1 つの丸へ畳む単位は **いま画面に映っている範囲**（clustering.ts）。
	// ⚠️ ここを `onRegionChangeComplete`（= 指を離した後）でしか更新しないこと。
	// pan に追従させると毎フレーム畳み直して重く、しかもピンが動いて見える。
	//
	// #1375（5 巡目・性能レビュー B-1）**持つのは倍率だけ**（中心は持たない）。
	// 畳む半径は delta の割合でしか決まらないので、pan（中心が動くだけ）ではクラスタは
	// 1 つも変わらない。それでも Region をそのまま state に入れていたため、
	// `onRegionChangeComplete` が寄こす新しいオブジェクトで参照が変わり、
	// **地図を少し動かすたびに最大 300 個のマーカーが作り直されていた**。
	//
	// #1375（実機: マップのクラッシュ）**中心も持つ。ただし «粗く» 持つ。**
	// 中心が無いと «いま見えている範囲か» を判定できず、東京を拡大していても
	// 北海道と福岡のピンまでマーカーとして作り続けることになる（それが落ちる原因の本体）。
	// 中心は delta の 25% 以上動いたときだけ更新するので、pan で毎回畳み直すことはない。
	const [clusterViewport, setClusterViewport] = useState<ClusterViewport>(() => ({
		latitude: initialRegion.latitude,
		longitude: initialRegion.longitude,
		latitudeDelta: initialRegion.latitudeDelta,
		longitudeDelta: initialRegion.longitudeDelta,
	}));
	// 畳み方にも間引きにも影響しない程度の変化なら、前の値（= 同じ参照）を返して memo を保つ
	const updateClusterScale = useCallback((region: Region) => {
		setClusterViewport((prev) =>
			isSameClusterViewport(prev, region)
				? prev
				: {
						latitude: region.latitude,
						longitude: region.longitude,
						latitudeDelta: region.latitudeDelta,
						longitudeDelta: region.longitudeDelta,
					},
		);
	}, []);
	// #1375 実機確認（2 巡目）: 「ズームインしてから…」の注意文とボタン無効化は廃止した。
	// 広すぎる表示域では `regionToArea` が MAX_AREA_RADIUS_M（50km）へ黙って丸める。
	// 「押せない理由を説明する」より「押したら常識的な範囲で動く」方が短い
	const handleRegionChangeComplete = useCallback(
		(region: Region) => {
			currentRegionRef.current = region;
			// #1375（5 巡目）人が動かした表示域を覚える。次にこの画面へ来たらここから始める
			// （取得には一切関与しない store。useMyDishesViewportStore のコメント参照）
			setMyDishesViewportRegion(region);
			// #1375（5 巡目）クラスタの粒度は «指を離したときの表示域» で決める。
			// pan の最中に畳み直すと重いうえ、ピンが動いて見える
			updateClusterScale(region);
		},
		[updateClusterScale],
	);

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
	// 覚えている表示域があるなら自動の初期化は全部やらない（人の操作が最優先）
	const restoredRegionRef = useRef<Region | null>(getMyDishesViewportRegion());
	const [locationProbe, setLocationProbe] = useState<"pending" | "resolved" | "unavailable">(
		restoredRegionRef.current === null ? "pending" : "resolved",
	);
	const hasRequestedLocationRef = useRef(false);
	useEffect(() => {
		if (restoredRegionRef.current !== null) {
			// 前回の表示域へ戻す（現在地取得もピンの外接矩形も走らせない）
			const region = restoredRegionRef.current;
			currentRegionRef.current = region;
			pendingRegionRef.current = region;
			mapRef.current?.animateToRegion(region, 1);
			return;
		}
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

	/*
	#1375（9 巡目・オーナー指示）**位置情報が取れないときは «日本全体» を出す。**

	それまでは «取得した全ピンの外接矩形» へ寄せていた。記録が国内に散っていると
	一気に引きの絵になり、しかも **取得が終わるまで動かない**ので «開いた直後に勝手に
	動く地図» になっていた。オーナーの指示は「初期は現在地周辺、位置情報拒否なら日本地図」。

	そこで、現在地が取れなかったときは **ピンを待たずに** 日本全体へ寄せる。
	外接矩形へ寄せる処理は無くした（引きの絵という点では日本全体と大差が無く、
	«いつ動くか分からない» という悪い性質だけが減る）。

	⚠️ 前回の表示域が残っているとき（`restoredRegionRef`）はそちらが最優先で、
	   ここは走らない（人が最後に見ていた場所を勝手に変えない）。
	*/
	const hasAppliedFallbackRegionRef = useRef(false);
	useEffect(() => {
		if (hasAppliedFallbackRegionRef.current) return;
		// 現在地の判定中は待つ。取れたなら現在地が優先なので、こちらは二度と走らせない
		if (locationProbe === "pending") return;
		hasAppliedFallbackRegionRef.current = true;
		if (locationProbe === "resolved") return;
		currentRegionRef.current = REGION_JP;
		pendingRegionRef.current = REGION_JP;
		updateClusterScale(REGION_JP);
		mapRef.current?.animateToRegion(REGION_JP, 500);
	}, [locationProbe, updateClusterScale]);

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
	/*
	#1375（9 巡目・オーナー指摘）**現在地ボタン。**

	初期表示は現在地に寄せているが、地図を動かしたあと戻る手段が無かった
	（«このエリアで再検索» は範囲を変えずに引き直すだけ）。

	動きは «クラスタを押したとき»（`handleClusterPress`）と同じ 4 点セットにする。
	どれか 1 つでも欠けると、地図と «いま見えている範囲» の認識がずれる:
	  1. `currentRegionRef` を更新（次の «このエリアで再検索» が拾う範囲）
	  2. `setMyDishesViewportRegion` へ保存（次に開いたときここへ戻す）
	  3. `updateClusterScale` でクラスタを畳み直す
	  4. 地図を動かす

	⚠️ 取れなかったときに何も言わないのは不親切だが、**権限の説明はここでは出さない**。
	   この画面は位置情報を必須にしていないので、押しても動かないだけにしてログを残す。
	*/
	const handleCurrentLocation = useCallback(() => {
		lightImpact();
		getCurrentLocationPosition()
			.then(({ latitude, longitude }) => {
				const region: Region = { latitude, longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 };
				currentRegionRef.current = region;
				setMyDishesViewportRegion(region);
				updateClusterScale(region);
				mapRef.current?.animateToRegion(region, 500);
			})
			.catch((error: unknown) => {
				logFrontendEvent({
					event_name: "my_dishes_map_current_location_failed",
					error_level: "warn",
					payload: { error: error instanceof Error ? error.message : String(error) },
				});
			});
	}, [lightImpact, logFrontendEvent, updateClusterScale]);

	// マーカー配列は memo で固定する。`pins` が同じ参照である限り、activeIndex 等の
	// 無関係な state 更新で 300 個のマーカーへ props が流れない
	const clusters = useMemo(() => clusterMyDishPins(pins, clusterViewport), [pins, clusterViewport]);

	/*
	#1375 **下部の帯・Feed の並びは «地図に実際に出ているピン» に揃える。**

	間引き（表示域の外は描かない）と上限（`MAX_RENDERED_CLUSTERS`）を入れた結果、
	`pins`（取得した全件）と «地図に見えているもの» が食い違うようになった。
	帯の責務は「いま Map に出ているピンを横に並べる」（このファイル冒頭と
	`MyDishesMapSheet.tsx` の申し送り）なので、ここで揃えないと
	**帯には居るのに地図にピンが無い**という状態になる。件数の見出しも同じ理由でずれる。
	*/
	const visiblePins = useMemo(() => clusters.flatMap((cluster) => cluster.pins), [clusters]);

	const pinsRef = useRef(visiblePins);
	useEffect(() => {
		pinsRef.current = visiblePins;
	}, [visiblePins]);

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
			useMyDishesFeedScopeStore.getState().setRestaurantIds(pinsRef.current.map((p) => p.restaurant.id), "map");
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


	// クラスタを押したら «もう一段ほどく»。中のピンの外接矩形へ寄せる
	const handleClusterPress = useCallback(
		(cluster: MyDishPinCluster) => {
			lightImpact();
			const region = regionForCluster(cluster);
			currentRegionRef.current = region;
			setMyDishesViewportRegion(region);
			updateClusterScale(region);
			mapRef.current?.animateToRegion(region, 400);
		},
		[lightImpact, updateClusterScale],
	);

	// マーカー配列は memo で固定する。`clusters` が同じ参照である限り、activeIndex 等の
	// 無関係な state 更新で 300 個のマーカーへ props が流れない
	const markers = useMemo(
		() =>
			clusters.map((cluster) =>
				cluster.pins.length === 1 ? (
					<AvatarBubbleMarker
						key={cluster.id}
						testID="my-dishes-map-pin"
						coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
						onPress={() => handlePinPress(cluster.pins[0])}
						// #1398 PR5 写真なし（representativeThumbnailUrl === null）でも灰色プレースホルダーに
						// しない（#1375 追補2 決定3）。`MyDishPin` はピン＝店舗単位で `dish` を持たないため、
						// list / calendar と違い `categoryImageUrl` の段は無く `restaurant.image_url` へ直接
						// 落ちる（設計書 (2/2) §5-2 で確定。GET .../map-pins のレスポンスは変えない）
						//
						// #1513 ただし «自分の投稿が削除済み»（isOwnMediaDeleted）のピンは
						// `restaurant.image_url` へも落とさない。ピンは残したまま中身を墓標へ差し替える
						uri={
							cluster.pins[0].isOwnMediaDeleted
								? undefined
								: (cluster.pins[0].representativeThumbnailUrl ?? cluster.pins[0].restaurant.image_url ?? undefined)
						}
						bubbleContent={cluster.pins[0].isOwnMediaDeleted ? <DeletedMediaTombstone variant="pin" /> : undefined}
					/>
				) : (
					<MyDishClusterMarker key={cluster.id} cluster={cluster} onPress={() => handleClusterPress(cluster)} />
				),
			),
		[clusters, handleClusterPress, handlePinPress],
	);

	const showInitialLoading = isLoading && !hasFetchedInitial && !error;
	// #1396 M-1: 取得失敗時（hasFetchedInitial === false のまま）でも EmptyState を出し、
	// 再試行の口（refresh）へ UI から到達できるようにする。一覧ビュー（GridList の
	// ListEmptyComponent）と同じく hasFetchedInitial の成否に関わらず error を優先する。
	const showEmpty = !isLoading && (error !== null || (hasFetchedInitial && pins.length === 0));

	/*
	#1629【32】**«まだ 1 件も記録が無い» と «この範囲（条件）に無いだけ» を別の状態として扱う。**

	オーナー実機報告: 「東京でエリア再検索して、日本地図全体にして再検索すると
	『気になるお店の料理を保存したり…』と出る」。

	真因は «0 件» を 1 種類しか持っていなかったことである。Map のピンは
	`commitArea` が確定したエリア（`filter.area`）で絞った結果なので、`pins.length === 0` は
	«記録が 1 件も無い» ではなく «その絞り込みの結果が 0 件» でしかない。しかもこの操作では
	必ず 0 件になる: `regionToArea` は半径を `MAX_AREA_RADIUS_M`（50km）へ clamp するため
	（geo.ts）、日本全体を映して押しても «日本の中心から 50km» という細い円になり、
	東京の記録は全部その外側に落ちる。

	`MyDishes.empty.description` は «まだ 1 件も記録が無い人» 向けのオンボーディング文言
	（「保存したり、食べた記録をつけるとここに並びます」）なので、記録があるのにこれを出すと
	«自分の記録が消えた» と読めてしまう。

	絞り込みが 1 つも効いていないときだけオンボーディングを出し、効いているときは
	«この範囲／この条件には無い» と、次にどうすればよいか（範囲を動かす / 絞り込みを外す）を出す。
	判定に使うのは «棚を削っているもの» の数（`countActiveMyDishesFilters`）で、並び替えは数えない。
	*/
	const emptyMessage = hasAreaFilter
		? i18n.t("MyDishes.empty.noResultsInArea")
		: activeFilterCount > 0
			? i18n.t("MyDishes.empty.noResultsForFilter")
			: i18n.t("MyDishes.empty.description");
	const emptyDescription = hasAreaFilter
		? i18n.t("MyDishes.empty.noResultsInAreaHint")
		: activeFilterCount > 0
			? i18n.t("MyDishes.empty.noResultsForFilterHint")
			: undefined;
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
				{/* #1375（実機: マップの重さ）**隠れている間はマーカーを 1 つも置かない。**
				    3 ビューは keep-alive（`my-dishes/index.tsx`）で、list / Calendar を見ている間も
				    Map は `display: "none"` で生きている。`enabled` は取得を止めるだけなので、
				    これが無いとネイティブのマーカーが常駐し続ける。
				    viewport も取得結果も store / ref が持っているので、戻ったときの見た目は変わらない */}
				{enabled ? markers : null}
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
						icon={<RotateCw size={16} color={colors.textPrimaryAlt} />}
						colors={[colors.surface, colors.surface]}
						shadowColor="transparent"
						labelStyle={{ color: colors.textPrimaryAlt, fontSize: 14 }}
						loading={showButtonLoading}
						loadingIndicatorType="native"
						nativeLoadingColor={colors.textPrimaryAlt}
					/>
				</View>
				{/* #1375 実機確認: 「このエリアで絞り込み中」の帯は廃止した。
				    Map ではエリア＝いま見えている viewport そのもので、地図を動かせば
				    「このエリアで再検索」ボタンがそのまま «いまの範囲で引き直す» 導線になる。
				    見えているものを文字で言い直すだけの帯は、地図を隠すぶんだけ損である。
				    エリアが効いていることの表示と解除は、フィルタ画面（MyDishes.filters.area）に集約した */}
				{/* #1629 【設計】«一部のみ表示» の帯は残す。上限（300）の «選び方» はサーバ側で
				    最新順 → 格子ごとの round-robin（地理的な散らばりを保つ）へ変えたので、
				    引きの絵から地域が丸ごと消えることは無くなったが、300 店舗を超えるユーザーでは
				    依然として出ていないピンがある。それを黙って消すと «自分の記録が消えた» に見える
				    （下の空状態の申し送りと同じ理屈）ため、帯で明示する。
				    出ていない分は «このエリアで再検索»（エリア内で 300 枠を取り直す）で回収できる */}
				{truncated && (
					<View style={styles.truncatedBanner} testID="my-dishes-map-truncated">
						<Text style={styles.truncatedText}>{i18n.t("MyDishes.map.truncated")}</Text>
					</View>
				)}
			</View>

			{showEmpty && (
				<View style={styles.emptyOverlay} pointerEvents={error ? "auto" : "none"} testID="my-dishes-map-empty-overlay">
					<EmptyState
						message={emptyMessage}
						description={emptyDescription}
						error={error}
						onRetry={refresh}
						testID="my-dishes-map-empty"
					/>
				</View>
			)}

			{/* #1375（9 巡目・オーナー指摘）現在地へ戻る口。地図の右下（シートの上）へ置く */}
			<TouchableOpacity
				testID="my-dishes-map-current-location"
				style={styles.currentLocationButton}
				onPress={handleCurrentLocation}
				accessibilityRole="button"
				accessibilityLabel={i18n.t("MyDishes.map.currentLocation")}>
				<Navigation size={20} color={colors.textPrimaryAlt} />
			</TouchableOpacity>

			{/* #1375 実機確認: Map 下部の常設シート。いま出ているピンを横に並べ、押すと Feed へ行く。
			    データは `useMyDishesMapPinsQuery` が返すピンをそのまま使う（新しい API は増やさない） */}
			{/* #1375 実機確認（2 巡目）: 帯を上へ引き上げたら、先頭のピンから Feed を開く
			    （タイルを押したときと同じ経路。並びも同じものを置く） */}
			<MyDishesMapSheet
				pins={visiblePins}
				onSelectPin={handlePinPress}
				onSwipeUp={visiblePins.length > 0 ? handleSheetSwipeUp : undefined}
			/>
		</View>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
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
		// #1375（9 巡目）現在地ボタン。下部シートの上端より上に来る位置へ置く
		currentLocationButton: {
			position: "absolute",
			right: 16,
			bottom: 180,
			width: 44,
			height: 44,
			borderRadius: 22,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.surface,
			// 影はテーマに依らず黒でよい（ダークでは実質見えない）。正本の FixedColors を使う
			shadowColor: FixedColors.shadow,
			shadowOpacity: 0.15,
			shadowRadius: 6,
			shadowOffset: { width: 0, height: 2 },
			elevation: 4,
			zIndex: 100,
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
			color: FixedColors.onMedia,
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
