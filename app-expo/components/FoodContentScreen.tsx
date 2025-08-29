import React, { useState, useRef, useEffect } from "react";
import {
	View,
	Text,
	StyleSheet,
	Image,
	TouchableOpacity,
	Dimensions,
	SafeAreaView,
	Alert,
	Platform,
} from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { Heart, Bookmark, Calendar, Share, Star, User, EllipsisVertical, MapPinned } from "lucide-react-native";
import { useRouter, usePathname } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import * as Linking from "expo-linking";
import { useBlurModal } from "@/hooks/useBlurModal";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import type { DishMediaEntry } from "@shared/api/v1/res";
import { dateStringToTimestamp } from "@/lib/frontend-utils";
import { getRemoteConfig } from "@/lib/remoteConfig";
import { toggleReaction } from "@/lib/reactions";
import { generateShareUrl, handleShare } from "@/lib/share";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width, height } = Dimensions.get("window");

interface FoodContentScreenProps {
	item: DishMediaEntry;
	carouselRef?: React.RefObject<any>;
}

// Helper: treat full-width (CJK / > 0xFF) as 2 units like Twitter
const isFullWidthChar = (ch: string) => {
	const code = ch.charCodeAt(0);
	return code > 0xff; // simple heuristic
};

// Return substring fitting within unitLimit (FW=2, others=1)
const sliceByUnitLimit = (text: string, unitLimit: number) => {
	let units = 0;
	let i = 0;
	while (i < text.length) {
		const add = isFullWidthChar(text[i]) ? 2 : 1;
		if (units + add > unitLimit) break;
		units += add;
		i++;
	}
	return {
		substring: text.slice(0, i),
		isTruncated: i < text.length,
		usedUnits: units,
	};
};

const formatLikeCount = (count: number): string => {
	if (count >= 1000000) {
		return (count / 1000000).toFixed(1).replace(/\.0$/, "") + i18n.t("FoodContentScreen.numberSuffix.million");
	}
	if (count >= 1000) {
		return (count / 1000).toFixed(1).replace(/\.0$/, "") + i18n.t("FoodContentScreen.numberSuffix.thousand");
	}
	return count.toString();
};

export default function FoodContentScreen({ item, carouselRef }: FoodContentScreenProps) {
	const [isSaved, setIsSaved] = useState(item.dish_media.isSaved);
	const [isLiked, setIsLiked] = useState(item.dish_media.isLiked);
	const [likesCount, setLikesCount] = useState(item.dish_media.likeCount);
	const { BlurModal, open: openMenuModal, close: closeMenuModal } = useBlurModal({ intensity: 100 });
	const [commentLikes, setCommentLikes] = useState(
		item.dish_reviews.reduce(
			(acc, review) => {
				acc[review.id] = { isLiked: false, count: review.likeCount };
				return acc;
			},
			{} as { [key: string]: { isLiked: boolean; count: number } },
		),
	);
	// State to track expanded characters count for each comment
	const [commentExpandedChars, setCommentExpandedChars] = useState(
		item.dish_reviews.reduce(
			(acc, review) => {
				const remoteConfig = getRemoteConfig();
				const charLimit = parseInt(remoteConfig?.v1_dish_comment_review_show_number!, 10);
				// Interpret as unit limit (FW=2, half=1)
				acc[review.id] = charLimit;
				return acc;
			},
			{} as { [key: string]: number },
		),
	);
	const scrollViewRef = useRef<ScrollView>(null);
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const router = useRouter();
	const locale = useLocale();
	const insets = useSafeAreaInsets();
	const [rightActionsWidth, setRightActionsWidth] = useState(0);

	useEffect(() => {
		scrollViewRef.current?.scrollToEnd({ animated: false });
	}, [item.dish_reviews.length]);

	const handleCommentLike = async (commentId: string) => {
		lightImpact();
		const currentLikeState = commentLikes[commentId]?.isLiked || false;
		const willLike = !currentLikeState;

		setCommentLikes((prev) => ({
			...prev,
			[commentId]: {
				isLiked: willLike,
				count: currentLikeState ? (prev[commentId]?.count || 0) - 1 : (prev[commentId]?.count || 0) + 1,
			},
		}));

		logFrontendEvent({
			event_name: currentLikeState ? "comment_unliked" : "comment_liked",
			error_level: "log",
			payload: {
				commentId,
				dishId: item.dish_media.id,
				restaurantId: item.restaurant.id,
			},
		});

		try {
			await toggleReaction({
				target_type: "dish_reviews",
				target_id: commentId,
				action_type: "like",
				willReact: willLike,
			});
		} catch (error) {
			// Revert state on error
			setCommentLikes((prev) => ({
				...prev,
				[commentId]: {
					isLiked: currentLikeState,
					count: currentLikeState ? (prev[commentId]?.count || 0) + 1 : (prev[commentId]?.count || 0) - 1,
				},
			}));
			logFrontendEvent({
				event_name: "comment_like_reaction_failed",
				error_level: "log",
				payload: {
					error: error instanceof Error ? error.message : String(error),
					target_id: commentId,
					action_type: "like",
				},
			});
		}
	};

	const handleSeeMore = (commentId: string) => {
		lightImpact();
		const remoteConfig = getRemoteConfig();
		const charUnitIncrement = parseInt(remoteConfig?.v1_dish_comment_review_show_number!, 10);

		setCommentExpandedChars((prev) => ({
			...prev,
			[commentId]: prev[commentId] + charUnitIncrement,
		}));

		logFrontendEvent({
			event_name: "comment_see_more_clicked",
			error_level: "log",
			payload: {
				commentId,
				dishId: item.dish_media.id,
				restaurantId: item.restaurant.id,
				previousExpandedChars: commentExpandedChars[commentId],
				newExpandedChars: commentExpandedChars[commentId] + charUnitIncrement,
				unitIncrement: charUnitIncrement,
			},
		});
	};

	const handleLike = async () => {
		lightImpact();
		const willLike = !isLiked;
		setIsLiked(willLike);
		setLikesCount((prev) => (willLike ? prev + 1 : prev - 1));

		logFrontendEvent({
			event_name: willLike ? "dish_liked" : "dish_unliked",
			error_level: "log",
			payload: {
				dishId: item.dish_media.id,
				restaurantId: item.restaurant.id,
				previousLikeCount: likesCount,
				newLikeCount: willLike ? likesCount + 1 : likesCount - 1,
			},
		});

		try {
			await toggleReaction({
				target_type: "dish_media",
				target_id: item.dish_media.id,
				action_type: "like",
				willReact: willLike,
			});
		} catch (error) {
			// Revert state on error
			setIsLiked(!willLike);
			setLikesCount((prev) => (willLike ? prev - 1 : prev + 1));
			logFrontendEvent({
				event_name: "dish_like_reaction_failed",
				error_level: "log",
				payload: {
					error: error instanceof Error ? error.message : String(error),
					target_id: item.dish_media.id,
					action_type: "like",
					willReact: willLike,
				},
			});
		}
	};

	const handleSave = async () => {
		lightImpact();
		const willSave = !isSaved;
		setIsSaved(willSave);

		logFrontendEvent({
			event_name: willSave ? "dish_saved" : "dish_unsaved",
			error_level: "log",
			payload: {
				dishId: item.dish_media.id,
				restaurantId: item.restaurant.id,
			},
		});

		try {
			await toggleReaction({
				target_type: "dish_media",
				target_id: item.dish_media.id,
				action_type: "save",
				willReact: willSave,
			});
		} catch (error) {
			// Revert state on error
			setIsSaved(!willSave);
			logFrontendEvent({
				event_name: "dish_save_reaction_failed",
				error_level: "log",
				payload: {
					error: error instanceof Error ? error.message : String(error),
					target_id: item.dish_media.id,
					action_type: "save",
					willReact: willSave,
				},
			});
		}
	};

	const handleViewRestaurant = () => {
		lightImpact();
		// router.push("/(tabs)/(home)/restaurant/1");

		logFrontendEvent({
			event_name: "restaurant_view_clicked",
			error_level: "log",
			payload: {
				restaurantId: item.restaurant.id,
				restaurantName: item.restaurant.name,
				fromDishMediaId: item.dish_media.id,
			},
		});
	};

	const handleViewCreator = () => {
		lightImpact();
		// Navigate to creator's profile
		router.push({
			pathname: `/[locale]/profile`,
			params: {
				locale,
				userId: "123",
			},
		});

		logFrontendEvent({
			event_name: "creator_profile_clicked",
			error_level: "log",
			payload: {
				creatorUserId: "123",
				fromDishId: item.dish_media.id,
				restaurantId: item.restaurant.id,
			},
		});
	};

	const handleMenuOpen = () => {
		lightImpact();
		openMenuModal();

		logFrontendEvent({
			event_name: "dish_menu_opened",
			error_level: "log",
			payload: {
				dishId: item.dish_media.id,
				restaurantId: item.restaurant.id,
			},
		});
	};

	const handleMapPinPress = async () => {
		lightImpact();

		logFrontendEvent({
			event_name: "map_pin_clicked",
			error_level: "log",
			payload: {
				restaurantId: item.restaurant.id,
				restaurantName: item.restaurant.name,
				googlePlaceId: item.restaurant.google_place_id,
				fromDishId: item.dish_media.id,
			},
		});

		const placeId = item.restaurant.google_place_id;
		if (!placeId) {
			Alert.alert(i18n.t("Common.error"), i18n.t("FoodContentScreen.errors.mapOpenFailed"));
			return;
		}

		try {
			const mapUrl = `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}&query=${encodeURIComponent(item.restaurant.name || "")}`;

			if (Platform.OS === "web") {
				window.open(mapUrl, "_blank", "noopener,noreferrer"); // 別タブで開く
				return;
			}

			const canOpen = await Linking.canOpenURL(mapUrl);

			if (canOpen) {
				await Linking.openURL(mapUrl);
			} else {
				Alert.alert(i18n.t("Common.error"), i18n.t("FoodContentScreen.errors.mapOpenFailed"));
			}
		} catch (error) {
			Alert.alert(i18n.t("Common.error"), i18n.t("FoodContentScreen.errors.mapOpenFailed"));

			logFrontendEvent({
				event_name: "map_pin_open_failed",
				error_level: "error",
				payload: {
					restaurantId: item.restaurant.id,
					googlePlaceId: item.restaurant.google_place_id,
					error: error instanceof Error ? error.message : "Unknown error",
				},
			});
		}
	};

	const handleMenuOptionPress = (onPress: () => void) => {
		lightImpact();
		closeMenuModal();
		onPress();

		logFrontendEvent({
			event_name: "dish_menu_option_selected",
			error_level: "log",
			payload: {
				dishId: item.dish_media.id,
				restaurantId: item.restaurant.id,
			},
		});
	};

	const pathname = usePathname();

	const handleSharePress = async () => {
		lightImpact();

		try {
			const shareUrl = generateShareUrl(pathname);

			logFrontendEvent({
				event_name: "dish_share_attempted",
				error_level: "log",
				payload: {
					dishId: item.dish_media.id,
					restaurantId: item.restaurant.id,
					shareUrl,
				},
			});

			await handleShare(
				shareUrl,
				i18n.t("FoodContentScreen.share.title", { dishName: item.restaurant.name }),
				() => {
					// Success callback
					logFrontendEvent({
						event_name: "dish_share_success",
						error_level: "log",
						payload: {
							dishId: item.dish_media.id,
							restaurantId: item.restaurant.id,
							shareUrl,
						},
					});
				},
				(error) => {
					// Error callback
					logFrontendEvent({
						event_name: "dish_share_failed",
						error_level: "error",
						payload: {
							dishId: item.dish_media.id,
							restaurantId: item.restaurant.id,
							shareUrl,
							error,
						},
					});
				},
			);
		} catch (error) {
			logFrontendEvent({
				event_name: "dish_share_error",
				error_level: "error",
				payload: {
					dishId: item.dish_media.id,
					restaurantId: item.restaurant.id,
					error: error instanceof Error ? error.message : "Unknown error",
				},
			});
		}
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

	return (
		<SafeAreaView style={styles.container}>
			{/* Background Image */}
			<Image source={{ uri: item.dish_media.mediaUrl }} style={styles.backgroundImage} />

			{/* Top Header */}
			<View style={styles.topHeader}>
				<View style={styles.headerLeft}>
					<Text style={styles.menuName}>{item.restaurant.name}</Text>
					<View style={styles.priceRatingContainer}>
						{/* <Text style={styles.price}>{i18n.t("Search.currencySuffix")}2,800</Text> */}
						{/* <View style={styles.ratingContainer}>
              {renderStars(5, 4)}
              <Text style={styles.reviewCount}>(127)</Text>
            </View> */}
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
					style={[styles.commentsContainer, { paddingRight: Math.max(16, rightActionsWidth + insets.right + 8) }]}
					showsVerticalScrollIndicator={false}
					nestedScrollEnabled={Platform.OS === "android"}
					simultaneousHandlers={carouselRef}>
					{item.dish_reviews.map((review) => {
						const unitLimit = commentExpandedChars[review.id]!;
						const { substring, isTruncated } = sliceByUnitLimit(review.comment, unitLimit);
						const displayText = substring;

						return (
							<View key={review.id} style={styles.commentItem}>
								<View style={styles.commentHeader}>
									<Text style={styles.commentUsername}>{review.username}</Text>
									<Text style={styles.commentTimestamp}>{dateStringToTimestamp(review.created_at)}</Text>
								</View>
								<View style={styles.commentContent}>
									<View style={styles.commentTextContainer}>
										<Text style={styles.commentText}>
											{displayText}
											{isTruncated && "...  "}
											{isTruncated && (
												<TouchableOpacity style={styles.seeMoreButton} onPress={() => handleSeeMore(review.id)}>
													<Text style={styles.seeMoreText}>{i18n.t("FoodContentScreen.actions.seeMore")}</Text>
												</TouchableOpacity>
											)}
										</Text>
									</View>
									<View style={styles.commentActions}>
										<TouchableOpacity style={styles.commentLikeButton} onPress={() => handleCommentLike(review.id)}>
											<Heart
												size={14}
												color={commentLikes[review.id].isLiked ? "#FF3040" : "#CCCCCC"}
												fill={commentLikes[review.id].isLiked ? "#FF3040" : "transparent"}
											/>
										</TouchableOpacity>
										{commentLikes[review.id].count > 0 && (
											<Text style={styles.commentLikeCount}>{formatLikeCount(commentLikes[review.id].count)}</Text>
										)}
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
					<View style={styles.rightActions} onLayout={(e) => setRightActionsWidth(e.nativeEvent.layout.width)}>
						<TouchableOpacity style={styles.actionButton} onPress={() => handleViewRestaurant()}>
							<Image
								source={{
									uri: item.restaurant.image_url,
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
							<TouchableOpacity style={styles.actionButton} onPress={handleSharePress}>
								<Share size={28} color="#FFFFFF" />
							</TouchableOpacity>
							<Text style={styles.actionText}>{i18n.t("FoodContentScreen.actions.share")}</Text>
						</View>

						<View style={styles.actionContainer}>
							<TouchableOpacity style={styles.actionButton} onPress={handleMapPinPress}>
								<MapPinned size={28} color="#FFFFFF" />
							</TouchableOpacity>
							<Text style={styles.actionText}>{i18n.t("FoodContentScreen.actions.openMap")}</Text>
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
			<BlurModal contentContainerStyle={styles.modalOverlay}>
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
	commentTextContainer: {
		flex: 1,
		marginRight: 8,
	},
	commentText: {
		fontSize: 14,
		color: "#FFFFFF",
		lineHeight: 20,
		fontWeight: "400",
	},
	seeMoreButton: {},
	seeMoreText: {
		fontSize: 12,
		color: "#CCCCCC",
		fontWeight: "500",
	},
	commentActions: {
		alignItems: "center",
		width: 18,
	},
	commentLikeButton: {
		paddingVertical: 4,
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
