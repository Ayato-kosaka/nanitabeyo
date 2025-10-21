import React, { forwardRef, useRef, useCallback, useImperativeHandle } from "react";
import { GoogleMap, Marker as GoogleMarker } from "@react-google-maps/api";
import type { MapViewProps, MarkerProps } from "./MapView";
import type { MapPressEvent, MarkerPressEvent, PoiClickEvent, Region } from "react-native-maps";
import { OverlayView } from "@react-google-maps/api";
import { TouchableOpacity } from "react-native";

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
	}, [onPress, testID]);

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
	({ style, region, onRegionChangeComplete, onPress, onPoiClick, children, customMapStyle }, ref) => {
		/* Google Maps 本体を保持（外部には晒さない） */
		const innerMapRef = useRef<google.maps.Map | null>(null);

		/* Google Maps 読み込み完了時 */
		const handleLoad = useCallback(
			(map: google.maps.Map) => {
				innerMapRef.current = map;

				const div = map.getDiv();
				const width = div?.offsetWidth ?? 0;
				if (region?.longitudeDelta && width > 0) {
					const z = Math.log2((360 * width) / (256 * region.longitudeDelta));
					map.setZoom(Math.max(0, Math.min(21, z)));
				} else if (region?.latitudeDelta) {
					// ざっくり初期値（緯度方向は近似でOK）
					const z = Math.log2(360 / region.latitudeDelta);
					map.setZoom(Math.max(0, Math.min(21, z)));
				}
			},
			[region],
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

		return (
			<GoogleMap
				onLoad={handleLoad}
				mapContainerStyle={containerStyle}
				onClick={handleClick}
				onIdle={handleIdle}
				options={{
					disableDefaultUI: true, // すべてのデフォルトUIを非表示
					clickableIcons: !!onPoiClick, // POI アイコンをクリック可能にする
					styles: customMapStyle, // カスタムマップスタイルを適用
				}}>
				{children}
			</GoogleMap>
		);
	},
);

export default MapView;

function deltaToZoom(latitudeDelta: number): number {
	return Math.log2(360 / latitudeDelta);
}
