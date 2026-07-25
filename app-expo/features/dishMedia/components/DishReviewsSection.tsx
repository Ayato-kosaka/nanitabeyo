import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import { Heart } from "lucide-react-native";
import Stars from "@/components/Stars";
import { formatLikeCount, sliceByUnitLimit } from "../utils/text";
import { dateStringToTimestamp } from "@/lib/frontend-utils";
import { useLogger } from "@/hooks/useLogger";
import { getRemoteConfig } from "@/lib/remoteConfig";
import { useHaptics } from "@/hooks/useHaptics";
import { useAPICall } from "@/hooks/useAPICall";
import i18n from "@/lib/i18n";
import {
	DishMediaEntriesStore,
	selectReviewsByMediaId,
	selectReviewByReviewId,
	useDishMediaEntriesStore,
	IdType,
} from "@/stores/useDishMediaEntriesStore";
import { shallow } from "zustand/shallow";

interface DishReviewsSectionProps {
	id: string;
	idType: IdType;
	paddingRight: number;
	carouselRef: React.RefObject<any> | undefined;
}

// コメントの表示のみを担当。状態変更は親側のコールバックに委譲
export function DishReviewsSection({ id, idType, paddingRight, carouselRef }: DishReviewsSectionProps) {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();

	const selector = useCallback(
		(state: DishMediaEntriesStore) => {
			// idType に応じて適切なセレクタを使用
			if (idType === "dish_media") {
				return selectReviewsByMediaId(id)(state);
			} else {
				// dish_reviews の場合は単一のレビューを配列で返す
				const review = selectReviewByReviewId(id)(state);
				return review ? [review] : [];
			}
		},
		[id, idType],
	);
	const reviews = useDishMediaEntriesStore(selector, shallow);

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

	const handleReviewLike = async (reviewId: string) => {
		lightImpact();
		const { reviewsByReviewId, updateReview } = useDishMediaEntriesStore.getState();
		const review = reviewsByReviewId[reviewId];
		if (!review) return;
		const currentLikeState = review.isLiked || false;
		const willLike = !currentLikeState;
		let newLikeCount = willLike ? review.likeCount + 1 : Math.max(0, review.likeCount - 1);
		updateReview(review.id, (r) => ({
			...r,
			isLiked: willLike,
			likeCount: newLikeCount,
		}));

		logFrontendEvent({
			event_name: currentLikeState ? "review_unliked" : "review_liked",
			error_level: "log",
			payload: {
				reviewId: review.id,
			},
		});

		try {
			if (willLike) {
				await callBackend<{}, void>(`v1/dish-reviews/${review.id}/likes`, {
					method: "POST",
					requestPayload: {},
				});
			} else {
				await callBackend<{}, void>(`v1/dish-reviews/${review.id}/likes`, {
					method: "DELETE",
					requestPayload: {},
				});
			}
		} catch (error) {
			logFrontendEvent({
				event_name: "review_like_reaction_failed",
				error_level: "log",
				payload: {
					error: error instanceof Error ? error.message : String(error),
					target_id: review.id,
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
				{reviews.map((review, index) => {
					const unitLimit = commentExpandedChars[review.id]!;
					const { substring, isTruncated } = sliceByUnitLimit(review.comment, unitLimit);
					const displayText = substring;

					return (
						<View key={review.id} style={styles.commentItem}>
							<View style={styles.commentHeader}>
								<Text style={styles.commentUsername}>{review.username}</Text>
								{/* #956 【仕様】口コミごとの評価分布を判断できるよう、投稿時のratingを星で表示する */}
								<Stars rating={review.rating} size={11} />
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
											color={review.isLiked ? "#FF3040" : "#CCCCCC"}
											fill={review.isLiked ? "#FF3040" : "transparent"}
										/>
									</TouchableOpacity>
									{review.likeCount > 0 && (
										<Text style={styles.commentLikeCount}>{formatLikeCount(review.likeCount)}</Text>
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
