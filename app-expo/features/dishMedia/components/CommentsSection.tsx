import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import { Heart } from "lucide-react-native";
import type { DishMediaEntry } from "@shared/api/v1/res";
import { dateStringToTimestamp } from "../utils/dates";
import { formatLikeCount, sliceByUnitLimit, Translate } from "../utils/text";

type CommentLikeState = {
        isLiked: boolean;
        count: number;
};

interface CommentsSectionProps {
        reviews: DishMediaEntry["dish_reviews"];
        expandedUnits: Record<string, number>;
        likesState: Record<string, CommentLikeState>;
        paddingRight: number;
        scrollViewRef: React.RefObject<ScrollView>;
        carouselRef?: React.RefObject<any>;
        onSeeMore: (commentId: string) => void;
        onToggleLike: (commentId: string) => void;
        t: Translate;
}

type DishReview = DishMediaEntry["dish_reviews"][number];

// コメントの表示のみを担当。状態変更は親側のコールバックに委譲
const CommentsSection: React.FC<CommentsSectionProps> = ({
        reviews,
        expandedUnits,
        likesState,
        paddingRight,
        scrollViewRef,
        carouselRef,
        onSeeMore,
        onToggleLike,
        t,
}) => {
        return (
                <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.6)"]} style={styles.commentsGradient}>
                        <ScrollView
                                ref={scrollViewRef}
                                style={[styles.commentsContainer, { paddingRight }]}
                                showsVerticalScrollIndicator={false}
                                nestedScrollEnabled={Platform.OS === "android"}
                                simultaneousHandlers={carouselRef}
                        >
                                {reviews.map((review: DishReview) => {
                                        const unitLimit = expandedUnits[review.id] ?? 0;
                                        const { substring, isTruncated } = sliceByUnitLimit(review.comment, unitLimit);
                                        const likeState = likesState[review.id];
                                        const likeCountText =
                                                likeState && likeState.count > 0
                                                        ? formatLikeCount(likeState.count, t)
                                                        : null;

                                        return (
                                                <View key={review.id} style={styles.commentItem}>
                                                        <View style={styles.commentHeader}>
                                                                <Text style={styles.commentUsername}>{review.username}</Text>
                                                                <Text style={styles.commentTimestamp}>
                                                                        {dateStringToTimestamp(review.created_at)}
                                                                </Text>
                                                        </View>
                                                        <View style={styles.commentContent}>
                                                                <View style={styles.commentTextContainer}>
                                                                        <Text style={styles.commentText}>
                                                                                {substring}
                                                                                {isTruncated && "...  "}
                                                                                {isTruncated && (
                                                                                        <TouchableOpacity
                                                                                                style={styles.seeMoreButton}
                                                                                                onPress={() => onSeeMore(review.id)}
                                                                                        >
                                                                                                <Text style={styles.seeMoreText}>
                                                                                                        {t("DishMediaContent.actions.seeMore")}
                                                                                                </Text>
                                                                                        </TouchableOpacity>
                                                                                )}
                                                                        </Text>
                                                                </View>
                                                                <View style={styles.commentActions}>
                                                                        <TouchableOpacity
                                                                                style={styles.commentLikeButton}
                                                                                onPress={() => onToggleLike(review.id)}
                                                                        >
                                                                                <Heart
                                                                                        size={14}
                                                                                        color={likeState?.isLiked ? "#FF3040" : "#CCCCCC"}
                                                                                        fill={likeState?.isLiked ? "#FF3040" : "transparent"}
                                                                                />
                                                                        </TouchableOpacity>
                                                                        {likeCountText && (
                                                                                <Text style={styles.commentLikeCount}>{likeCountText}</Text>
                                                                        )}
                                                                </View>
                                                        </View>
                                                </View>
                                        );
                                })}
                        </ScrollView>
                </LinearGradient>
        );
};

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

export default CommentsSection;
