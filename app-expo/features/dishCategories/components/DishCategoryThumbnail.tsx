import React, { useCallback } from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import { Image } from "expo-image";
import { DishCategoryRecommendation } from "@/types/search";
import { SkeletonShimmer } from "@/components/SkeletonShimmer";
import i18n from "@/lib/i18n";
import { type DishCategoryImageResourceState } from "@/features/dishCategories/hooks/useDishCategoryImageResources";
import { type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";

type DishCategoryThumbnailProps = {
	dishCategory: DishCategoryRecommendation;
	index: number;
	total: number;
	isActive: boolean;
	imageState: DishCategoryImageResourceState;
	width: number;
	onPress: (index: number) => void;
	onImageError: (dishCategory: DishCategoryRecommendation) => void;
};

/**
 * #1007 【設計】サムネイル1件を React.memo 化し、Carousel の onSnapToItem による currentIndex 更新時に
 * 「旧選択」「新選択」の2件だけが再レンダーされるようにする。props は isActive と自身の imageState
 * のみを可変値として受け取り、onPress/onImageError は呼び出し元で useCallback 済みの安定参照を渡す前提。
 */
export const DishCategoryThumbnail = React.memo(function DishCategoryThumbnail({
	dishCategory,
	index,
	total,
	isActive,
	imageState,
	width,
	onPress,
	onImageError,
}: DishCategoryThumbnailProps) {
	const styles = useThemedStyles(createStyles);
	const handlePress = useCallback(() => onPress(index), [onPress, index]);
	const handleImageError = useCallback(() => onImageError(dishCategory), [onImageError, dishCategory]);

	return (
		<TouchableOpacity
			style={[styles.thumbnail, { width }, isActive && styles.thumbnailActive]}
			onPress={handlePress}
			activeOpacity={0.7}
			accessibilityRole="button"
			accessibilityLabel={i18n.t("DishCategories.accessibility.thumbnail", {
				title: dishCategory.title,
				index: index + 1,
				total,
			})}
			accessibilityState={{ selected: isActive }}>
			{imageState.status === "ready" ? (
				<Image
					source={imageState.image}
					style={styles.thumbnailImage}
					contentFit="cover"
					recyclingKey={`dishCategory-thumbnail:${dishCategory.categoryId}`}
					// #937 【仕様】親 TouchableOpacity 側で読み上げるため、画像自体は装飾扱いにする
					alt=""
					accessibilityElementsHidden
					importantForAccessibility="no"
					// #929 【修正】web は ready でも実際の読み込み成否が未検証のため、
					// 失敗を共有 state へ反映してカード側の失敗UI/再試行に繋げる
					onError={handleImageError}
				/>
			) : (
				<SkeletonShimmer width="100%" height="100%" />
			)}
		</TouchableOpacity>
	);
});

// #1629 【修正】枠線・影がライト固定の直書きで、ダークの地の上で明るい枠が浮いていた。
// 選択中の «ブランド色の枠» という役割は変えず、非選択の枠だけテーマへ追従させる。
const createStyles = (colors: Palette) =>
	StyleSheet.create({
		thumbnail: {
			aspectRatio: 1, // 正方形
			borderRadius: 12,
			overflow: "hidden",
			borderWidth: 2,
			borderColor: colors.border,
			shadowColor: colors.border,
			shadowOffset: { width: 0, height: 2 },
			shadowOpacity: 0.3,
			shadowRadius: 4,
			elevation: 4,
		},
		thumbnailActive: {
			borderColor: colors.brand,
			shadowColor: colors.brand,
			shadowOffset: { width: 0, height: 2 },
			shadowOpacity: 0.3,
			shadowRadius: 4,
			elevation: 4,
		},
		thumbnailImage: {
			width: "100%",
			height: "100%",
		},
	});
