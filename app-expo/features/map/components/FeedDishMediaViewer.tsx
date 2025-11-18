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

	if (isLoading) {
		return (
			<View style={styles.centerContainer}>
				<ActivityIndicator size="large" color="#5EA2FF" />
				<Text style={styles.loadingText}>Loading...</Text>
			</View>
		);
	}

	if (error) {
		return (
			<View style={styles.centerContainer}>
				<Text style={styles.errorText}>{error}</Text>
			</View>
		);
	}

	if (!items || items.length === 0) {
		return (
			<View style={styles.centerContainer}>
				<Text style={styles.emptyText}>No items available</Text>
			</View>
		);
	}

	// 現在表示中のアイテムを取得
	const currentItem = items[currentIndex] || items[0];

	return (
		<View style={{ height: frame.height }}>
			<DishMediaFeed
				items={items}
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
	centerContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "#000",
	},
	loadingText: {
		marginTop: 16,
		color: "#FFF",
		fontSize: 16,
	},
	errorText: {
		color: "#FF6B6B",
		fontSize: 16,
		textAlign: "center",
		paddingHorizontal: 20,
	},
	emptyText: {
		color: "#FFF",
		fontSize: 16,
		textAlign: "center",
	},
	writeReviewButton: {
		marginVertical: 16,
	},
});
