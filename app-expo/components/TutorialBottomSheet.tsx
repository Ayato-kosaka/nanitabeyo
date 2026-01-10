import React, { useRef, useState } from "react";
import { View, StyleSheet, Dimensions, TouchableOpacity } from "react-native";
import PagerView from "react-native-pager-view";
import { TutorialPage } from "./TutorialPage";
import i18n from "@/lib/i18n";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";

const SCREEN_WIDTH = Dimensions.get("window").width;

export type TutorialBottomSheetProps = {
	visible: boolean;
	onClose: () => void;
	onCompleted?: () => void;
	onRequestCurrentLocation: () => Promise<void>;
};

/**
 * #642 【設計】Searchタブ用チュートリアル BottomSheet
 * - 4ページ構成（アプリ価値、料理選択、お店選択、位置情報許可）
 * - 横スワイプ or 「つぎへ」ボタンでページ送り
 * - 最終ページで位置情報許可を促す
 */
export function TutorialBottomSheet({
	visible,
	onClose,
	onCompleted,
	onRequestCurrentLocation,
}: TutorialBottomSheetProps) {
	const [currentPage, setCurrentPage] = useState(0);
	const pagerRef = useRef<PagerView>(null);

	const { BlurModal } = useBlurModal({
		intensity: 80,
		closeOnBackdropPress: false,
		onClose: () => {
			onClose();
			// Reset to first page when closed
			setTimeout(() => setCurrentPage(0), 300);
		},
	});

	const handleNextPage = () => {
		if (currentPage < 3) {
			pagerRef.current?.setPage(currentPage + 1);
		}
	};

	const handleSkip = () => {
		if (onCompleted) onCompleted();
		onClose();
	};

	const handleRequestLocation = async () => {
		try {
			await onRequestCurrentLocation();
			if (onCompleted) onCompleted();
			onClose();
		} catch (error) {
			// #642 【設計】位置情報拒否時もチュートリアルを閉じる（再表示しない）
			if (onCompleted) onCompleted();
			onClose();
		}
	};

	// Tutorial page content
	const tutorialPages = [
		{
			image: require("@/assets/images/tutorial/page1-app-overview.png"),
			title: i18n.t("Search.tutorial.page1.title"),
			bodyLines: [i18n.t("Search.tutorial.page1.body1"), i18n.t("Search.tutorial.page1.body2")],
			primaryCtaLabel: i18n.t("Search.tutorial.page1.cta"),
			onPrimaryCtaPress: handleNextPage,
		},
		{
			image: require("@/assets/images/tutorial/page2-dish-carousel.png"),
			title: i18n.t("Search.tutorial.page2.title"),
			bodyLines: [i18n.t("Search.tutorial.page2.body1"), i18n.t("Search.tutorial.page2.body2")],
			primaryCtaLabel: i18n.t("Search.tutorial.page2.cta"),
			onPrimaryCtaPress: handleNextPage,
		},
		{
			image: require("@/assets/images/tutorial/page3-restaurant-map.png"),
			title: i18n.t("Search.tutorial.page3.title"),
			bodyLines: [i18n.t("Search.tutorial.page3.body1"), i18n.t("Search.tutorial.page3.body2")],
			primaryCtaLabel: i18n.t("Search.tutorial.page3.cta"),
			onPrimaryCtaPress: handleNextPage,
		},
		{
			image: require("@/assets/images/tutorial/page4-location-permission.png"),
			title: i18n.t("Search.tutorial.page4.title"),
			bodyLines: [i18n.t("Search.tutorial.page4.body1"), i18n.t("Search.tutorial.page4.body2")],
			primaryCtaLabel: i18n.t("Search.tutorial.page4.primaryCta"),
			onPrimaryCtaPress: handleRequestLocation,
			secondaryCtaLabel: i18n.t("Search.tutorial.page4.secondaryCta"),
			onSecondaryCtaPress: handleSkip,
		},
	];

	return (
		<BlurModal showCloseButton={false} contentContainerStyle={styles.modalContent}>
			<View style={styles.container}>
				{/* PagerView for swiping between pages */}
				<PagerView
					ref={pagerRef}
					style={styles.pager}
					initialPage={0}
					onPageSelected={(e) => setCurrentPage(e.nativeEvent.position)}>
					{tutorialPages.map((page, index) => (
						<View key={index} style={styles.pageContainer}>
							<TutorialPage {...page} />
						</View>
					))}
				</PagerView>

				{/* Page indicators */}
				<View style={styles.indicatorContainer}>
					{tutorialPages.map((_, index) => (
						<View key={index} style={[styles.indicator, currentPage === index && styles.activeIndicator]} />
					))}
				</View>
			</View>
		</BlurModal>
	);
}

const styles = StyleSheet.create({
	modalContent: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		width: "100%",
	},
	container: {
		width: SCREEN_WIDTH * 0.9,
		height: "85%",
		backgroundColor: "#FFFFFF",
		borderRadius: 24,
		overflow: "hidden",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 8 },
		shadowOpacity: 0.15,
		shadowRadius: 24,
		elevation: 12,
	},
	pager: {
		flex: 1,
	},
	pageContainer: {
		width: "100%",
		height: "100%",
	},
	indicatorContainer: {
		flexDirection: "row",
		justifyContent: "center",
		alignItems: "center",
		paddingVertical: 20,
		gap: 8,
	},
	indicator: {
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: "#D1D5DB",
	},
	activeIndicator: {
		width: 24,
		backgroundColor: "#5EA2FF",
	},
});
