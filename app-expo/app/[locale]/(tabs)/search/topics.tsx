import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { ThumbsUp, X } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import Carousel from "react-native-reanimated-carousel";
import { Topic, SearchParams } from "@/types/search";
import { useTopicSearch } from "@/features/topics/hooks/useTopicSearch";
import { useHideTopic } from "@/features/topics/hooks/useHideTopic";
import { TopicCard } from "@/features/topics/components/TopicCard";
import { TopicsLoading } from "@/features/topics/components/TopicsLoading";
import { TopicsError } from "@/features/topics/components/TopicsError";
import { HideTopicForm } from "@/features/topics/components/HideTopicForm";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { LinearGradient } from "expo-linear-gradient";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { PrimaryButton } from "@/components/PrimaryButton";
import { CARD_WIDTH, CARD_HEIGHT, width, DEFAULT_SEARCH_RADIUS, DEFAULT_PRICE_LEVELS } from "@/features/topics/constants";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLogger } from "@/hooks/useLogger";
import { makeDishMediaEntriesKey } from "@/features/dishMedia/utils/dishMediaEntriesKey";

export default function TopicsScreen() {
	const insets = useSafeAreaInsets();
	const locale = useLocale();
	const { searchParams } = useLocalSearchParams<{ searchParams: string }>();
	const params = useMemo(() => {
		if (searchParams) {
			try {
				return JSON.parse(searchParams) as SearchParams;
			} catch {
				return null;
			}
		}
		return null;
	}, [searchParams]);
	const { logFrontendEvent } = useLogger();
	const [isScrolling, setIsScrolling] = useState(false);
	const [currentIndex, setCurrentIndex] = useState(0);
	const carouselRef = useRef<any>(null);
	const { selectionChanged } = useHaptics();

	const { topics, isLoading, error, searchTopics, hideTopic, createDishItemsPromise } = useTopicSearch();
	const { showSnackbar } = useSnackbar();
	const {
		BlurModal: HideTopicBlurModal,
		close: closeHideModal,
		handleHideCard,
		confirmHideCard,
	} = useHideTopic(topics, hideTopic, showSnackbar);

	useEffect(() => {
		if (params) {
			searchTopics(params).catch(() => {
				showSnackbar(i18n.t("Topics.errors.fetchFailed"));
			});
		} else {
			showSnackbar(i18n.t("Topics.errors.invalidSearchParams"));
			router.back();
		}
	}, [params, searchTopics, showSnackbar, router]);

	const handleViewDetails = useCallback(
		(topic: Topic) => {
			// #633 【Blocker】params が undefined の場合は早期 return（クラッシュ防止）
			if (!params) {
				showSnackbar(i18n.t("Topics.errors.invalidSearchParams"));
				return;
			}

			// #633 【設計】SavedTopicsTab と同じパターンで entriesKey 駆動のオンデマンド取得
			const { mediaIdsByKey, isLoadingByKey, upsertDishMediaEntries, updateMediaIdsByKeyAsync } =
				useDishMediaEntriesStore.getState();

			// #633 【設計】entriesKey を生成（検索条件から一意のキーを作成）
			const entriesKey = makeDishMediaEntriesKey({
				categoryId: topic.categoryId,
				location: {
					latitude: params.location.latitude,
					longitude: params.location.longitude,
				},
				radius: DEFAULT_SEARCH_RADIUS, // #633 【設計】constants から参照（createDishItemsPromise と同じ）
				priceLevels: [...DEFAULT_PRICE_LEVELS], // #633 【設計】constants から参照（createDishItemsPromise と同じ）
				languageCode: params.localLanguageCode,
			});

			// #633 【設計】未取得 & 非ロード中の場合のみ fetch（重複実行を防止）
			if (mediaIdsByKey[entriesKey] === undefined && !isLoadingByKey[entriesKey]) {
				const getIds = async () => {
					const dishItems = await createDishItemsPromise(
						topic.categoryId,
						topic.category,
						params.location.latitude,
						params.location.longitude,
						params.localLanguageCode,
					);
					upsertDishMediaEntries(dishItems);
					return dishItems.map((item) => String(item.dish_media.id));
				};
				// #633 【設計】mergeFn を prev ?? fetched に変更（上書き事故を防止）
				updateMediaIdsByKeyAsync(entriesKey, getIds(), (prev, fetched) => prev ?? fetched);
			}

			router.push({
				pathname: "/[locale]/(tabs)/search/result",
				params: {
					locale,
					entriesKey, // #633 【設計】topicId ではなく entriesKey を渡す
					...(params && { location: JSON.stringify(params.location) }),
				},
			});
			// #633 【設計】分析基盤互換のため移行期間は topicId と entriesKey を併記
			logFrontendEvent({
				event_name: "topic_view_details",
				error_level: "log",
				payload: { topic_id: topic.categoryId, entries_key: entriesKey },
			});
		},
		[locale, params, createDishItemsPromise, logFrontendEvent, showSnackbar],
	);

	const handleBack = () => {
		router.back();
	};

	const visibleTopics = topics.filter((topic) => !topic.isHidden);

	// #615 visibleTopics 変化時に currentIndex を範囲内に clamp（範囲外アクセス防止）
	useEffect(() => {
		if (visibleTopics.length > 0 && currentIndex >= visibleTopics.length) {
			const newIndex = Math.max(0, visibleTopics.length - 1);
			setCurrentIndex(newIndex);
			// Carousel の表示位置も補正
			if (carouselRef.current) {
				carouselRef.current.scrollTo({ index: newIndex, animated: false });
			}
		}
		// @eslint-disable-next-line react-hooks/exhaustive-deps
	}, [visibleTopics.length]);

	const handleSnapToItem = (index: number) => {
		selectionChanged();
		setCurrentIndex(index);
	};

	const renderCard = ({ item }: { item: Topic }) => (
		<TopicCard key={item.categoryId} item={item} onHide={handleHideCard} />
	);

	if (isLoading) {
		return <TopicsLoading />;
	}

	if (error) {
		return <TopicsError error={error} onBack={handleBack} />;
	}

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<SafeAreaView style={styles.container} edges={["top"]}>
				{/* Header with Back Button */}
				<View style={[styles.backButtonContainer, { top: insets.top, right: insets.right }]}>
					<TouchableOpacity style={styles.backButton} onPress={handleBack}>
						<X size={24} color="#000" />
					</TouchableOpacity>
				</View>

				{/* Cards Carousel */}
				{visibleTopics.length > 0 ? (
					<View style={styles.carouselContainer}>
						<Carousel
							ref={carouselRef}
							width={CARD_WIDTH}
							height={CARD_HEIGHT}
							data={visibleTopics}
							renderItem={renderCard}
							onSnapToItem={handleSnapToItem}
							onScrollStart={() => setIsScrolling(true)}
							onScrollEnd={() => setIsScrolling(false)}
							mode="parallax"
							modeConfig={{
								parallaxScrollingScale: 0.9,
								parallaxScrollingOffset: 100,
							}}
							style={styles.carousel}
						/>
					</View>
				) : (
					<View style={styles.emptyContainer}>
						<View style={styles.emptyCard}>
							<Text style={styles.emptyText}>{i18n.t("Topics.empty")}</Text>
							<TouchableOpacity style={styles.retryButton} onPress={handleBack}>
								<Text style={styles.retryButtonText}>{i18n.t("Topics.retry")}</Text>
							</TouchableOpacity>
						</View>
					</View>
				)}

				{/* Page Indicator */}
				<View style={styles.pageIndicatorContainer}>
					{visibleTopics.map((_, index) => (
						<View
							key={index}
							style={[styles.pageIndicatorDot, currentIndex === index && styles.pageIndicatorDotActive]}
						/>
					))}
				</View>

				{/* Fixed Bottom Action Button */}
				{visibleTopics.length > 0 && (
					<View style={styles.bottomActionContainer}>
						<PrimaryButton
							label={i18n.t("Topics.chooseThis")}
							icon={<ThumbsUp size={20} color="#FFF" />}
							onPress={() => handleViewDetails(visibleTopics[currentIndex])}
							disabled={isScrolling || currentIndex >= visibleTopics.length}
						/>
					</View>
				)}

				{/* Hide Card Modal */}
				<HideTopicBlurModal>
					{({ close }) => (
						<HideTopicForm
							onSubmit={(hideReason) => {
								confirmHideCard(hideReason);
							}}
							onCancel={close}
						/>
					)}
				</HideTopicBlurModal>
			</SafeAreaView>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		justifyContent: "flex-start",
	},
	backButtonContainer: {
		position: "absolute",
		top: 0,
		right: 0,
		flexDirection: "row",
		alignItems: "center",
		padding: 16,
		zIndex: 10,
	},
	backButton: {
		padding: 8,
		borderRadius: 20,
		backgroundColor: "#FFFFFF",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.2,
		shadowRadius: 8,
		elevation: 4,
	},
	retryButton: {
		backgroundColor: "#5EA2FF",
		paddingHorizontal: 24,
		paddingVertical: 16,
		borderRadius: 16,
		shadowColor: "#5EA2FF",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 12,
		elevation: 6,
	},
	retryButtonText: {
		fontSize: 16,
		color: "#FFFFFF",
		fontWeight: "600",
		letterSpacing: 0.3,
	},
	carouselContainer: {
		justifyContent: "center",
		alignItems: "center",
	},
	carousel: {
		width: width,
	},
	pageIndicatorContainer: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		marginTop: -20,
		marginLeft: 20,
	},
	pageIndicatorDot: {
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: "rgba(255, 255, 255, 0.4)",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.3,
		shadowRadius: 1.5,
		elevation: 2,
	},
	pageIndicatorDotActive: {
		width: 16,
		borderRadius: 4,
		backgroundColor: "#5EA2FF",
		shadowColor: "#5EA2FF",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.5,
		shadowRadius: 3,
		elevation: 3,
	},
	bottomActionContainer: {
		position: "absolute",
		bottom: 20,
		left: 8,
		right: 8,
		zIndex: 10,
	},
	emptyContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 24,
	},
	emptyCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 24,
		padding: 32,
		alignItems: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 8 },
		shadowOpacity: 0.12,
		shadowRadius: 24,
		elevation: 8,
		width: "100%",
		maxWidth: 320,
	},
	emptyText: {
		fontSize: 18,
		color: "#6B7280",
		textAlign: "center",
		marginBottom: 24,
		lineHeight: 28,
		fontWeight: "500",
	},
});
