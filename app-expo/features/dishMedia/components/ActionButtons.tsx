import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent, Platform } from "react-native";
import { Image } from "expo-image";
import { Heart, Bookmark, Share, MapPinned, User, Calendar } from "lucide-react-native";
import i18n from "@/lib/i18n";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { formatLikeCount } from "../utils/text";
import { DishMediaEntry } from "@shared/api/v1/res";
import { generateShareUrl, handleShare } from "@/lib/share";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useHaptics } from "@/hooks/useHaptics";
import { useAPICall } from "@/hooks/useAPICall";
import { getGoogleMapsLink } from "@/lib/googlePlaces";
import type { DishMediaReactionBodyDto } from "@shared/api/v1/dto";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { useSnackbar } from "@/contexts/SnackbarProvider";

interface ActionButtonsProps {
	dishMedia: DishMediaEntry["dish_media"];
	restaurant: DishMediaEntry["restaurant"];
	onLayout: (width: number) => void;
}

export function ActionButtons({ dishMedia, restaurant, onLayout }: ActionButtonsProps) {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();
	const { showSnackbar } = useSnackbar();
	const router = useRouter();
	const locale = useLocale();

	const [isSaved, setIsSaved] = useState(dishMedia.isSaved);
	const [isLiked, setIsLiked] = useState(dishMedia.isLiked);
	const [likesCount, setLikesCount] = useState(dishMedia.likeCount);

	const { BlurModal, open: openMenuModal, close: closeMenuModal } = useBlurModal({ intensity: 100 });

	const handleLike = async () => {
		lightImpact();
		const willLike = !isLiked;
		setIsLiked(willLike);
		// #issue-negative-like-count 【バグ】いいね数が0未満にならないよう下限0を保証
		setLikesCount((prev) => (willLike ? prev + 1 : Math.max(0, prev - 1)));

		logFrontendEvent({
			event_name: willLike ? "dish_liked" : "dish_unliked",
			error_level: "log",
			payload: {
				dishMediaId: dishMedia.id,
				previousLikeCount: likesCount,
				newLikeCount: willLike ? likesCount + 1 : likesCount - 1,
			},
		});

		try {
			if (willLike) {
				await callBackend<DishMediaReactionBodyDto, void>(`v1/dish-media/${dishMedia.id}/reaction`, {
					method: "POST",
					requestPayload: { action_type: "like" },
				});
			} else {
				await callBackend<DishMediaReactionBodyDto, void>(`v1/dish-media/${dishMedia.id}/reaction`, {
					method: "DELETE",
					requestPayload: { action_type: "like" },
				});
			}
		} catch (error) {
			// Revert state on error
			setIsLiked(!willLike);
			// #issue-negative-like-count 【バグ】エラー時のリバート処理でも下限0を保証
			setLikesCount((prev) => (willLike ? Math.max(0, prev - 1) : prev + 1));
			logFrontendEvent({
				event_name: "dish_like_reaction_failed",
				error_level: "log",
				payload: {
					error: error instanceof Error ? error.message : String(error),
					target_id: dishMedia.id,
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
				dishMediaId: dishMedia.id,
			},
		});

		try {
			if (willSave) {
				await callBackend<DishMediaReactionBodyDto, void>(`v1/dish-media/${dishMedia.id}/reaction`, {
					method: "POST",
					requestPayload: { action_type: "save" },
				});
			} else {
				await callBackend<DishMediaReactionBodyDto, void>(`v1/dish-media/${dishMedia.id}/reaction`, {
					method: "DELETE",
					requestPayload: { action_type: "save" },
				});
			}
		} catch (error) {
			// Revert state on error
			setIsSaved(!willSave);
			logFrontendEvent({
				event_name: "dish_save_reaction_failed",
				error_level: "log",
				payload: {
					error: error instanceof Error ? error.message : String(error),
					target_id: dishMedia.id,
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
				restaurantId: restaurant.id,
				restaurantName: restaurant.name,
				fromDishMediaId: dishMedia.id,
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
				fromDishMediaId: dishMedia.id,
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
				dishMediaId: dishMedia.id,
				restaurantId: restaurant.id,
			},
		});
	};

	const handleMapPinPress = async () => {
		lightImpact();

		logFrontendEvent({
			event_name: "map_pin_clicked",
			error_level: "log",
			payload: {
				restaurantId: restaurant.id,
				googlePlaceId: restaurant.google_place_id,
				fromDishMediaId: dishMedia.id,
			},
		});

		try {
			const { mapUrl, canOpen } = await getGoogleMapsLink(restaurant);
			if (Platform.OS === "web") {
				window.open(mapUrl, "_blank", "noopener,noreferrer"); // 別タブで開く
				return;
			}
			if (canOpen) {
				await Linking.openURL(mapUrl);
			} else {
				showSnackbar(i18n.t("DishMediaContent.errors.mapOpenFailed"));
			}
		} catch (error) {
			showSnackbar(i18n.t("DishMediaContent.errors.mapOpenFailed"));
			logFrontendEvent({
				event_name: "map_pin_open_failed",
				error_level: "error",
				payload: {
					restaurantId: restaurant.id,
					googlePlaceId: restaurant.google_place_id,
					error: error instanceof Error ? error.message : "Unknown error",
				},
			});
		}

		// Reaction を登録する。重複する場合はエラーになるが無視する。
		try {
			await callBackend<DishMediaReactionBodyDto, void>(`v1/dish-media/${dishMedia.id}/reaction`, {
				method: "POST",
				requestPayload: { action_type: "open_map" },
			});
		} catch (error) {
			// Ignore errors as per the comment
			console.log("Map open reaction error ignored:", error);
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
				dishMediaId: dishMedia.id,
				restaurantId: restaurant.id,
			},
		});
	};

	const handleSharePress = async () => {
		lightImpact();

		try {
			const shareUrl = generateShareUrl(`/${locale}/posts?ids=${dishMedia.id}`);

			logFrontendEvent({
				event_name: "dish_share_attempted",
				error_level: "log",
				payload: {
					dishMediaId: dishMedia.id,
					restaurantId: restaurant.id,
					shareUrl,
				},
			});

			await handleShare(
				shareUrl,
				i18n.t("DishMediaContent.share.title", { dishName: restaurant.name }),
				() => {
					// Success callback
					logFrontendEvent({
						event_name: "dish_share_success",
						error_level: "log",
						payload: {
							dishMediaId: dishMedia.id,
							restaurantId: restaurant.id,
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
							dishMediaId: dishMedia.id,
							restaurantId: restaurant.id,
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
					dishMediaId: dishMedia.id,
					restaurantId: restaurant.id,
					error: error instanceof Error ? error.message : "Unknown error",
				},
			});
		}
	};

	const menuOptions = [
		{
			icon: User,
			label: i18n.t("DishMediaContent.menuOptions.viewCreatorProfile"),
			onPress: handleViewCreator,
		},
		{
			icon: Calendar,
			label: i18n.t("DishMediaContent.menuOptions.reservation"),
			onPress: () => console.log("Reservation"),
		},
	];

	const handleLayout = useCallback(
		(event: LayoutChangeEvent) => onLayout?.(event.nativeEvent.layout.width),
		[onLayout],
	);
	return (
		<View style={styles.rightActions} onLayout={handleLayout}>
			<TouchableOpacity style={styles.actionButton} onPress={handleViewRestaurant}>
				<Image
					source={{ uri: restaurant.image_url }}
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
				<Text style={styles.actionText}>{i18n.t("DishMediaContent.actions.share")}</Text>
			</View>

			<View style={styles.actionContainer}>
				<TouchableOpacity style={styles.actionButton} onPress={handleMapPinPress}>
					<MapPinned size={28} color="#FFFFFF" />
				</TouchableOpacity>
				<Text style={styles.actionText}>{i18n.t("DishMediaContent.actions.openMap")}</Text>
			</View>

			{/* <TouchableOpacity
                  style={styles.actionButton}
                  onPress={onOpenMenu}
                >
                  <EllipsisVertical size={28} color="#FFFFFF" />
                </TouchableOpacity> */}
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
		</View>
	);
}

const styles = StyleSheet.create({
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
