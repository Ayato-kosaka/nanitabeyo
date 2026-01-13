import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Dimensions, TouchableOpacity, Text, FlatList } from "react-native";
import { TrueSheet } from "@lodev09/react-native-true-sheet";
import { TutorialPage } from "@/components/TutorialPage";
import i18n from "@/lib/i18n";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const SHEET_MAX_HEIGHT = 580;

export type TutorialBottomSheetProps = {
	visible: boolean;
	pageConfigs: readonly TutorialPageConst[];
	onClose: () => void;
	onCompleted?: () => void;
	onRequestCurrentLocation: () => Promise<void>;
};

export type TutorialPageConst = {
	image: any;
	titleKey: string;
	bodyLineKeys: string[];
	primaryCtaLabelKey: string;
	secondaryCtaLabelKey?: string;
};

// FlatList の 1 アイテム = 1 ページ分の設定
type TutorialPageConfig = {
	image: any;
	title: string;
	bodyLines: string[];
	primaryCtaLabel: string;
	onPrimaryCtaPress: () => void;
	secondaryCtaLabel?: string;
	onSecondaryCtaPress?: () => void;
};

/**
 * #642 Searchタブ用チュートリアル BottomSheet
 *
 * - @lodev09/react-native-true-sheet の TrueSheet を使用
 * - ページングは FlatList + pagingEnabled（Web でも動く構成）
 * - ページインジケータ & CTA はフッター固定
 */
export function TutorialBottomSheet({
	visible,
	pageConfigs,
	onClose,
	onCompleted,
	onRequestCurrentLocation,
}: TutorialBottomSheetProps) {
	// TrueSheet の ref
	const sheetRef = useRef<TrueSheet>(null);

	// ページング用 FlatList の ref
	const listRef = useRef<FlatList<TutorialPageConfig> | null>(null);

	// 今どのページにいるか（インジケータ & CTA 用）
	const [currentPage, setCurrentPage] = useState(0);

	// #642 【設計】TrueSheet の present/dismiss による表示制御
	useEffect(() => {
		if (!visible) {
			sheetRef.current?.dismiss();
			return;
		}

		// マウントが済んでから present() するために setTimeout で遅延させる
		const timeoutId = setTimeout(() => {
			sheetRef.current?.present();
		}, 0);

		return () => clearTimeout(timeoutId);
	}, [visible]);

	/**
	 * TrueSheet の onDidDismiss イベント
	 * - ユーザー操作 or dismiss() 呼び出しで閉じきったタイミング
	 */
	const handleDidDismiss = useCallback(() => {
		setCurrentPage(0);
		listRef.current?.scrollToIndex({
			index: 0,
			animated: false,
		});
		onClose(); // 親に「閉じたよ」を通知（親が visible=false にする）
	}, [onClose]);

	/**
	 * 「あとで」押下
	 */
	const handleSkip = useCallback(async () => {
		onCompleted?.();
		await sheetRef.current?.dismiss();
	}, [onCompleted]);

	/**
	 * 「現在地を利用する」押下
	 */
	const handleRequestLocation = useCallback(async () => {
		try {
			await onRequestCurrentLocation();
		} finally {
			onCompleted?.();
			await sheetRef.current?.dismiss();
		}
	}, [onRequestCurrentLocation, onCompleted]);

	/**
	 * 「つぎへ」ボタン押下時のページ送り
	 */
	const handleNextPage = useCallback((fromIndex: number, pagesLength: number) => {
		const nextIndex = Math.min(fromIndex + 1, pagesLength - 1);
		if (nextIndex === fromIndex) return;

		listRef.current?.scrollToIndex({
			index: nextIndex,
			animated: true,
		});
		setCurrentPage(nextIndex);
	}, []);

	/**
	 * viewability を使って「今見えているページ」を検知
	 * - 手動スワイプ / scrollToIndex の両方に確実に反応する
	 */
	const viewabilityConfig = useRef({
		itemVisiblePercentThreshold: 60,
	}).current;

	const handleViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: { index?: number | null }[] }) => {
		if (viewableItems.length > 0) {
			const index = viewableItems[0].index ?? 0;
			setCurrentPage(index);
		}
	}).current;

	/**
	 * チュートリアルページ定義
	 */
	const tutorialPages: TutorialPageConfig[] = useMemo(() => {
		const pagesLength = pageConfigs.length;

		return pageConfigs.map((config, index) => ({
			image: config.image,
			title: i18n.t(config.titleKey),
			bodyLines: config.bodyLineKeys.map((key) => i18n.t(key)),
			primaryCtaLabel: i18n.t(config.primaryCtaLabelKey),
			onPrimaryCtaPress:
				index === pagesLength - 1
					? handleRequestLocation
					: () => {
							handleNextPage(index, pagesLength);
						},
			secondaryCtaLabel: config.secondaryCtaLabelKey ? i18n.t(config.secondaryCtaLabelKey) : undefined,
			onSecondaryCtaPress: index === pagesLength - 1 ? handleSkip : undefined,
		}));
	}, [pageConfigs, handleNextPage, handleRequestLocation, handleSkip]);

	// 現在ページの CTA 設定
	const currentConfig = tutorialPages[currentPage] ?? tutorialPages[0];

	return (
		<TrueSheet
			ref={sheetRef}
			detents={["auto"]}
			maxHeight={SHEET_MAX_HEIGHT}
			style={{ height: "100%" }}
			cornerRadius={24}
			backgroundColor="#FFFFFF"
			grabber
			dimmed
			dismissible
			onDidDismiss={handleDidDismiss}>
			<View style={styles.container}>
				{/* 上：横スワイプで動くコンテンツ */}
				<FlatList
					ref={listRef}
					data={tutorialPages}
					keyExtractor={(_: TutorialPageConfig, index: number) => `tutorial-page-${index}`}
					style={{ flexGrow: 1 }}
					renderItem={({ item }: { item: TutorialPageConfig }) => (
						<View style={styles.pageContainer}>
							<TutorialPage image={item.image} title={item.title} bodyLines={item.bodyLines} />
						</View>
					)}
					horizontal
					pagingEnabled
					showsHorizontalScrollIndicator={false}
					viewabilityConfig={viewabilityConfig}
					onViewableItemsChanged={handleViewableItemsChanged}
					getItemLayout={(_, index) => ({
						length: SCREEN_WIDTH,
						offset: SCREEN_WIDTH * index,
						index,
					})}
				/>

				{/* 下：固定フッター（インジケータ + CTA） */}
				<View style={styles.footer}>
					{/* ページインジケータ */}
					<View style={styles.indicatorContainer}>
						{tutorialPages.map((_, index) => (
							<View key={index} style={[styles.indicator, currentPage === index && styles.activeIndicator]} />
						))}
					</View>

					{/* CTA ボタン群 */}
					<View style={styles.ctaContainer}>
						<TouchableOpacity
							style={styles.primaryButton}
							onPress={currentConfig.onPrimaryCtaPress}
							activeOpacity={0.7}>
							<Text style={styles.primaryButtonText}>{currentConfig.primaryCtaLabel}</Text>
						</TouchableOpacity>

						<View style={styles.secondaryWrapper}>
							{currentConfig.secondaryCtaLabel && currentConfig.onSecondaryCtaPress ? (
								<TouchableOpacity
									style={styles.secondaryButton}
									onPress={currentConfig.onSecondaryCtaPress}
									activeOpacity={0.7}>
									<Text style={styles.secondaryButtonText}>{currentConfig.secondaryCtaLabel}</Text>
								</TouchableOpacity>
							) : (
								<View style={styles.secondaryButtonPlaceholder} />
							)}
						</View>
					</View>
				</View>
			</View>
		</TrueSheet>
	);
}

const styles = StyleSheet.create({
	// Sheet 内コンテンツラッパー
	container: {
		flex: 1,
		width: SCREEN_WIDTH,
		alignSelf: "center",
	},
	// 1ページ分のコンテナ（FlatList の 1 item）
	pageContainer: {
		width: SCREEN_WIDTH,
	},
	footer: {
		paddingHorizontal: 24,
		paddingBottom: 24,
		paddingTop: 8,
	},
	indicatorContainer: {
		flexDirection: "row",
		justifyContent: "center",
		alignItems: "center",
		marginBottom: 32,
	},
	indicator: {
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: "#D1D5DB",
		marginHorizontal: 4,
	},
	activeIndicator: {
		backgroundColor: "#111827",
	},
	ctaContainer: {
		gap: 0,
	},
	primaryButton: {
		backgroundColor: "#FFFFFF",
		borderRadius: 8,
		paddingVertical: 12,
		alignItems: "center",
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: "#D1D5DB",
	},
	primaryButtonText: {
		fontSize: 17,
		fontWeight: "700",
		color: "#111827",
	},
	secondaryWrapper: {
		marginTop: 12,
	},
	secondaryButton: {
		paddingVertical: 6,
		alignItems: "center",
	},
	secondaryButtonText: {
		fontSize: 14,
		fontWeight: "600",
		color: "#6B7280",
	},
	secondaryButtonPlaceholder: {
		paddingVertical: 16,
	},
});
