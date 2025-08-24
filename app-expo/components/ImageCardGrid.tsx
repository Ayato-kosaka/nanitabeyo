import React, { memo, ReactNode, useCallback, useMemo } from "react";
import {
	FlatList,
	Image,
	ListRenderItemInfo,
	Pressable,
	StyleProp,
	StyleSheet,
	useWindowDimensions,
	ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";

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

function _ImageCard<T extends ImageCardItem>({
	item,
	columns = 3,
	gap = 1,
	paddingHorizontal = 16,
	aspectRatio = 9 / 16,
	onPress,
	cardStyle,
	children,
}: {
	item: T;
	columns?: number;
	gap?: number;
	paddingHorizontal?: number;
	aspectRatio?: number;
	onPress?: (i: T) => void;
	cardStyle?: StyleProp<ViewStyle>;
	children?: ReactNode;
}) {
	const { lightImpact } = useHaptics();
	const { width: widthDimensions } = useWindowDimensions();

	/** 列数・ギャップ・左右 padding からカード幅を計算 */
	const width = useMemo(
		() => (widthDimensions - paddingHorizontal * 2 - gap * (columns - 1)) / columns,
		[widthDimensions, paddingHorizontal, gap, columns],
	);
	const height = width / aspectRatio;

	const handlePress = useCallback(() => {
		if (onPress) {
			lightImpact();
			onPress(item);
		}
	}, [item, onPress, lightImpact]);

	return (
		<Pressable
			style={[styles.card, { width, height, marginBottom: gap }, cardStyle]}
			onPress={handlePress}
			disabled={!onPress}
			android_ripple={{ color: "rgba(0,0,0,0.06)" }}
			accessibilityRole="button"
			accessibilityLabel={i18n.t("ImageCardGrid.openItemDetails")}>
			<Image
				source={{ uri: item.imageUrl }}
				style={StyleSheet.absoluteFill}
				resizeMode="cover"
				onError={(error) => {
					console.log("Image loading failed for URL:", item.imageUrl, "Error:", error);
				}}
				onLoad={() => {
					console.log("Image loaded successfully for URL:", item.imageUrl);
				}}
			/>
			<LinearGradient
				colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.1)"]}
				style={StyleSheet.absoluteFill}
				pointerEvents="box-none">
				{children}
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
	const renderItem = useCallback(
		(info: ListRenderItemInfo<T>) => (
			<_ImageCard item={info.item} aspectRatio={aspectRatio} gap={gap} onPress={onPress} cardStyle={cardStyle}>
				{renderOverlay?.(info.item)}
			</_ImageCard>
		),
		[aspectRatio, gap, onPress, renderOverlay, cardStyle],
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
			removeClippedSubviews
		/>
	);
}

export const ImageCardGrid = memo(_ImageCardGrid) as typeof _ImageCardGrid;
export const ImageCard = memo(_ImageCard) as typeof _ImageCard;

/* -------------------------------------------------------------------------- */
/*                               スタイル定義                                 */
/* -------------------------------------------------------------------------- */
const styles = StyleSheet.create({
	card: {
		backgroundColor: "#F8F9FA",
		overflow: "hidden",
		position: "relative",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 4,
		elevation: 3,
	},
});
