import React, { forwardRef, useRef, useCallback, useImperativeHandle } from "react";
import { GoogleMap, Marker as GoogleMarker } from "@react-google-maps/api";
import type { MapViewProps, MarkerProps } from "./MapView";
import type { MapPressEvent, MarkerPressEvent, PoiClickEvent, Region } from "react-native-maps";
import { OverlayView } from "@react-google-maps/api";
import { TouchableOpacity } from "react-native";
import { useGoogleMapsScript } from "./GoogleMapsScript";
import { FixedColors } from "@/constants/Palette";

/** ─────────────────────────────────────────────────────────────
 *  ネイティブと API 互換にするためのハンドル
 *  ──────────────────────────────────────────────────────────── */
export interface MapViewHandle {
	/** iOS/Android 版だけで実装されるため、Web では no-op */
	animateToRegion: (region: Region, duration?: number) => void;
}

/* ─────────────────────────────── Marker ──────────────────────────────── */
export const Marker: React.FC<MarkerProps> = ({ coordinate, title, onPress, testID, children }) => {
	const handleClick = useCallback(() => {
		if (!onPress) return;
		const event = {
			nativeEvent: {
				id: testID ?? "",
				action: "marker-press",
				coordinate: {
					latitude: coordinate.latitude,
					longitude: coordinate.longitude,
				},
			},
		} as unknown as MarkerPressEvent;
		onPress(event);
		// #1375 `coordinate` を依存に入れる。抜けていると古い座標が nativeEvent に載る
	}, [coordinate, onPress, testID]);

	return children ? (
		<OverlayView
			position={{ lat: coordinate.latitude, lng: coordinate.longitude }}
			mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
			<TouchableOpacity onPress={handleClick} testID={testID}>
				<div style={{ transform: "translate(-50%, -100%)" }}>{children}</div>
			</TouchableOpacity>
		</OverlayView>
	) : (
		<GoogleMarker
			position={{ lat: coordinate.latitude, lng: coordinate.longitude }}
			title={title}
			onClick={handleClick}
		/>
	);
};

/* ─────────────────────────────── MapView ──────────────────────────────── */
const MapView = forwardRef<MapViewHandle | null, MapViewProps>(
	({ style, region, initialRegion, onMapReady, onRegionChangeComplete, onPress, onPoiClick, children }, ref) => {
		/* Google Maps 本体を保持（外部には晒さない） */
		const innerMapRef = useRef<google.maps.Map | null>(null);

		/* #1503 【設計】Maps API の読み込みを «待つのはここだけ» にする。
		   このフックを呼んだ時点で初めてスクリプトの注入が始まり、読み込み中／失敗中は
		   地図の代わりにプレースホルダを描く。以前はアプリ全体を包む LoadScript が待っていたため、
		   地図と無関係な画面まで白いまま止まっていた（AppProvider.web.tsx のコメント参照）。 */
		const { isLoaded } = useGoogleMapsScript();

		/* Google Maps 読み込み完了時 */
		const handleLoad = useCallback(
			(map: google.maps.Map) => {
				innerMapRef.current = map;

				// #362 MapView の POI 表示を「飲食系のみに制限」する
				map.setOptions({
					mapId: "4e9ea5ba5d0c3d1099d6c348",
				});
				/*
				#1375 **`initialRegion` を読み、`onMapReady` を呼ぶ。**

				どちらも受け取っていなかったため、
				- 初期位置を `initialRegion` だけで渡す画面（my-dishes の Map）は web で位置が定まらない
				- `onMapReady` 後に `animateToRegion` で補正する実装は **永久に発火しない**
				  （`MyDishesMapView` はまさにその作りで、コメントに «web は onMapReady 後に補正する»
				  と書いてある。呼ばれていなかった）

				という状態だった。**web とネイティブで違うものが映る**ので、
				録画やスクリーンショットでの確認そのものが当てにならなくなる。
				*/
				const initial = region ?? initialRegion;
				const div = map.getDiv();
				const width = div?.offsetWidth ?? 0;
				if (initial) {
					map.panTo({ lat: initial.latitude, lng: initial.longitude });
				}
				if (initial?.longitudeDelta && width > 0) {
					const z = Math.log2((360 * width) / (256 * initial.longitudeDelta));
					map.setZoom(Math.max(0, Math.min(21, z)));
				} else if (initial?.latitudeDelta) {
					// ざっくり初期値（緯度方向は近似でOK）
					const z = Math.log2(360 / initial.latitudeDelta);
					map.setZoom(Math.max(0, Math.min(21, z)));
				}
				onMapReady?.();
			},
			[initialRegion, onMapReady, region],
		);

		/* パン／ズーム完了時に Region を返す */
		const handleIdle = useCallback(() => {
			if (!onRegionChangeComplete || !innerMapRef.current) return;
			const map = innerMapRef.current;
			const center = map.getCenter();
			const bounds = map.getBounds();
			if (!center || !bounds) return;

			const ne = bounds.getNorthEast();
			const sw = bounds.getSouthWest();

			// 経度差は日付変更線跨ぎに注意
			let longitudeDelta = ne.lng() - sw.lng();
			if (longitudeDelta < 0) longitudeDelta += 360;

			const latitudeDelta = ne.lat() - sw.lat();

			onRegionChangeComplete(
				{
					latitude: center.lat(),
					longitude: center.lng(),
					latitudeDelta,
					longitudeDelta,
				},
				{ isGesture: false } as any,
			);
		}, [onRegionChangeComplete, region]);

		/* タップ／POI 押下 */
		const handleClick = useCallback(
			(e: google.maps.MapMouseEvent) => {
				if (!e.latLng) return;
				// POI をタップした場合
				const { placeId } = e as unknown as { placeId?: string };
				if (placeId && onPoiClick) {
					onPoiClick({
						nativeEvent: {
							placeId,
							action: "poi-click",
							coordinate: {
								latitude: e.latLng.lat(),
								longitude: e.latLng.lng(),
							},
						},
					} as unknown as PoiClickEvent);
					return;
				}
				// 通常の地図タップ
				if (onPress) {
					onPress({
						nativeEvent: {
							coordinate: {
								latitude: e.latLng.lat(),
								longitude: e.latLng.lng(),
							},
							position: { x: 0, y: 0 },
						},
					} as unknown as MapPressEvent);
				}
			},
			[onPoiClick, onPress],
		);

		/* ───────── ネイティブ互換メソッドを ref に注入 ───────── */
		useImperativeHandle(
			ref,
			(): MapViewHandle => ({
				animateToRegion: (region: Region, duration?: number) => {
					if (!innerMapRef.current) return;
					const { latitude, longitude, latitudeDelta } = region;

					innerMapRef.current.panTo({ lat: latitude, lng: longitude });

					// latitudeDeltaをzoomレベルに変換
					const zoom = deltaToZoom(latitudeDelta);
					innerMapRef.current.setZoom(zoom);
				},
			}),
			[],
		);

		/* スタイルを React Native ライクに許容 */
		const containerStyle: React.CSSProperties = {
			width: "100%",
			height: "100%",
			...(typeof style === "object" && style !== null ? (style as React.CSSProperties) : {}),
		};

		/* 読み込み前・読み込み失敗時は地図の代わりに «場所だけ確保した» 面を描く。
		   ここで null を返すとレイアウトが潰れて周りの UI がずれるため、同じ寸法の箱を残す。

		   #1629 この面はテーマで振らない（`mapPlaceholderSurface`）。ここへ出てくるのは
		   Google のタイルで、タイルはアプリのテーマに追従せず常にライト配色である。
		   ダークで暗い箱にすると、読み込み完了の瞬間に暗 → 明のちらつきが出る。 */
		if (!isLoaded) {
			return (
				<div
					style={{ ...containerStyle, backgroundColor: FixedColors.mapPlaceholderSurface }}
					data-testid="map-placeholder"
				/>
			);
		}

		return (
			<GoogleMap
				onLoad={handleLoad}
				mapContainerStyle={containerStyle}
				onClick={handleClick}
				onIdle={handleIdle}
				options={{
					disableDefaultUI: true, // すべてのデフォルトUIを非表示
					clickableIcons: !!onPoiClick, // POI アイコンをクリック可能にする
				}}>
				{children}
			</GoogleMap>
		);
	},
);

export default MapView;

function deltaToZoom(latitudeDelta: number): number {
	// #1375 delta が 0 / 負 / 非有限だと Infinity や NaN になり、地図が無限にズームする。
	// 必ず有限の zoom を返す
	if (!(latitudeDelta > 0) || !Number.isFinite(latitudeDelta)) return 21;
	return Math.max(0, Math.min(21, Math.log2(360 / latitudeDelta)));
}
