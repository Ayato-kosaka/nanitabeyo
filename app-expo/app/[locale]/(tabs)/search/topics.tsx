import React, { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { ThumbsUp, X } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import Carousel from "react-native-reanimated-carousel";
import { Topic, SearchParams } from "@/types/search";
import { useTopicSearch } from "@/features/topics/hoks/useTopicSearch";
import { useHideTopic } from "@/features/topics/hooks/useHideTopic";
import { TopicCard } from "@/features/topics/components/TopicCard";
import { TopicsLoading } from "@/features/topics/components/TopicsLoading";
import { TopicsError } from "@/features/topics/components/TopicsError";
import { HideTopicModal } from "@/features/topics/components/HideTopicModal";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { LinearGradient } from "expo-linear-gradient";
import { useSearchStore } from "@/stores/useSearchStore";
import { PrimaryButton } from "@/components/PrimaryButton";
import { CARD_WIDTH, CARD_HEIGHT, width } from "@/features/topics/constants";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";

export default function TopicsScreen() {
	const locale = useLocale();
	const { searchParams } = useLocalSearchParams<{ searchParams: string }>();
	const [currentIndex, setCurrentIndex] = useState(0);
	const carouselRef = useRef<any>(null);
	const setDishes = useSearchStore((state) => state.setDishes);
	const { selectionChanged } = useHaptics();

	const { topics, isLoading, error, searchTopics, hideTopic } = useTopicSearch();
	const { showSnackbar } = useSnackbar();
	const {
		BlurModal: HideTopicBlurModal,
		close: closeHideModal,
		hideReason,
		setHideReason,
		handleHideCard,
		confirmHideCard,
	} = useHideTopic(topics, hideTopic, showSnackbar);

	useEffect(() => {
		if (searchParams) {
			try {
				const params: SearchParams = JSON.parse(searchParams);
				searchTopics(params).catch(() => {
					showSnackbar(i18n.t("Topics.errors.fetchFailed"));
				});
			} catch (error) {
				showSnackbar(i18n.t("Topics.errors.invalidSearchParams"));
				router.back();
			}
		}
	}, [searchParams, searchTopics, showSnackbar]);

	const handleViewDetails = (topic: Topic) => {
		setDishes(topic.id, topic.feedItems);
		router.push({
			pathname: "/[locale]/(tabs)/search/result",
			params: {
				locale,
				topicId: topic.id,
			},
		});
	};

	const handleBack = () => {
		router.back();
	};

	const visibleTopics = topics.filter((topic) => !topic.isHidden);

	const handleSnapToItem = (index: number) => {
		selectionChanged();
		setCurrentIndex(index);
	};

	const renderCard = ({ item }: { item: Topic }) => <TopicCard item={item} onHide={handleHideCard} />;

	if (isLoading) {
		return <TopicsLoading />;
	}

	if (error) {
		return <TopicsError error={error} onBack={handleBack} />;
	}

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			{/* Header with Back Button */}
			<View style={styles.backButtonContainer}>
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
					/>
				</View>
			)}

			{/* Hide Card Modal */}
			<HideTopicBlurModal animationType="fade" contentContainerStyle={styles.modalOverlay}>
				<HideTopicModal
					onClose={closeHideModal}
					hideReason={hideReason}
					setHideReason={setHideReason}
					confirmHideCard={confirmHideCard}
				/>
			</HideTopicBlurModal>
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
		marginHorizontal: 20,
		marginVertical: 8,
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
	modalOverlay: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
});
