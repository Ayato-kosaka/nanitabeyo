import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { MapPin, Clock, Users, Salad, ChefHat } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import Carousel from "react-native-reanimated-carousel";
import { Image } from "expo-image";
import { Topic, SearchParams } from "@/types/search";
import { useTopicSearch } from "@/features/topics/hooks/useTopicSearch";
import { useHideTopic } from "@/features/topics/hooks/useHideTopic";
import { TopicCard } from "@/features/topics/components/TopicCard";
import { TopicsLoading } from "@/features/topics/components/TopicsLoading";
import { TopicsError } from "@/features/topics/components/TopicsError";
import { HideTopicForm } from "@/features/topics/components/HideTopicForm";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { CARD_WIDTH, CARD_MAX_HEIGHT, width as SCREEN_WIDTH } from "@/features/topics/constants";
import { timeSlots, sceneOptions, moodOptions, tasteOptions } from "@/features/search/constants";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { makeDishMediaEntriesKey } from "@/features/dishMedia/utils/dishMediaEntriesKey";
import { WIKIMEDIA_HEADERS } from "@/lib/wikimedia";
import { SearchHeader } from "@/features/search/components/SearchHeader";

export default function TopicsScreen() {
	const { locale } = useLocale();
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
				radius: params.distance,
				priceLevels: params.priceLevels,
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
						params.distance,
						params.priceLevels,
					);
					upsertDishMediaEntries(dishItems);
					console.log("getIds dishItems:", dishItems);
					return dishItems.map((item) => String(item.dish_media.id));
				};
				updateMediaIdsByKeyAsync(entriesKey, getIds(), (_, fetched) => fetched);
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
		// ログ追加【仕様】topic_swiped_next ログ送信（前のインデックスと異なる場合のみ）
		if (index !== currentIndex && index >= 0 && index < visibleTopics.length && currentIndex >= 0) {
			logFrontendEvent({
				event_name: "topic_swiped_next",
				error_level: "log",
				payload: {
					previous_index: currentIndex,
					new_index: index,
					previous_topic_id: visibleTopics[currentIndex]?.categoryId ?? null,
					new_topic_id: visibleTopics[index]?.categoryId ?? null,
				},
			});
		}
		setCurrentIndex(index);
	};

	// #674 【仕様】カードタップ時の処理（スクロール中は無視）
	const handleCardPress = useCallback(() => {
		if (isScrolling) return; // スクロール中はタップ無視
		if (currentIndex >= visibleTopics.length) return;
		handleViewDetails(visibleTopics[currentIndex]);
	}, [isScrolling, currentIndex, visibleTopics, handleViewDetails]);

	// #674 【仕様】サムネイルタップ時の処理
	const handleThumbnailPress = useCallback((index: number) => {
		if (carouselRef.current) {
			carouselRef.current.scrollTo({ index, animated: true });
		}
		setCurrentIndex(index);
	}, []);

	// カルーセルに使える「縦方向の空きスペース」を測る
	const [carouselAvailableHeight, setCarouselAvailableHeight] = useState(0);

	// ✅ 実際にカルーセルに渡す高さ：「空きの高さ」と「CARD_MAX_HEIGHT」の小さい方
	const cardHeight = useMemo(() => {
		if (carouselAvailableHeight <= 0) return 0;
		const heightWithMargin = carouselAvailableHeight;
		return Math.min(heightWithMargin, CARD_MAX_HEIGHT);
	}, [carouselAvailableHeight]);

	const renderCard = ({ item, index }: { item: Topic; index: number }) => (
		<TouchableOpacity key={item.categoryId} activeOpacity={0.95} onPress={handleCardPress}>
			<TopicCard item={item} onHide={handleHideCard} displayIndex={index} cardHeight={cardHeight} />
		</TouchableOpacity>
	);

	if (isLoading) {
		return <TopicsLoading />;
	}

	if (error) {
		return <TopicsError error={error} onBack={handleBack} />;
	}

	return (
		<View style={styles.container}>
			{/* #674 【仕様】ヘッダー（戻るボタン + タイトル） */}
			<SearchHeader title={i18n.t("Topics.headerTitle")} onPressBack={handleBack} />

			{/* #674 【仕様】条件チップ表示 */}
			{params && (
				<View style={styles.chipsContainer}>
					<View style={styles.chipRow}>
						{/* 場所 */}
						<View style={styles.conditionChip}>
							<MapPin size={14} color="#f05537" />
							<Text style={styles.conditionChipText}>{params.locationQuery}</Text>
						</View>

						{/* 時間帯 */}
						<View style={styles.conditionChip}>
							<Clock size={14} color="#f05537" />
							<Text style={styles.conditionChipText}>
								{i18n.t(timeSlots.find((s) => s.id === params.timeSlot)?.label || "")}
							</Text>
						</View>

						{/* 誰と行くか */}
						<View style={styles.conditionChip}>
							<Users size={14} color="#f05537" />
							<Text style={styles.conditionChipText}>
								{i18n.t(sceneOptions.find((s) => s.id === params.scene)?.label || "")}
							</Text>
						</View>
					</View>

					<View style={styles.chipRow}>
						{/* お腹の減り具合（mood が選択されている場合のみ） */}
						{params.mood && (
							<View style={styles.conditionChip}>
								<Salad size={14} color="#f05537" />
								<Text style={styles.conditionChipText}>
									{i18n.t(moodOptions.find((m) => m.id === params.mood)?.label || "")}
								</Text>
							</View>
						)}

						{/* 味の好み（taste が選択されている場合のみ） */}
						{params.taste && (
							<View style={styles.conditionChip}>
								<ChefHat size={14} color="#f05537" />
								<Text style={styles.conditionChipText}>
									{i18n.t(tasteOptions.find((t) => t.id === params.taste)?.label || "")}
								</Text>
							</View>
						)}
					</View>
				</View>
			)}

			{/* #674 【仕様】サブコピー */}
			<Text style={styles.subCopy}>{i18n.t("Topics.subCopy")}</Text>

			{/* 中央のメイン領域（カルーセル＋サムネイル） */}
			<View style={styles.main}>
				{/* 空き高さを onLayout で測って、カルーセル高さを決定 */}
				<View
					style={styles.carouselOuter}
					onLayout={(e) => {
						setCarouselAvailableHeight(e.nativeEvent.layout.height);
					}}>
					{visibleTopics.length > 0 ? (
						cardHeight > 0 && (
							<View style={styles.carouselContainer}>
								<Carousel
									ref={carouselRef}
									width={CARD_WIDTH}
									height={cardHeight}
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
						)
					) : (
						<View style={styles.emptyContainer}></View>
					)}
				</View>

				{/* ✅ 下部サムネイル：absolute ではなく通常フローの一番下 */}
				{visibleTopics.length > 0 && (
					<View style={styles.thumbnailGrid}>
						{visibleTopics.map((topic, index) => (
							<TouchableOpacity
								key={topic.categoryId}
								style={[styles.thumbnail, currentIndex === index && styles.thumbnailActive]}
								onPress={() => handleThumbnailPress(index)}
								activeOpacity={0.7}>
								<Image
									source={{ uri: topic.imageUrl, headers: WIKIMEDIA_HEADERS }}
									style={styles.thumbnailImage}
									contentFit="cover"
									cachePolicy="memory"
								/>
							</TouchableOpacity>
						))}
					</View>
				)}
			</View>

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
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#FFFFFF",
	},
	chipsContainer: {
		paddingHorizontal: 16,
		paddingVertical: 12,
		gap: 8,
	},
	chipRow: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 8,
	},
	conditionChip: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#FDEBE7",
		paddingHorizontal: 12,
		paddingVertical: 6,
		borderRadius: 24,
		gap: 4,
	},
	conditionChipText: {
		fontSize: 13,
		color: "#f05537",
		fontWeight: "500",
	},
	subCopy: {
		fontSize: 14,
		color: "#6B7280",
		textAlign: "center",
		paddingHorizontal: 20,
		lineHeight: 20,
	},
	retryButton: {
		backgroundColor: "#F05537",
		paddingHorizontal: 24,
		paddingVertical: 16,
		borderRadius: 16,
		shadowColor: "#F05537",
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
	// ✅ 中央コンテンツ全体（カルーセル + サムネ）
	main: {
		flex: 1,
	},
	// ✅ カルーセル用の空きスペース（ここが flex:1）
	carouselOuter: {
		flex: 1,
		justifyContent: "center",
	},
	carouselContainer: {
		justifyContent: "center",
		alignItems: "center",
	},
	carousel: {
		width: SCREEN_WIDTH,
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
	// 下部サムネイル（通常フローで一番下）
	thumbnailGrid: {
		paddingHorizontal: 16,
		paddingVertical: 12,
		flexDirection: "row",
		flexWrap: "wrap",
		justifyContent: "center",
		gap: 8,
	},
	thumbnail: {
		width: (SCREEN_WIDTH - 72) / 6, // 画面幅から余白を引いて3等分
		aspectRatio: 1, // 正方形
		borderRadius: 12,
		overflow: "hidden",
		borderWidth: 2,
		borderColor: "#C9C9C9",
		shadowColor: "#C9C9C9",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.3,
		shadowRadius: 4,
		elevation: 4,
	},
	thumbnailActive: {
		borderColor: "#f05537",
		shadowColor: "#f05537",
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
