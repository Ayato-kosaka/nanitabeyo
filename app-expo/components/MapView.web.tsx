import React, { forwardRef, useRef, useCallback, useImperativeHandle } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { GoogleMap, Marker as GoogleMarker } from "@react-google-maps/api";
import type { MapViewProps, MarkerProps } from "./MapView";
import type { MapPressEvent, MarkerPressEvent, PoiClickEvent, Region } from "react-native-maps";
import { OverlayView } from "@react-google-maps/api";
import { useMapsLoader } from "@/contexts/MapsLoaderContext";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import i18n from "@/lib/i18n";

/** ─────────────────────────────────────────────────────────────
 *  ネイティブと API 互換にするためのハンドル
 *  ──────────────────────────────────────────────────────────── */
export interface MapViewHandle {
	/** iOS/Android 版だけで実装されるため、Web では no-op */
	animateToRegion: (region: Region, duration?: number) => void;
}

/* ─────────────────────────────── Marker ──────────────────────────────── */
export const Marker: React.FC<MarkerProps> = ({ coordinate, title, onPress, testID, zIndex, children }) => {
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
				{/* #955 【仕様】OVERLAY_MOUSE_TARGET ペイン内は挿入順で重なるため、
				    選択中のピンを最前面にするには明示的な z-index が必要 */}
				<div style={{ transform: "translate(-50%, -100%)", position: "relative", zIndex: zIndex ?? 0 }}>{children}</div>
			</TouchableOpacity>
		</OverlayView>
	) : (
		<GoogleMarker
			position={{ lat: coordinate.latitude, lng: coordinate.longitude }}
			title={title}
			zIndex={zIndex}
			onClick={handleClick}
		/>
	);
};

/* ─────────────────────────────── MapView ──────────────────────────────── */
const MapView = forwardRef<MapViewHandle | null, MapViewProps>(
	({ style, region, initialRegion, onRegionChangeComplete, onPress, onPoiClick, children }, ref) => {
		/* Google Maps 本体を保持（外部には晒さない） */
		const innerMapRef = useRef<google.maps.Map | null>(null);
		// #938 【仕様】initialRegion が渡されているのに参照していなかったため、Web だけ地図の
		// 初期中心が定まらず「読み込み直後は無関係な位置→アニメーションで正しい位置へパン」という
		// ちらつきが発生していた。region(可変)より initialRegion(初期値専用)を優先する。
		const effectiveRegion = initialRegion ?? region;

		/* Google Maps 読み込み完了時 */
		const handleLoad = useCallback(
			(map: google.maps.Map) => {
				innerMapRef.current = map;

				// #362 MapView の POI 表示を「飲食系のみに制限」する
				map.setOptions({
					mapId: "4e9ea5ba5d0c3d1099d6c348",
				});
				const div = map.getDiv();
				const width = div?.offsetWidth ?? 0;
				if (effectiveRegion?.longitudeDelta && width > 0) {
					const z = Math.log2((360 * width) / (256 * effectiveRegion.longitudeDelta));
					map.setZoom(Math.max(0, Math.min(21, z)));
				} else if (effectiveRegion?.latitudeDelta) {
					// ざっくり初期値（緯度方向は近似でOK）
					const z = Math.log2(360 / effectiveRegion.latitudeDelta);
					map.setZoom(Math.max(0, Math.min(21, z)));
				}
			},
			[effectiveRegion],
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

		// #938 【仕様】Maps JS SDK はアプリ全体で1回だけ読み込む(MapsLoaderProvider)。
		// 結果画面など MapView が実際にマウントされるまでロードは始まらないため、
		// ロード中/失敗時はここで専用の表示に差し替える。
		const { isLoaded, loadError } = useMapsLoader();

		if (loadError) {
			const query = effectiveRegion ? `${effectiveRegion.latitude},${effectiveRegion.longitude}` : "";
			const fallbackUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
			return (
				<View style={[containerStyle as object, styles.center]}>
					<Text style={styles.errorText}>{i18n.t("Map.errors.loadFailed")}</Text>
					{query ? (
						<TouchableOpacity
							onPress={() => window.open(fallbackUrl, "_blank", "noopener,noreferrer")}
							accessibilityRole="button"
							accessibilityLabel={i18n.t("Map.openInGoogleMaps")}>
							<Text style={styles.fallbackLink}>{i18n.t("Map.openInGoogleMaps")}</Text>
						</TouchableOpacity>
					) : null}
				</View>
			);
		}

		if (!isLoaded) {
			return (
				<View style={[containerStyle as object, styles.center]}>
					<LoadingIndicator size="small" />
				</View>
			);
		}

		return (
			<GoogleMap
				onLoad={handleLoad}
				mapContainerStyle={containerStyle}
				center={effectiveRegion ? { lat: effectiveRegion.latitude, lng: effectiveRegion.longitude } : undefined}
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

const styles = StyleSheet.create({
	center: {
		alignItems: "center",
		justifyContent: "center",
		gap: 12,
		backgroundColor: "#F3F4F6",
	},
	errorText: {
		fontSize: 14,
		color: "#6B7280",
	},
	fallbackLink: {
		fontSize: 14,
		fontWeight: "700",
		color: "#F05537",
		textDecorationLine: "underline",
	},
});

export default MapView;

function deltaToZoom(latitudeDelta: number): number {
	return Math.log2(360 / latitudeDelta);
}
