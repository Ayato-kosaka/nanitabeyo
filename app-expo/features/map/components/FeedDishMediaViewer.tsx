import React, { useState, useCallback } from "react";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { useDishMediaEntriesStore, selectEntriesByKey, DishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { ActivityIndicator, View, Text, StyleSheet } from "react-native";
import { useSafeAreaFrame } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { ReviewForm } from "./ReviewForm";
import i18n from "@/lib/i18n";
import { shallow } from "zustand/shallow";

type FeedDishMediaViewerProps = {
	initialIndex: number;
	source: string;
};

export function FeedDishMediaViewer({ initialIndex, source }: FeedDishMediaViewerProps) {
	const selector = useCallback((state: DishMediaEntriesStore) => selectEntriesByKey(source)(state), [source]);
	const { entries: items, isLoading, error } = useDishMediaEntriesStore(selector, shallow);

	const frame = useSafeAreaFrame(); // Safe Area を除いたフレームの高さ

	// #【設計】ReviewForm を BlurModal 経由で表示するための useBlurModal
	const { BlurModal: ReviewFormModal, open: openReviewModal, close: closeReviewModal } = useBlurModal({});

	// 【設計】現在表示中のインデックスを管理（DishMediaFeed の onIndexChange で更新）
	const [currentIndex, setCurrentIndex] = useState(initialIndex);
	const handleIndexChange = useCallback((index: number) => {
		setCurrentIndex(index);
	}, []);

	// #400 【設計】「この料理にレビューを書く」ボタン押下時の処理
	const handleWriteReview = useCallback(() => {
		openReviewModal();
	}, [openReviewModal]);

	// 現在表示中のアイテムを取得
	const currentItem = items[currentIndex] || items[0];

	return (
		<View style={{ height: frame.height }}>
			<DishMediaFeed
				initialIndex={isNaN(initialIndex) ? 0 : initialIndex}
				getTitle={(item) => item.dish.name}
				source={source}
				onIndexChange={handleIndexChange}
			/>
			<PrimaryButton
				style={styles.writeReviewButton}
				label={i18n.t("Map.actions.writeReviewForThisDish")}
				onPress={handleWriteReview}
			/>

			{/* #400【設計】ReviewForm を BlurModal 経由で表示（メディアなしレビューモード） */}
			<ReviewFormModal>
				<ReviewForm
					restaurant={currentItem.restaurant}
					onCancel={closeReviewModal}
					prefilledMedia={{ ...currentItem.dish_media, dish: currentItem.dish }}
				/>
			</ReviewFormModal>
		</View>
	);
}

const styles = StyleSheet.create({
	writeReviewButton: {
		marginVertical: 16,
	},
});
