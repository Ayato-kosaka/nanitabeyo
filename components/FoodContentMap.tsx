import React, { useState, useRef, useCallback, useEffect } from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import Carousel from 'react-native-reanimated-carousel';
import MapView, { Marker, Region } from '@/components/MapView';
import FoodContentScreen from './FoodContentScreen';
import { FoodItem } from '@/types';

const { width, height } = Dimensions.get('window');

// Map takes top 1/5 of screen, carousel takes bottom 4/5
const CAROUSEL_HEIGHT = height * 0.8;
// parallaxScrollingScale
const PARALLAX_SCALE = 0.85;

interface FoodContentMapProps {
  items: FoodItem[];
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
}

const MOCK_COORDINATES = [
  { latitude: 35.657825, longitude: 139.696711 }, // 炙り味噌らーめん 麺匠真武咲弥 渋谷店
  { latitude: 35.65741, longitude: 139.704493 }, // 俺流塩らーめん 渋谷三丁目店
  { latitude: 35.65408, longitude: 139.707492 }, // らーめん ぎょうざ 大穀
  { latitude: 35.659186, longitude: 139.698929 }, // 蒙古タンメン中本 渋谷
  { latitude: 35.658813, longitude: 139.698221 }, // らーめん金伝丸 渋谷本店
];

export default function FoodContentMap({
  items,
  initialIndex = 0,
  onIndexChange,
}: FoodContentMapProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const carouselRef = useRef<any>(null);
  const mapRef = useRef<any>(null);

  const coordinates = MOCK_COORDINATES;

  const getMapRegion = useCallback((): Region => {
    if (coordinates.length === 0) {
      return {
        latitude: 35.6762,
        longitude: 139.6503,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
    }

    // マップのアスペクト比
    const aspectRatio = width / height;

    // 全ピンの最小・最大座標を取得
    const latitudes = coordinates.map((coord) => coord.latitude);
    const longitudes = coordinates.map((coord) => coord.longitude);

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
  }, [coordinates]);

  useEffect(() => {
    // 初期位置設定
    if (mapRef.current && coordinates.length > 0) {
      mapRef.current.animateToRegion(getMapRegion(), 1000);
    }
  }, [getMapRegion]);

  const handleIndexChange = useCallback(
    (index: number) => {
      setCurrentIndex(index);
      onIndexChange?.(index);
    },
    [onIndexChange]
  );

  const handleMarkerPress = useCallback((index: number) => {
    carouselRef.current?.scrollTo({ index, animated: true });
  }, []);

  const renderCarouselItem = useCallback(
    ({ item }: { item: FoodItem }) => (
      <View style={styles.carouselItem}>
        <FoodContentScreen item={item} />
      </View>
    ),
    []
  );

  return (
    <View style={styles.container}>
      {/* Map View - Top 1/5 of screen */}
      <View style={styles.mapContainer}>
        <MapView ref={mapRef} style={styles.map} region={getMapRegion()}>
          {coordinates.map((coordinate, index) => (
            <Marker
              key={`marker-${index}`}
              coordinate={coordinate}
              title={items[index]?.name}
              pinColor={index === currentIndex ? 'rgb(52, 119, 248)' : 'gray'}
              onPress={() => handleMarkerPress(index)}
            />
          ))}
        </MapView>
      </View>

      {/* Carousel - Bottom 4/5 of screen, overlapping map */}
      <Carousel
        ref={carouselRef}
        width={width}
        height={CAROUSEL_HEIGHT}
        data={items}
        renderItem={renderCarouselItem}
        onSnapToItem={handleIndexChange}
        defaultIndex={initialIndex}
        mode="parallax"
        modeConfig={{
          parallaxScrollingScale: PARALLAX_SCALE,
          parallaxScrollingOffset: 75,
        }}
        style={styles.carousel}
        containerStyle={styles.carouselContainer}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  mapContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  map: {
    flex: 1,
  },
  carouselContainer: {
    position: 'absolute',
    height: CAROUSEL_HEIGHT,
    left: 0,
    right: 0,
    bottom: -(CAROUSEL_HEIGHT * (1 - PARALLAX_SCALE)) / 2, // carousel の仕組みで scale(0.9) で縮小されるため、中央に配置するための調整
    zIndex: 2,
  },
  carousel: {
    flex: 1,
  },
  carouselItem: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 32,
    elevation: 12,
  },
});
