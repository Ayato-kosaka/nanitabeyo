import React, { useState, useCallback, useMemo } from "react";
import { router } from "expo-router";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { useDishMediaEntriesStore, selectIdsByKey } from "@/stores/useDishMediaEntriesStore";
import { View, StyleSheet } from "react-native";
import { useSafeAreaFrame } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { useLocale } from "@/hooks/useLocale";
import { ReviewForm } from "./ReviewForm";
import i18n from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthProvider";
import type { DishMediaEntry } from "@shared/api/v1/res";

type FeedDishMediaViewerProps = {
	initialIndex: number;
	entriesKey: string;
};

export function FeedDishMediaViewer({ initialIndex, entriesKey }: FeedDishMediaViewerProps) {
	const frame = useSafeAreaFrame(); // Safe Area を除いたフレームの高さ
	const { user } = useAuth();
	const locale = useLocale();

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

	// #644 【設計】レビュー投稿成功時にレビュー投稿画面へ遷移
	const handleReviewSuccess = useCallback(
		({ dishMedia }: { dishMedia: DishMediaEntry["dish_media"] }) => {
			closeReviewModal();
			router.replace(`/${locale}/(tabs)/review/post/${dishMedia.id}`);
		},
		[locale, closeReviewModal],
	);

	// 現在表示中のアイテムを取得
	const { restaurant, prefilledMedia } = useMemo(() => {
		const state = useDishMediaEntriesStore.getState(); // ← subscribe しない snapshot 読み
		const { ids } = selectIdsByKey(entriesKey, "dish_media")(state);
		const id = ids[currentIndex];
		const entry = state.entriesByMediaId[id];
		if (!entry) throw new Error("FeedDishMediaViewer: entry is undefined");
		return { restaurant: entry.restaurant, prefilledMedia: { ...entry.dish_media, dish: entry.dish } };
	}, [currentIndex, entriesKey]);

	return (
		<View style={{ height: frame.height }}>
			<DishMediaFeed
				initialIndex={isNaN(initialIndex) ? 0 : initialIndex}
				getTitle={(item) => item.dish.name}
				entriesKey={entriesKey}
				idType="dish_media"
				onIndexChange={handleIndexChange}
			/>
			{/* #477【設計】匿名ユーザーの場合はレビュー投稿ボタンを非表示 */}
			{user?.is_anonymous === false && (
				<PrimaryButton
					style={styles.writeReviewButton}
					label={i18n.t("Map.actions.writeReviewForThisDish")}
					onPress={handleWriteReview}
				/>
			)}

			{/* #400【設計】ReviewForm を BlurModal 経由で表示（メディアなしレビューモード） */}
			<ReviewFormModal>
				<ReviewForm
					restaurant={restaurant}
					onCancel={closeReviewModal}
					onSuccess={handleReviewSuccess}
					prefilledMedia={prefilledMedia}
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
