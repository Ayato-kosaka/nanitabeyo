import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform } from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { Calendar, User } from "lucide-react-native";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import type { DishMediaEntry } from "@shared/api/v1/res";
import { getRemoteConfig } from "@/lib/remoteConfig";
import { toggleReaction } from "@/lib/reactions";
import { generateShareUrl, handleShare } from "@/lib/share";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import VideoPlayer from "../../../components/VideoPlayer";
import { getGoogleMapsLink } from "@/lib/googlePlaces";
import { useAPICall } from "@/hooks/useAPICall";
import type { DishMediaReactionBodyDto } from "@shared/api/v1/dto";
import CommentsSection from "./CommentsSection";
import ActionButtons from "./ActionButtons";
import { useMediaTracking } from "../hooks/useMediaTracking";
import { formatLikeCount, Translate } from "../utils/text";
import type { ScrollView } from "react-native-gesture-handler";

interface DishMediaContentProps {
        item: DishMediaEntry;
        carouselRef?: React.RefObject<any>;
        isActive: boolean;
        sessionId: string;
        source: string;
}

type CommentLikeState = {
        isLiked: boolean;
        count: number;
};

type CommentLikeMap = Record<string, CommentLikeState>;

type CommentExpandedMap = Record<string, number>;

type DishReview = DishMediaEntry["dish_reviews"][number];

const t: Translate = (key, options) => i18n.t(key, options);

// 画面構成と props の受け渡しのみを担う。表示に関係ない副作用は保持しない
export default function DishMediaContent({ item, carouselRef, isActive, sessionId, source }: DishMediaContentProps) {
        const [isSaved, setIsSaved] = useState(item.dish_media.isSaved);
        const [isLiked, setIsLiked] = useState(item.dish_media.isLiked);
        const [likesCount, setLikesCount] = useState(item.dish_media.likeCount);
        const { BlurModal, open: openMenuModal, close: closeMenuModal } = useBlurModal({ intensity: 100 });
        const [commentLikes, setCommentLikes] = useState<CommentLikeMap>(
                item.dish_reviews.reduce<CommentLikeMap>((acc, review: DishReview) => {
                        acc[review.id] = { isLiked: false, count: review.likeCount };
                        return acc;
                }, {} as CommentLikeMap),
        );
        const [commentExpandedUnits, setCommentExpandedUnits] = useState<CommentExpandedMap>(
                item.dish_reviews.reduce<CommentExpandedMap>((acc, review: DishReview) => {
                        const remoteConfig = getRemoteConfig();
                        const charLimit = parseInt(remoteConfig?.v1_dish_comment_review_show_number ?? "0", 10);
                        acc[review.id] = charLimit;
                        return acc;
                }, {} as CommentExpandedMap),
        );
        const scrollViewRef = useRef<ScrollView>(null);
        const { lightImpact } = useHaptics();
        const { callBackend } = useAPICall();
        const { logFrontendEvent } = useLogger();
        const router = useRouter();
        const locale = useLocale();
        const insets = useSafeAreaInsets();
        const [rightActionsWidth, setRightActionsWidth] = useState(0);
        const { showSnackbar } = useSnackbar();

        const { handleVideoLoop, handleVideoProgress } = useMediaTracking({
                isActive,
                sessionId,
                source,
                dishMedia: item.dish_media,
        });

        const mediaSource = useMemo(
                () => ({ uri: item.dish_media.mediaUrl, cacheKey: item.dish_media.mediaUrl.split("?")[0] }),
                [item.dish_media.mediaUrl],
        );

        useEffect(() => {
                scrollViewRef.current?.scrollToEnd({ animated: false });
        }, [item.dish_reviews.length]);

        const likesText = useMemo(() => formatLikeCount(likesCount, t), [likesCount]);
        const shareLabel = useMemo(() => t("DishMediaContent.actions.share"), []);
        const mapLabel = useMemo(() => t("DishMediaContent.actions.openMap"), []);
        const commentPaddingRight = useMemo(
                () => Math.max(16, rightActionsWidth + insets.right + 8),
                [rightActionsWidth, insets.right],
        );

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
                                dishMediaId: item.dish_media.id,
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
                        setCommentLikes((prev) => ({
                                ...prev,
                                [commentId]: {
                                        isLiked: currentLikeState,
                                        count: currentLikeState
                                                ? (prev[commentId]?.count || 0) + 1
                                                : (prev[commentId]?.count || 0) - 1,
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
                const charUnitIncrement = parseInt(remoteConfig?.v1_dish_comment_review_show_number ?? "0", 10);

                setCommentExpandedUnits((prev) => ({
                        ...prev,
                        [commentId]: (prev[commentId] ?? 0) + charUnitIncrement,
                }));

                logFrontendEvent({
                        event_name: "comment_see_more_clicked",
                        error_level: "log",
                        payload: {
                                commentId,
                                dishMediaId: item.dish_media.id,
                                restaurantId: item.restaurant.id,
                                previousExpandedChars: commentExpandedUnits[commentId],
                                newExpandedChars: (commentExpandedUnits[commentId] ?? 0) + charUnitIncrement,
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
                                dishMediaId: item.dish_media.id,
                                restaurantId: item.restaurant.id,
                                previousLikeCount: likesCount,
                                newLikeCount: willLike ? likesCount + 1 : likesCount - 1,
                        },
                });

                try {
                        if (willLike) {
                                await callBackend<DishMediaReactionBodyDto, void>(
                                        `v1/dish-media/${item.dish_media.id}/reaction`,
                                        {
                                                method: "POST",
                                                requestPayload: { action_type: "like" },
                                        },
                                );
                        } else {
                                await callBackend<DishMediaReactionBodyDto, void>(
                                        `v1/dish-media/${item.dish_media.id}/reaction`,
                                        {
                                                method: "DELETE",
                                                requestPayload: { action_type: "like" },
                                        },
                                );
                        }
                } catch (error) {
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
                                dishMediaId: item.dish_media.id,
                                restaurantId: item.restaurant.id,
                        },
                });

                try {
                        if (willSave) {
                                await callBackend<DishMediaReactionBodyDto, void>(
                                        `v1/dish-media/${item.dish_media.id}/reaction`,
                                        {
                                                method: "POST",
                                                requestPayload: { action_type: "save" },
                                        },
                                );
                        } else {
                                await callBackend<DishMediaReactionBodyDto, void>(
                                        `v1/dish-media/${item.dish_media.id}/reaction`,
                                        {
                                                method: "DELETE",
                                                requestPayload: { action_type: "save" },
                                        },
                                );
                        }
                } catch (error) {
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
                                fromDishMediaId: item.dish_media.id,
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
                                dishMediaId: item.dish_media.id,
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
                                fromDishMediaId: item.dish_media.id,
                        },
                });

                try {
                        const { mapUrl, canOpen } = await getGoogleMapsLink(item.restaurant);
                        if (Platform.OS === "web") {
                                window.open(mapUrl, "_blank", "noopener,noreferrer");
                                return;
                        }
                        if (canOpen) {
                                await Linking.openURL(mapUrl);
                        } else {
                                showSnackbar(t("DishMediaContent.errors.mapOpenFailed"));
                        }
                } catch (error) {
                        showSnackbar(t("DishMediaContent.errors.mapOpenFailed"));
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

                try {
                        await callBackend<DishMediaReactionBodyDto, void>(`v1/dish-media/${item.dish_media.id}/reaction`, {
                                method: "POST",
                                requestPayload: { action_type: "open_map" },
                        });
                } catch (error) {
                        console.log("Map open reaction error ignored:", error);
                }
        };

        const handleMenuOptionPress = useCallback(
                (onPress: () => void) => {
                        lightImpact();
                        closeMenuModal();
                        onPress();

                        logFrontendEvent({
                                event_name: "dish_menu_option_selected",
                                error_level: "log",
                                payload: {
                                        dishMediaId: item.dish_media.id,
                                        restaurantId: item.restaurant.id,
                                },
                        });
                },
                [closeMenuModal, item.dish_media.id, item.restaurant.id, lightImpact, logFrontendEvent],
        );

        const handleSharePress = async () => {
                lightImpact();

                try {
                        const shareUrl = generateShareUrl(`/${locale}/posts?ids=${item.dish_media.id}`);

                        logFrontendEvent({
                                event_name: "dish_share_attempted",
                                error_level: "log",
                                payload: {
                                        dishMediaId: item.dish_media.id,
                                        restaurantId: item.restaurant.id,
                                        shareUrl,
                                },
                        });

                        await handleShare(
                                shareUrl,
                                t("DishMediaContent.share.title", { dishName: item.restaurant.name }),
                                () => {
                                        logFrontendEvent({
                                                event_name: "dish_share_success",
                                                error_level: "log",
                                                payload: {
                                                        dishMediaId: item.dish_media.id,
                                                        restaurantId: item.restaurant.id,
                                                        shareUrl,
                                                },
                                        });
                                },
                                (error) => {
                                        logFrontendEvent({
                                                event_name: "dish_share_failed",
                                                error_level: "error",
                                                payload: {
                                                        dishMediaId: item.dish_media.id,
                                                        restaurantId: item.restaurant.id,
                                                        shareUrl,
                                                        error,
                                                },
                                        });
                                },
                                showSnackbar,
                        );
                } catch (error) {
                        logFrontendEvent({
                                event_name: "dish_share_error",
                                error_level: "error",
                                payload: {
                                        dishMediaId: item.dish_media.id,
                                        restaurantId: item.restaurant.id,
                                        error: error instanceof Error ? error.message : "Unknown error",
                                },
                        });
                }
        };

        const menuOptions = [
                {
                        icon: User,
                        label: t("DishMediaContent.menuOptions.viewCreatorProfile"),
                        onPress: handleViewCreator,
                },
                {
                        icon: Calendar,
                        label: t("DishMediaContent.menuOptions.reservation"),
                        onPress: () => console.log("Reservation"),
                },
        ];

        return (
                <SafeAreaView style={styles.container}>
                        {item.dish_media.media_type === "video" ? (
                                <VideoPlayer
                                        uri={item.dish_media.mediaUrl}
                                        style={StyleSheet.absoluteFill}
                                        shouldPlay={isActive}
                                        onProgress={handleVideoProgress}
                                        onLoop={handleVideoLoop}
                                />
                        ) : (
                                <Image
                                        source={mediaSource}
                                        cachePolicy="memory-disk"
                                        transition={100}
                                        style={StyleSheet.absoluteFill}
                                        contentFit="cover"
                                />
                        )}

                        <View style={styles.topHeader}>
                                <View style={styles.headerLeft}>
                                        <Text style={styles.menuName}>{item.restaurant.name}</Text>
                                        <View style={styles.priceRatingContainer}>{/* Price & rating placeholder */}</View>
                                </View>
                                <View style={styles.headerRight}>{/* CTA placeholder */}</View>
                        </View>

                        <CommentsSection
                                reviews={item.dish_reviews}
                                expandedUnits={commentExpandedUnits}
                                likesState={commentLikes}
                                paddingRight={commentPaddingRight}
                                scrollViewRef={scrollViewRef}
                                carouselRef={carouselRef}
                                onSeeMore={handleSeeMore}
                                onToggleLike={handleCommentLike}
                                t={t}
                        />

                        <View pointerEvents="box-none" style={styles.bottomSection}>
                                <View pointerEvents="box-none" style={styles.actionRow}>
                                        <ActionButtons
                                                restaurantImageUrl={item.restaurant.image_url}
                                                onPressRestaurant={handleViewRestaurant}
                                                isLiked={isLiked}
                                                likesText={likesText}
                                                onLike={handleLike}
                                                isSaved={isSaved}
                                                onSave={handleSave}
                                                onShare={handleSharePress}
                                                onOpenMap={handleMapPinPress}
                                                shareLabel={shareLabel}
                                                mapLabel={mapLabel}
                                                onLayout={setRightActionsWidth}
                                        />
                                </View>
                        </View>

                        <BlurModal contentContainerStyle={styles.modalOverlay}>
                                <View style={styles.menuContainer}>
                                        {menuOptions.map((option, index) => (
                                                <TouchableOpacity
                                                        key={index}
                                                        style={styles.menuItem}
                                                        onPress={() => handleMenuOptionPress(option.onPress)}
                                                >
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
