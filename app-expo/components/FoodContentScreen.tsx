import React, { useState, useRef } from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView, Dimensions, SafeAreaView } from "react-native";
import { Heart, Bookmark, Calendar, Share, Star, User, EllipsisVertical, MapPinned } from "lucide-react-native";
import { FoodItem } from "@/types";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useBlurModal } from "@/hooks/useBlurModal";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";

const { width, height } = Dimensions.get("window");

interface FoodContentScreenProps {
	item: FoodItem;
}

const formatLikeCount = (count: number): string => {
	if (count >= 1000000) {
		return (count / 1000000).toFixed(1).replace(/\.0$/, "") + i18n.t("FoodContentScreen.numberSuffix.million");
	}
	if (count >= 1000) {
		return (count / 1000).toFixed(1).replace(/\.0$/, "") + i18n.t("FoodContentScreen.numberSuffix.thousand");
	}
	return count.toString();
};

export default function FoodContentScreen({ item }: FoodContentScreenProps) {
	const [isSaved, setIsSaved] = useState(item.isSaved);
	const [isLiked, setIsLiked] = useState(item.isLiked);
	const [likesCount, setLikesCount] = useState(item.likes);
	const { BlurModal, open: openMenuModal, close: closeMenuModal } = useBlurModal({ intensity: 100 });
	const [commentLikes, setCommentLikes] = useState<{
		[key: string]: { isLiked: boolean; count: number };
	}>({});
	const scrollViewRef = useRef<ScrollView>(null);
	const { lightImpact, mediumImpact } = useHaptics();

	const handleCommentLike = (commentId: string) => {
		lightImpact();
		setCommentLikes((prev) => ({
			...prev,
			[commentId]: {
				isLiked: !prev[commentId]?.isLiked,
				count: prev[commentId]?.isLiked ? (prev[commentId]?.count || 0) - 1 : (prev[commentId]?.count || 0) + 1,
			},
		}));
	};

	const handleLike = () => {
		lightImpact();
		const willLike = !isLiked;
		setIsLiked(willLike);
		setLikesCount((prev) => (willLike ? prev + 1 : prev - 1));
	};

	const handleSave = () => {
		lightImpact();
		const willSave = !isSaved;
		setIsSaved(willSave);
	};

	const handleViewRestaurant = () => {
		lightImpact();
		router.push("/(tabs)/(home)/restaurant/1");
	};

	const handleViewCreator = () => {
		lightImpact();
		// Navigate to creator's profile
		router.push("/profile?userId=creator_123");
	};

	const handleMenuOpen = () => {
		lightImpact();
		openMenuModal();
	};

	const handleMenuOptionPress = (onPress: () => void) => {
		lightImpact();
		closeMenuModal();
		onPress();
	};

	const menuOptions = [
		{
			icon: User,
			label: i18n.t("FoodContentScreen.menuOptions.viewCreatorProfile"),
			onPress: handleViewCreator,
		},
		{
			icon: Calendar,
			label: i18n.t("FoodContentScreen.menuOptions.reservation"),
			onPress: () => console.log("Reservation"),
		},
	];

	const renderStars = (count: number, filled: number) => {
		return (
			<View style={styles.starsContainer}>
				{[...Array(count)].map((_, index) => (
					<Star key={index} size={16} color="#FFD700" fill={index < filled ? "#FFD700" : "transparent"} />
				))}
			</View>
		);
	};

	return (
		<SafeAreaView style={styles.container}>
			{/* Background Image */}
			<Image source={{ uri: item.image }} style={styles.backgroundImage} />

			{/* Top Header */}
			<View style={styles.topHeader}>
				<View style={styles.headerLeft}>
					<Text style={styles.menuName}>{item.name}</Text>
					<View style={styles.priceRatingContainer}>
                                                <Text style={styles.price}>{i18n.t("Search.currencySuffix")}2,800</Text>
						{/* <View style={styles.ratingContainer}>
              {renderStars(5, 4)}
              <Text style={styles.reviewCount}>(127)</Text>
            </View> */}
					</View>
					<View style={styles.priceRatingContainer}>
						<Text style={styles.price}>{i18n.t("FoodContentScreen.info.walkFromShibuya")}</Text>
					</View>
				</View>
				<View style={styles.headerRight}>
					{/* <TouchableOpacity
            style={styles.viewRestaurantButton}
            onPress={handleViewRestaurant}
          >
            <Text style={styles.viewRestaurantButtonText}>{i18n.t("FoodContentScreen.buttons.viewRestaurant")}</Text>
          </TouchableOpacity> */}
				</View>
			</View>

			{/* Comments Section */}
			<LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.6)"]} style={styles.commentsGradient}>
				<ScrollView
					ref={scrollViewRef}
					style={styles.commentsContainer}
					showsVerticalScrollIndicator={false}
					onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: false })}>
					{item.comments.map((comment) => {
						const commentLikeData = commentLikes[comment.id] || {
							isLiked: false,
							count: 0,
						};
						return (
							<View key={comment.id} style={styles.commentItem}>
								<View style={styles.commentHeader}>
									<Text style={styles.commentUsername}>{comment.username}</Text>
									<Text style={styles.commentTimestamp}>{comment.timestamp}</Text>
								</View>
								<View style={styles.commentContent}>
									<Text style={styles.commentText}>{comment.text}</Text>
									<View style={styles.commentActions}>
										<TouchableOpacity style={styles.commentLikeButton} onPress={() => handleCommentLike(comment.id)}>
											<Heart
												size={14}
												color={commentLikeData.isLiked ? "#FF3040" : "#CCCCCC"}
												fill={commentLikeData.isLiked ? "#FF3040" : "transparent"}
											/>
										</TouchableOpacity>
										{commentLikeData.count > 0 && <Text style={styles.commentLikeCount}>{commentLikeData.count}</Text>}
									</View>
								</View>
							</View>
						);
					})}
				</ScrollView>
			</LinearGradient>

			{/* Bottom Section */}
			<View pointerEvents="box-none" style={styles.bottomSection}>
				<View pointerEvents="box-none" style={styles.actionRow}>
					{/* Action Buttons */}
					<View style={styles.rightActions}>
						<TouchableOpacity style={styles.actionButton} onPress={() => handleViewRestaurant()}>
							<Image
								source={{
									uri: "https://images.pexels.com/photos/262978/pexels-photo-262978.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
								}}
								style={styles.restaurantAvatar}
								onError={() => console.log("Failed to load restaurant avatar")}
							/>
						</TouchableOpacity>

						<View style={styles.actionContainer}>
							<TouchableOpacity style={styles.actionButton} onPress={handleLike}>
								<Heart size={28} color={isLiked ? "#FF3040" : "#FFFFFF"} fill={isLiked ? "#FF3040" : "white"} />
							</TouchableOpacity>
							<Text style={styles.actionText}>{formatLikeCount(likesCount)}</Text>
						</View>

						<TouchableOpacity style={styles.actionButton} onPress={handleSave}>
							<Bookmark size={30} color={"transparent"} fill={isSaved ? "orange" : "white"} />
						</TouchableOpacity>

						<View style={styles.actionContainer}>
							<TouchableOpacity style={styles.actionButton} onPress={() => {}}>
								<Share size={28} color="#FFFFFF" />
							</TouchableOpacity>
							<Text style={styles.actionText}>{i18n.t("FoodContentScreen.actions.share")}</Text>
						</View>

						<View style={styles.actionContainer}>
							<TouchableOpacity style={styles.actionButton} onPress={() => {}}>
								<MapPinned size={28} color="#FFFFFF" />
							</TouchableOpacity>
						</View>

						{/* <TouchableOpacity
              style={styles.actionButton}
              onPress={handleMenuOpen}
            >
              <EllipsisVertical size={28} color="#FFFFFF" />
            </TouchableOpacity> */}
					</View>
				</View>
			</View>

			{/* Menu Modal */}
			<BlurModal animationType="fade" contentContainerStyle={styles.modalOverlay}>
				<View style={styles.menuContainer}>
					{menuOptions.map((option, index) => (
						<TouchableOpacity
							key={index}
							style={styles.menuItem}
							onPress={() => {
								option.onPress();
								closeMenuModal();
							}}>
							<option.icon size={20} color="#FFFFFF" />
							<Text style={styles.menuItemText}>{option.label}</Text>
						</TouchableOpacity>
					))}
				</View>
			</BlurModal>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#000",
	},
	backgroundImage: {
		position: "absolute",
		width: "100%",
		height: "100%",
		resizeMode: "cover",
	},
	topHeader: {
		position: "absolute",
		top: 60,
		left: 16,
		right: 16,
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "flex-start",
		zIndex: 10,
	},
	headerLeft: {
		flex: 1,
		marginRight: 16,
	},
	headerRight: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	menuName: {
		fontSize: 28,
		fontWeight: "700",
		color: "#FFFFFF",
		textShadowColor: "rgba(0, 0, 0, 0.5)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
		marginBottom: 4,
		letterSpacing: -0.5,
		lineHeight: 34,
	},
	priceRatingContainer: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
	},
	price: {
		fontSize: 20,
		fontWeight: "600",
		color: "#FFFFFF",
		textShadowColor: "rgba(0, 0, 0, 0.5)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
		letterSpacing: 0.2,
	},
	ratingContainer: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
	},
	starsContainer: {
		flexDirection: "row",
		gap: 2,
	},
	reviewCount: {
		fontSize: 16,
		color: "#FFFFFF",
		textShadowColor: "rgba(0, 0, 0, 0.5)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
		fontWeight: "500",
	},
	distanceContainer: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
	},
	distance: {
		fontSize: 20,
		fontWeight: "600",
		color: "#FFFFFF",
		textShadowColor: "rgba(0, 0, 0, 0.5)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
		letterSpacing: 0.2,
	},
	viewRestaurantButton: {
		backgroundColor: "rgba(255, 255, 255, 0.95)",
		paddingHorizontal: 16,
		paddingVertical: 10,
		borderRadius: 24,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.15,
		shadowRadius: 8,
		elevation: 4,
	},
	viewRestaurantButtonText: {
		fontSize: 15,
		fontWeight: "600",
		color: "#000",
		letterSpacing: 0.2,
	},
	commentsGradient: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		maxHeight: 200,
	},
	commentsContainer: {
		paddingHorizontal: 16,
		paddingVertical: 12,
		marginRight: 48,
	},
	commentItem: {
		marginBottom: 12,
	},
	commentHeader: {
		flexDirection: "row",
		alignItems: "center",
		marginBottom: 4,
	},
	commentUsername: {
		fontSize: 14,
		fontWeight: "600",
		color: "#FFFFFF",
		marginRight: 8,
		letterSpacing: 0.1,
	},
	commentTimestamp: {
		fontSize: 12,
		color: "#CCCCCC",
		fontWeight: "500",
	},
	commentContent: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "flex-start",
	},
	commentText: {
		fontSize: 14,
		color: "#FFFFFF",
		lineHeight: 20,
		flex: 1,
		marginRight: 8,
		fontWeight: "400",
	},
	commentActions: {
		flexDirection: "row",
		alignItems: "center",
	},
	commentLikeButton: {
		marginRight: 8,
		padding: 4,
	},
	commentLikeCount: {
		fontSize: 12,
		color: "#CCCCCC",
		fontWeight: "500",
	},
	bottomSection: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		paddingHorizontal: 16,
		paddingTop: 16,
		paddingBottom: 32,
	},
	actionRow: {
		flexDirection: "row",
		alignItems: "flex-end",
		justifyContent: "flex-end",
	},
	rightActions: {
		alignItems: "center",
		gap: 16,
	},
	restaurantAvatar: {
		width: 40,
		height: 40,
		borderRadius: 20,
	},
	actionContainer: {
		alignItems: "center",
	},
	actionButton: {
		padding: 4,
	},
	actionText: {
		fontSize: 13,
		fontWeight: "500",
		color: "#FFFFFF",
		marginTop: 4,
		letterSpacing: 0.2,
	},
	modalOverlay: {
		justifyContent: "center",
		alignItems: "center",
	},
	menuContainer: {
		backgroundColor: "rgba(0, 0, 0, 0.95)",
		borderRadius: 20,
		padding: 12,
		minWidth: 200,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 16,
		elevation: 8,
	},
	menuItem: {
		flexDirection: "row",
		alignItems: "center",
		paddingVertical: 16,
		paddingHorizontal: 16,
		borderRadius: 12,
	},
	menuItemText: {
		fontSize: 17,
		color: "#FFFFFF",
		marginLeft: 12,
		fontWeight: "500",
		letterSpacing: 0.2,
	},
});
