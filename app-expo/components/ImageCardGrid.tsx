import React, { memo, ReactNode, useCallback, useMemo } from 'react';
import {
  FlatList,
  Image,
  ListRenderItemInfo,
  Pressable,
  StyleProp,
  StyleSheet,
  useWindowDimensions,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/* -------------------------------------------------------------------------- */
/*                                  型定義                                    */
/* -------------------------------------------------------------------------- */

export interface ImageCardItem {
  /** 一意キー（string でも number でも OK） */
  id: string | number;
  /** 表示する画像 URL */
  imageUrl: string;
  /** 追加フィールドは自由に拡張可 */
  [key: string]: any;
}

export interface ImageCardGridProps<T extends ImageCardItem = ImageCardItem> {
  /** 表示データ */
  data: readonly T[];
  /** 列数 (デフォルト 3 列) */
  columns?: number;
  /** 行・列ギャップ (px) – デフォルト 1 */
  gap?: number;
  /** コンテナ左右パディング (px) – デフォルト 16 */
  paddingHorizontal?: number;
  /** アスペクト比 (width / height) – デフォルト 9/16 */
  aspectRatio?: number;
  /** カードタップ時 */
  onPress?: (item: T) => void;
  /** オーバーレイ表示内容をレンダリングする関数 */
  renderOverlay?: (item: T) => ReactNode;
  /** カード追加スタイル（影の上書きなど） */
  cardStyle?: StyleProp<ViewStyle>;
  /** FlatList contentContainerStyle 追加・上書き */
  containerStyle?: StyleProp<ViewStyle>;
  /** スクロール可否 – デフォルト false */
  scrollEnabled?: boolean;
  /** E2E testID */
  testID?: string;
}

/* -------------------------------------------------------------------------- */
/*                              Card 内部実装                                 */
/* -------------------------------------------------------------------------- */

function ImageCard<T extends ImageCardItem>({
  item,
  size,
  aspectRatio,
  gap,
  onPress,
  renderOverlay,
  cardStyle,
}: {
  item: T;
  size: number;
  aspectRatio: number;
  gap: number;
  onPress?: (i: T) => void;
  renderOverlay?: (i: T) => ReactNode;
  cardStyle?: StyleProp<ViewStyle>;
}) {
  const height = size / aspectRatio;

  const handlePress = useCallback(() => onPress?.(item), [item, onPress]);

  return (
    <Pressable
      style={[
        styles.card,
        { width: size, height, marginBottom: gap },
        cardStyle,
      ]}
      onPress={handlePress}
      disabled={!onPress}
      android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
      accessibilityRole="button"
      accessibilityLabel="Open item details"
    >
      <Image
        source={{ uri: item.imageUrl }}
        resizeMode="cover"
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.1)']}
        style={StyleSheet.absoluteFill}
        pointerEvents="box-none"
      >
        {renderOverlay?.(item)}
      </LinearGradient>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/*                               Grid 本体                                    */
/* -------------------------------------------------------------------------- */

function _ImageCardGrid<T extends ImageCardItem>({
  data,
  columns = 3,
  gap = 1,
  paddingHorizontal = 16,
  aspectRatio = 9 / 16,
  onPress,
  renderOverlay,
  cardStyle,
  containerStyle,
  scrollEnabled = false,
  testID,
}: ImageCardGridProps<T>) {
  const { width } = useWindowDimensions();

  /** 列数・ギャップ・左右 padding からカード幅を計算 */
  const itemSize = useMemo(
    () => (width - paddingHorizontal * 2 - gap * (columns - 1)) / columns,
    [width, paddingHorizontal, gap, columns]
  );

  const renderItem = useCallback(
    (info: ListRenderItemInfo<T>) => (
      <ImageCard
        item={info.item}
        size={itemSize}
        aspectRatio={aspectRatio}
        gap={gap}
        onPress={onPress}
        renderOverlay={renderOverlay}
        cardStyle={cardStyle}
      />
    ),
    [itemSize, aspectRatio, gap, onPress, renderOverlay, cardStyle]
  );

  const keyExtractor = useCallback((item: T) => item.id.toString(), []);

  return (
    <FlatList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      numColumns={columns}
      columnWrapperStyle={{ gap }}
      contentContainerStyle={[{ paddingHorizontal }, containerStyle]}
      showsVerticalScrollIndicator={false}
      scrollEnabled={scrollEnabled}
      testID={testID}
      initialNumToRender={12}
      windowSize={9}
      removeClippedSubviews
    />
  );
}

export const ImageCardGrid = memo(_ImageCardGrid) as typeof _ImageCardGrid;

/* -------------------------------------------------------------------------- */
/*                               スタイル定義                                 */
/* -------------------------------------------------------------------------- */
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F8F9FA',
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});
