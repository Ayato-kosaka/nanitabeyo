import React, { useState, useEffect, useRef } from "react";
import {
	View,
	Text,
	StyleSheet,
	Image,
	TouchableOpacity,
	SafeAreaView,
	Dimensions,
	Modal,
	TextInput,
	ActivityIndicator,
} from "react-native";
import { ThumbsUp, Trash, X, Sparkles } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import Carousel from "react-native-reanimated-carousel";
import { Topic, SearchParams } from "@/types/search";
import { useTopicSearch } from "@/features/topics/hoks/useTopicSearch";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { LinearGradient } from "expo-linear-gradient";
import { useSearchStore } from "@/stores/useSearchStore";
import { PrimaryButton } from "@/components/PrimaryButton";

const { width, height } = Dimensions.get("window");
const CARD_WIDTH = width - 32;
const CARD_HEIGHT = height * 0.85;

export default function TopicsScreen() {
	const { searchParams } = useLocalSearchParams<{ searchParams: string }>();
	const [currentIndex, setCurrentIndex] = useState(0);
	const [showHideModal, setShowHideModal] = useState(false);
	const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
	const [hideReason, setHideReason] = useState("");
	const carouselRef = useRef<any>(null);
	const setDishes = useSearchStore((state) => state.setDishes);

	const { topics, isLoading, error, searchTopics, hideTopic } = useTopicSearch();
	const { showSnackbar } = useSnackbar();

	useEffect(() => {
		if (searchParams) {
			try {
				const params: SearchParams = JSON.parse(searchParams);
				searchTopics(params).catch(() => {
					showSnackbar("料理の取得に失敗しました");
				});
			} catch (error) {
				showSnackbar("検索パラメータが無効です");
				router.back();
			}
		}
	}, [searchParams, searchTopics, showSnackbar]);

	const handleHideCard = (cardId: string) => {
		setSelectedCardId(cardId);
		setShowHideModal(true);
	};

	const confirmHideCard = () => {
		const selectedTopic = topics.find((topic) => topic.id === selectedCardId);
		if (selectedCardId && selectedTopic) {
			hideTopic(selectedCardId, hideReason);
			setShowHideModal(false);
			setHideReason("");
			setSelectedCardId(null);
			showSnackbar(`${selectedTopic?.topicTitle}を非表示にしました`);
		}
	};

	const handleViewDetails = (topic: Topic) => {
		setDishes(topic.id, topic.feedItems);
		router.push({
			pathname: "/(tabs)/search/result",
			params: {
				topicId: topic.id,
			},
		});
	};

	const handleBack = () => {
		router.back();
	};

	const visibleTopics = topics.filter((topic) => !topic.isHidden);

	const renderCard = ({ item }: { item: Topic }) => (
		<View style={styles.card}>
			<Image source={{ uri: item.imageUrl }} style={styles.cardImage} />

			{/* Content Overlay */}
			<View style={styles.cardOverlay}>
				{/* Hide Button */}
				<TouchableOpacity style={styles.hideButton} onPress={() => handleHideCard(item.id)}>
					<Trash size={18} color="#FFF" />
				</TouchableOpacity>

				{/* Content */}
				<View style={styles.cardContent}>
					<Text style={styles.cardTitle}>{item.topicTitle}</Text>
					<Text style={styles.cardDescription}>{item.reason}</Text>
				</View>
			</View>
		</View>
	);

	if (isLoading) {
		return (
			<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.loadingContainer}>
				<SafeAreaView style={styles.loadingContent}>
					<View style={styles.loadingCard}>
						<View style={styles.loadingIconContainer}>
							<Sparkles size={32} color="#5EA2FF" />
						</View>
						<ActivityIndicator size="large" color="#5EA2FF" style={styles.loadingSpinner} />
						<Text style={styles.loadingTitle}>あなたにぴったりの料理を探しています</Text>
						<Text style={styles.loadingSubtitle}>少々お待ちください...</Text>
					</View>
				</SafeAreaView>
			</LinearGradient>
		);
	}

	if (error) {
		return (
			<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.errorContainer}>
				<SafeAreaView style={styles.errorContent}>
					<View style={styles.errorCard}>
						<Text style={styles.errorText}>{error}</Text>
						<TouchableOpacity style={styles.retryButton} onPress={handleBack}>
							<Text style={styles.retryButtonText}>戻る</Text>
						</TouchableOpacity>
					</View>
				</SafeAreaView>
			</LinearGradient>
		);
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
						onSnapToItem={setCurrentIndex}
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
						<Text style={styles.emptyText}>表示できる料理がありません</Text>
						<TouchableOpacity style={styles.retryButton} onPress={handleBack}>
							<Text style={styles.retryButtonText}>検索に戻る</Text>
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
						label="気になる！"
						icon={<ThumbsUp size={20} color="#FFF" />}
						onPress={() => handleViewDetails(visibleTopics[currentIndex])}
					/>
				</View>
			)}

			{/* Hide Card Modal */}
			<Modal
				visible={showHideModal}
				transparent={true}
				animationType="fade"
				onRequestClose={() => setShowHideModal(false)}>
				<View style={styles.modalOverlay}>
					<View style={styles.modalContainer}>
						<View style={styles.modalHeader}>
							<Text style={styles.modalTitle}>非表示にする</Text>
							<TouchableOpacity onPress={() => setShowHideModal(false)}>
								<X size={24} color="#49454F" />
							</TouchableOpacity>
						</View>

						<Text style={styles.modalDescription}>非表示にする理由を教えてください（任意）</Text>

						<TextInput
							style={styles.reasonInput}
							placeholder="理由を入力してください..."
							value={hideReason}
							onChangeText={setHideReason}
							multiline
							numberOfLines={3}
							textAlignVertical="top"
							placeholderTextColor="#79747E"
						/>

						<View style={styles.modalActions}>
							<TouchableOpacity style={styles.cancelButton} onPress={() => setShowHideModal(false)}>
								<Text style={styles.cancelButtonText}>キャンセル</Text>
							</TouchableOpacity>
							<TouchableOpacity style={styles.confirmButton} onPress={confirmHideCard}>
								<Text style={styles.confirmButtonText}>非表示にする</Text>
							</TouchableOpacity>
						</View>
					</View>
				</View>
			</Modal>
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
	loadingContainer: {
		flex: 1,
	},
	loadingContent: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 32,
	},
	loadingCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 24,
		padding: 32,
		alignItems: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.15,
		shadowRadius: 16,
		elevation: 12,
		width: "100%",
		maxWidth: 320,
	},
	loadingIconContainer: {
		marginBottom: 16,
	},
	loadingSpinner: {
		marginBottom: 24,
	},
	loadingTitle: {
		fontSize: 18,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
		marginBottom: 8,
		letterSpacing: -0.3,
	},
	loadingSubtitle: {
		fontSize: 16,
		color: "#6B7280",
		textAlign: "center",
		fontWeight: "500",
	},
	errorContainer: {
		flex: 1,
	},
	errorContent: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 24,
	},
	errorCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 24,
		padding: 32,
		alignItems: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.15,
		shadowRadius: 16,
		elevation: 12,
		width: "100%",
		maxWidth: 320,
	},
	errorText: {
		fontSize: 16,
		color: "#EF4444",
		textAlign: "center",
		marginBottom: 24,
		lineHeight: 24,
		fontWeight: "500",
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
	card: {
		width: CARD_WIDTH,
		height: CARD_HEIGHT,
		borderRadius: 24,
		overflow: "hidden",
		borderWidth: 4,
		borderColor: "#fff",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 32,
		elevation: 12,
		position: "relative",
	},
	cardImage: {
		width: "100%",
		height: "100%",
		resizeMode: "cover",
	},
	cardOverlay: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		backgroundColor: "rgba(0, 0, 0, 0.1)",
		padding: 24,
		justifyContent: "space-between",
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

	hideButton: {
		alignSelf: "flex-end",
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "rgba(0, 0, 0, 0.3)",
		paddingHorizontal: 16,
		paddingVertical: 10,
		borderRadius: 20,
		gap: 6,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.3,
		shadowRadius: 4,
		elevation: 4,
	},
	hideButtonText: {
		fontSize: 14,
		color: "#FFF",
		fontWeight: "500",
	},
	cardContent: {
		flex: 1,
		justifyContent: "flex-end",
	},
	cardTitle: {
		fontSize: 32,
		fontWeight: "700",
		color: "#FFFFFF",
		marginBottom: 16,
		textShadowColor: "rgba(0, 0, 0, 0.8)",
		textShadowOffset: { width: 0, height: 2 },
		textShadowRadius: 4,
		lineHeight: 40,
		letterSpacing: -0.5,
	},
	cardDescription: {
		fontSize: 18,
		color: "#FFFFFF",
		lineHeight: 28,
		marginBottom: 16,
		textShadowColor: "rgba(0, 0, 0, 0.8)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 3,
		fontWeight: "500",
	},
	cardSearchText: {
		fontSize: 14,
		color: "#E0E0E0",
		marginBottom: 20,
		fontWeight: "500",
		textShadowColor: "rgba(0, 0, 0, 0.8)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 3,
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
		backgroundColor: "rgba(0, 0, 0, 0.6)",
		justifyContent: "center",
		alignItems: "center",
	},
	modalContainer: {
		backgroundColor: "#FFFFFF",
		borderRadius: 24,
		padding: 24,
		width: width - 48,
		maxWidth: 400,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 24,
		elevation: 12,
	},
	modalHeader: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		marginBottom: 16,
	},
	modalTitle: {
		fontSize: 22,
		fontWeight: "700",
		color: "#1C1B1F",
		letterSpacing: -0.3,
	},
	modalDescription: {
		fontSize: 16,
		color: "#49454F",
		marginBottom: 16,
		lineHeight: 24,
		fontWeight: "500",
	},
	reasonInput: {
		borderWidth: 1,
		borderColor: "#E5E7EB",
		borderRadius: 16,
		paddingHorizontal: 16,
		paddingVertical: 16,
		fontSize: 16,
		color: "#1C1B1F",
		backgroundColor: "#FFFFFF",
		minHeight: 100,
		marginBottom: 24,
		textAlignVertical: "top",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.05,
		shadowRadius: 2,
		elevation: 1,
	},
	modalActions: {
		flexDirection: "row",
		gap: 12,
	},
	cancelButton: {
		flex: 1,
		paddingVertical: 16,
		borderRadius: 16,
		alignItems: "center",
		backgroundColor: "#F8F9FA",
		shadowColor: "#F8F9FA",
		shadowOffset: { width: 0, height: 0 },
		shadowRadius: 10,
		elevation: 6,
	},
	cancelButtonText: {
		fontSize: 16,
		color: "#6B7280",
		fontWeight: "600",
	},
	confirmButton: {
		flex: 1,
		backgroundColor: "#EF4444",
		paddingVertical: 16,
		borderRadius: 16,
		alignItems: "center",
		shadowColor: "#EF4444",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.4,
		shadowRadius: 10,
		elevation: 6,
	},
	confirmButtonText: {
		fontSize: 16,
		color: "#FFFFFF",
		fontWeight: "600",
	},
});
