import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import { Heart } from "lucide-react-native";
import type { DishMediaEntry } from "@shared/api/v1/res";
import { formatLikeCount, sliceByUnitLimit } from "../utils/text";
import { dateStringToTimestamp } from "@/lib/frontend-utils";
import { useLogger } from "@/hooks/useLogger";
import { getRemoteConfig } from "@/lib/remoteConfig";
import { useHaptics } from "@/hooks/useHaptics";
import { toggleReaction } from "@/lib/reactions";
import i18n from "@/lib/i18n";

interface DishReviewsSectionProps {
	reviews: DishMediaEntry["dish_reviews"];
	paddingRight: number;
	carouselRef: React.RefObject<any> | undefined;
}

// コメントの表示のみを担当。状態変更は親側のコールバックに委譲
export function DishReviewsSection({ reviews, paddingRight, carouselRef }: DishReviewsSectionProps) {
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();

	// コメントを最下部までスクロールする
	const scrollViewRef = useRef<ScrollView>(null);
	useEffect(() => {
		scrollViewRef.current?.scrollToEnd({ animated: false });
	}, [reviews.length]);

	// State to track expanded characters count for each comment
	const [commentExpandedChars, setCommentExpandedChars] = useState(
		reviews.reduce(
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
	const handleSeeMore = (reviewId: string) => {
		lightImpact();
		const remoteConfig = getRemoteConfig();
		const charUnitIncrement = parseInt(remoteConfig?.v1_dish_comment_review_show_number!, 10);

		setCommentExpandedChars((prev) => ({
			...prev,
			[reviewId]: prev[reviewId] + charUnitIncrement,
		}));

		logFrontendEvent({
			event_name: "review_see_more_clicked",
			error_level: "log",
			payload: {
				reviewId,
				previousExpandedChars: commentExpandedChars[reviewId],
				newExpandedChars: commentExpandedChars[reviewId] + charUnitIncrement,
				unitIncrement: charUnitIncrement,
			},
		});
	};

	const [reviewLikes, setReviewLikes] = useState(
		reviews.reduce(
			(acc, review) => {
				acc[review.id] = { isLiked: review.isLiked, count: review.likeCount };
				return acc;
			},
			{} as { [key: string]: { isLiked: boolean; count: number } },
		),
	);
	const handleReviewLike = async (reviewId: string) => {
		lightImpact();
		const currentLikeState = reviewLikes[reviewId]?.isLiked || false;
		const willLike = !currentLikeState;

		setReviewLikes((prev) => ({
			...prev,
			[reviewId]: {
				isLiked: willLike,
				count: currentLikeState ? (prev[reviewId]?.count || 0) - 1 : (prev[reviewId]?.count || 0) + 1,
			},
		}));

		logFrontendEvent({
			event_name: currentLikeState ? "review_unliked" : "review_liked",
			error_level: "log",
			payload: {
				reviewId,
			},
		});

		try {
			await toggleReaction({
				target_type: "dish_reviews",
				target_id: reviewId,
				action_type: "like",
				willReact: willLike,
			});
		} catch (error) {
			// Revert state on error
			setReviewLikes((prev) => ({
				...prev,
				[reviewId]: {
					isLiked: currentLikeState,
					count: currentLikeState ? (prev[reviewId]?.count || 0) + 1 : (prev[reviewId]?.count || 0) - 1,
				},
			}));
			logFrontendEvent({
				event_name: "review_like_reaction_failed",
				error_level: "log",
				payload: {
					error: error instanceof Error ? error.message : String(error),
					target_id: reviewId,
					action_type: "like",
				},
			});
		}
	};

	return (
		<LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.6)"]} style={styles.commentsGradient}>
			<ScrollView
				ref={scrollViewRef}
				style={[styles.commentsContainer, { paddingRight }]}
				showsVerticalScrollIndicator={false}
				nestedScrollEnabled={Platform.OS === "android"}
				simultaneousHandlers={carouselRef}>
				{reviews.map((review) => {
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
												<Text style={styles.seeMoreText}>{i18n.t("DishMediaContent.actions.seeMore")}</Text>
											</TouchableOpacity>
										)}
									</Text>
								</View>
								<View style={styles.commentActions}>
									<TouchableOpacity style={styles.commentLikeButton} onPress={() => handleReviewLike(review.id)}>
										<Heart
											size={14}
											color={reviewLikes[review.id].isLiked ? "#FF3040" : "#CCCCCC"}
											fill={reviewLikes[review.id].isLiked ? "#FF3040" : "transparent"}
										/>
									</TouchableOpacity>
									{reviewLikes[review.id].count > 0 && (
										<Text style={styles.commentLikeCount}>{formatLikeCount(reviewLikes[review.id].count)}</Text>
									)}
								</View>
							</View>
						</View>
					);
				})}
			</ScrollView>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
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
});
