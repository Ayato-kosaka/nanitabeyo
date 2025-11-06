import React, { useState, useEffect, useCallback } from "react";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { ActivityIndicator, View, Text, StyleSheet, Platform } from "react-native";
import type { DishMediaEntry } from "@shared/api/v1/res";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { ReviewForm } from "./ReviewForm";
import i18n from "@/lib/i18n";

type FeedDishMediaViewerProps = {
	initialIndex: number;
	source: string;
};

export function FeedDishMediaViewer({ initialIndex, source }: FeedDishMediaViewerProps) {
	const { dishPromisesMap } = useDishMediaEntriesStore();
	const [items, setItems] = useState<DishMediaEntry[] | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	// #【設計】現在表示中のインデックスを管理（DishMediaFeed の onIndexChange で更新）
	const [currentIndex, setCurrentIndex] = useState(initialIndex);

	const frame = useSafeAreaFrame(); // Safe Area を除いたフレームの高さ
	const insets = useSafeAreaInsets();

	// #【設計】ReviewForm を BlurModal 経由で表示するための useBlurModal
	const {
		BlurModal: ReviewFormModal,
		open: openReviewModal,
		close: closeReviewModal,
	} = useBlurModal({
		keyboardVerticalOffset: Platform.OS === "ios" ? 0 : 0,
		dismissKeyboardFirst: true,
	});

	useEffect(() => {
		const loadData = async () => {
			setIsLoading(true);
			setError(null);
			try {
				const dishMediaEntries = await dishPromisesMap[source];
				setItems(dishMediaEntries);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to load data");
			} finally {
				setIsLoading(false);
			}
		};

		loadData();
	}, [dishPromisesMap]);

	// #【設計】DishMediaFeed から現在表示中のインデックスを受け取るコールバック
	const handleIndexChange = useCallback((index: number) => {
		setCurrentIndex(index);
	}, []);

	// #【設計】「この料理にレビューを書く」ボタン押下時の処理
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

	// #【設計】現在表示中のアイテムを取得
	const currentItem = items[currentIndex] || items[0];

	return (
		<View style={{ height: frame.height }}>
			<DishMediaFeed
				items={items}
				initialIndex={isNaN(initialIndex) ? 0 : initialIndex}
				source={source}
				onIndexChange={handleIndexChange}
			/>
			{/* #【UI】DishMediaFeed の下部に「この料理にレビューを書く」ボタンを追加 */}
			{/* 既存スタイルに追従し、SafeArea を考慮した配置 */}
			<View style={[styles.buttonContainer, { paddingBottom: insets.bottom + 16 }]}>
				<PrimaryButton
					label={i18n.t("Map.actions.writeReviewForThisDish")}
					onPress={handleWriteReview}
					style={styles.writeReviewButton}
				/>
			</View>

			{/* #【設計】ReviewForm を BlurModal 経由で表示（メディアなしレビューモード） */}
			<ReviewFormModal>
				<ReviewForm
					restaurant={currentItem.restaurant}
					onCancel={closeReviewModal}
					prefilledMedia={{
						mediaUrl: currentItem.dish_media.mediaUrl,
						mediaType: currentItem.dish_media.media_type as "image" | "video",
						thumbnailImageUrl: currentItem.dish_media.thumbnailImageUrl,
					}}
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
	// #【UI】ボタンコンテナ: 既存スタイルに追従し、画面下部に固定配置
	buttonContainer: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		paddingHorizontal: 16,
		paddingTop: 8,
	},
	writeReviewButton: {
		width: "100%",
	},
});
