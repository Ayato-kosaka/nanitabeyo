import React, {
  forwardRef,
  useRef,
  useCallback,
  useImperativeHandle,
} from 'react';
import {
  GoogleMap,
  Marker as GoogleMarker,
  LoadScript,
} from '@react-google-maps/api';
import type { MapViewProps, MarkerProps } from './MapView';
import type {
  MapPressEvent,
  MarkerPressEvent,
  PoiClickEvent,
  Region,
} from 'react-native-maps';
import { Env } from '@/constants/Env';

/** ─────────────────────────────────────────────────────────────
 *  ネイティブと API 互換にするためのハンドル
 *  ──────────────────────────────────────────────────────────── */
export interface MapViewHandle {
  /** iOS/Android 版だけで実装されるため、Web では no-op */
  animateToRegion: (region: Region, duration?: number) => void;
}

/* ─────────────────────────────── Marker ──────────────────────────────── */
export const Marker: React.FC<MarkerProps> = ({
  coordinate,
  title,
  onPress,
  testID,
}) => {
  const handleClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (!onPress || !e.latLng) return;
      const event = {
        nativeEvent: {
          id: testID ?? '',
          action: 'marker-press',
          coordinate: {
            latitude: e.latLng.lat(),
            longitude: e.latLng.lng(),
          },
        },
      } as unknown as MarkerPressEvent;
      onPress(event);
    },
    [onPress, testID]
  );

  return (
    <GoogleMarker
      position={{ lat: coordinate.latitude, lng: coordinate.longitude }}
      title={title}
      onClick={handleClick}
    />
  );
};

/* ─────────────────────────────── MapView ──────────────────────────────── */
const MapView = forwardRef<MapViewHandle | null, MapViewProps>(
  (
    {
      style,
      region,
      onRegionChangeComplete,
      onPress,
      onPoiClick,
      language,
      children,
    },
    ref
  ) => {
    /* Google Maps 本体を保持（外部には晒さない） */
    const innerMapRef = useRef<google.maps.Map | null>(null);

    /* Google Maps 読み込み完了時 */
    const handleLoad = useCallback((map: google.maps.Map) => {
      innerMapRef.current = map;
    }, []);

    /* パン／ズーム完了時に Region を返す */
    const handleIdle = useCallback(() => {
      if (!onRegionChangeComplete || !innerMapRef.current) return;
      const center = innerMapRef.current.getCenter();
      if (!center) return;

      onRegionChangeComplete(
        {
          latitude: center.lat(),
          longitude: center.lng(),
          latitudeDelta: region?.latitudeDelta ?? 0,
          longitudeDelta: region?.longitudeDelta ?? 0,
        },
        { isGesture: false } as any
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
              action: 'poi-click',
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
      [onPoiClick, onPress]
    );

    /* ───────── ネイティブ互換メソッドを ref に注入 ───────── */
    useImperativeHandle(
      ref,
      (): MapViewHandle => ({
        animateToRegion: () => {
          /* Web では無視 (no-op) */
        },
      }),
      []
    );

    /* スタイルを React Native ライクに許容 */
    const containerStyle: React.CSSProperties = {
      width: '100%',
      height: '100%',
      ...(typeof style === 'object' && style !== null
        ? (style as React.CSSProperties)
        : {}),
    };

    return (
      <LoadScript
        googleMapsApiKey={Env.GOOGLE_MAPS_WEB_API_KEY}
        language={language}
      >
        <GoogleMap
          onLoad={handleLoad}
          center={{ lat: region?.latitude ?? 0, lng: region?.longitude ?? 0 }}
          zoom={17}
          mapContainerStyle={containerStyle}
          onClick={handleClick}
          onIdle={handleIdle}
        >
          {children}
        </GoogleMap>
      </LoadScript>
    );
  }
);

export default MapView;
