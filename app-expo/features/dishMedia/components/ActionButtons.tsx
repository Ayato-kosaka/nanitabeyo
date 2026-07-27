import React, { useCallback, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import { Heart, Bookmark, Share, MapPinned, User, Calendar } from "lucide-react-native";
import i18n from "@/lib/i18n";
import { useRouter } from "expo-router";
import { formatLikeCount } from "../utils/text";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useHaptics } from "@/hooks/useHaptics";
import { useAPICall } from "@/hooks/useAPICall";
import type { DishMediaReactionBodyDto } from "@shared/api/v1/dto";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { getCacheKeyForImage } from "@/lib/image";
import {
	DishMediaEntriesStore,
	selectEntryByMediaId,
	selectEntryByReviewId,
	useDishMediaEntriesStore,
	IdType,
} from "@/stores/useDishMediaEntriesStore";
import { shallow } from "zustand/shallow";
import { profileLikesEntriesKey } from "@/features/profile/tabs/LikeTab";
import { profileSavedPostsEntriesKey } from "@/features/profile/tabs/SavedPostsTab";
import { useDishMediaActions } from "../hooks/useDishMediaActions";
import { GestureDetector } from "react-native-gesture-handler";
import type { GestureType } from "react-native-gesture-handler";

interface ActionButtonsProps {
	id: string;
	idType: IdType;
	onLayout: (width: number) => void;
	buttonsGesture: GestureType; // #694 【設計】親Tapとの競合を防ぐための Native Gesture
}

export function ActionButtons({ id, idType, onLayout, buttonsGesture }: ActionButtonsProps) {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();
	const router = useRouter();
	const { locale } = useLocale();

	// #940 【修正】entry 未取得時に throw する前に理由を記録する。throw 自体は残す
	// (このコンポーネントは entry の存在を前提に構築されており、無ければ描画できないため)。
	// ErrorBoundary(親の DishMediaMap.renderCarouselItem に設置済み)がこの throw を捕捉する
	const selector = useCallback(
		(state: DishMediaEntriesStore) => {
			const entry = idType === "dish_media" ? selectEntryByMediaId(id)(state) : selectEntryByReviewId(id)(state);
			if (!entry) {
				logFrontendEvent({
					event_name: "action_buttons_entry_missing",
					error_level: "error",
					payload: { id, idType, context: "selector" },
				});
				throw new Error("ActionButtons: entry is undefined");
			}
			return {
				isSaved: entry.dish_media.isSaved,
				isLiked: entry.dish_media.isLiked,
				likeCount: entry.dish_media.likeCount,
			};
		},
		[id, idType, logFrontendEvent],
	);
	const { isSaved, isLiked, likeCount } = useDishMediaEntriesStore(selector, shallow);

	const { dishMediaId, restaurant } = useMemo(() => {
		const state = useDishMediaEntriesStore.getState(); // ← subscribe しない snapshot 読み
		const entry = idType === "dish_media" ? selectEntryByMediaId(id)(state) : selectEntryByReviewId(id)(state);
		if (!entry) {
			logFrontendEvent({
				event_name: "action_buttons_entry_missing",
				error_level: "error",
				payload: { id, idType, context: "memo" },
			});
			throw new Error("ActionButtons: entry is undefined");
		}
		return { dishMediaId: entry.dish_media.id, restaurant: entry.restaurant };
	}, [id, idType, logFrontendEvent]);

	// #613 【設計】ActionButtons の押下処理を hooks で共通化
	const { openInGoogleMaps, shareRestaurant } = useDishMediaActions({
		source: "ActionButtons", // #613 【設計】呼び出し元を明示
	});

	const {
		BlurModal,
		open: openMenuModal,
		close: closeMenuModal,
	} = useBlurModal({ intensity: 100, closeOnBackdropPress: true });

	const handleLike = useCallback(async () => {
		lightImpact();
		const willLike = !isLiked;
		// #259 【バグ】いいね数が0未満にならないよう下限0を保証
		let newLikeCount = willLike ? likeCount + 1 : Math.max(0, likeCount - 1);
		const { updateEntry, updateMediaIdsByKey } = useDishMediaEntriesStore.getState();
		updateEntry(String(dishMediaId), (entry) => ({
			...entry,
			dish_media: {
				...entry.dish_media,
				isLiked: willLike,
				likeCount: newLikeCount,
			},
		}));

		logFrontendEvent({
			event_name: willLike ? "dish_liked" : "dish_unliked",
			error_level: "log",
			payload: {
				dishMediaId: dishMediaId,
				previousLikeCount: likeCount,
				newLikeCount: newLikeCount,
			},
		});

		try {
			// #460 【設計】いいね ON → liked タブの先頭に移動、いいね OFF → liked タブから除外
			if (willLike) {
				await callBackend<DishMediaReactionBodyDto, void>(`v1/dish-media/${dishMediaId}/reaction`, {
					method: "POST",
					requestPayload: { action_type: "like" },
				});
				updateMediaIdsByKey(profileLikesEntriesKey, (prev) => {
					const without = prev.filter((id) => id !== String(dishMediaId));
					return [String(dishMediaId), ...without];
				});
			} else {
				await callBackend<DishMediaReactionBodyDto, void>(`v1/dish-media/${dishMediaId}/reaction`, {
					method: "DELETE",
					requestPayload: { action_type: "like" },
				});
				updateMediaIdsByKey(profileLikesEntriesKey, (prev) => prev.filter((id) => id !== String(dishMediaId)));
			}
		} catch (error) {
			logFrontendEvent({
				event_name: "dish_like_reaction_failed",
				error_level: "warn",
				payload: {
					error: error instanceof Error ? error.message : String(error),
					dishMediaId: dishMediaId,
					previousLikeCount: likeCount,
					newLikeCount: newLikeCount,
				},
			});
		}
	}, [callBackend, dishMediaId, isLiked, likeCount, lightImpact, logFrontendEvent]);

	const handleSave = useCallback(async () => {
		lightImpact();
		const willSave = !isSaved;
		const { updateEntry, updateMediaIdsByKey } = useDishMediaEntriesStore.getState();

		// #460 【設計】エンティティ更新
		updateEntry(String(dishMediaId), (entry) => ({
			...entry,
			dish_media: {
				...entry.dish_media,
				isSaved: willSave,
			},
		}));

		logFrontendEvent({
			event_name: willSave ? "dish_saved" : "dish_unsaved",
			error_level: "log",
			payload: {
				dishMediaId: dishMediaId,
			},
		});

		try {
			// #460 【設計】保存 ON → saved タブの先頭に移動、保存 OFF → saved タブから除外
			if (willSave) {
				await callBackend<DishMediaReactionBodyDto, void>(`v1/dish-media/${dishMediaId}/reaction`, {
					method: "POST",
					requestPayload: { action_type: "save" },
				});
				updateMediaIdsByKey(profileSavedPostsEntriesKey, (prev) => {
					const without = prev.filter((id) => id !== String(dishMediaId));
					return [String(dishMediaId), ...without];
				});
			} else {
				await callBackend<DishMediaReactionBodyDto, void>(`v1/dish-media/${dishMediaId}/reaction`, {
					method: "DELETE",
					requestPayload: { action_type: "save" },
				});
				updateMediaIdsByKey(profileSavedPostsEntriesKey, (prev) => prev.filter((id) => id !== String(dishMediaId)));
			}
		} catch (error) {
			logFrontendEvent({
				event_name: "dish_save_reaction_failed",
				error_level: "log",
				payload: {
					error: error instanceof Error ? error.message : String(error),
					target_id: dishMediaId,
					action_type: "save",
					willReact: willSave,
				},
			});
		}
	}, [callBackend, dishMediaId, isSaved, lightImpact, logFrontendEvent]);

	const handleViewRestaurant = () => {
		lightImpact();
		// router.push("/(tabs)/(home)/restaurant/1");

		logFrontendEvent({
			event_name: "restaurant_view_clicked",
			error_level: "log",
			payload: {
				restaurantId: restaurant.id,
				restaurantName: restaurant.name,
				fromDishMediaId: dishMediaId,
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
				fromDishMediaId: dishMediaId,
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
				dishMediaId: dishMediaId,
				restaurantId: restaurant.id,
			},
		});
	};

	const handleMapPinPress = useCallback(() => {
		return openInGoogleMaps({
			dishMediaId,
			restaurant,
		});
	}, [dishMediaId, restaurant, openInGoogleMaps]);

	const handleMenuOptionPress = (onPress: () => void) => {
		lightImpact();
		closeMenuModal();
		onPress();

		logFrontendEvent({
			event_name: "dish_menu_option_selected",
			error_level: "log",
			payload: {
				dishMediaId: dishMediaId,
				restaurantId: restaurant.id,
			},
		});
	};

	const handleSharePress = useCallback(() => {
		return shareRestaurant({
			dishMediaId,
			restaurant,
		});
	}, [dishMediaId, restaurant, shareRestaurant]);

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
	// #694 【UX】アクションボタンのヒット領域を拡張（iOS 44pt/Android 48dp 相当の担保）
	const buttonHitSlop = { top: 12, bottom: 12, left: 12, right: 12 };

	// #694 【設計】buttonsGesture でラップし親Tapとの競合を解消（ボタン操作中は親Tapを失敗させる）
	return (
		<GestureDetector gesture={buttonsGesture}>
			<View style={styles.rightActions} onLayout={handleLayout}>
				<TouchableOpacity
					style={styles.actionButton}
					onPress={handleViewRestaurant}
					hitSlop={buttonHitSlop}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("DishMediaContent.accessibility.viewRestaurant", { name: restaurant.name })}>
					<Image
						source={{ uri: restaurant.imageUrls?.sm, cacheKey: getCacheKeyForImage(restaurant.imageUrls?.sm) }}
						style={styles.restaurantAvatar}
						onError={() => console.log("Failed to load restaurant avatar")}
						// #937 【仕様】店舗名を伝える情報画像として alt/accessibilityLabel を付与する(ボタン自体のrole/labelは#939で対応)
						alt={restaurant.name}
						accessibilityLabel={restaurant.name}
					/>
				</TouchableOpacity>

				<View style={styles.actionContainer}>
					<TouchableOpacity
						testID="dish-action-like"
						style={styles.actionButton}
						onPress={handleLike}
						hitSlop={buttonHitSlop}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("DishMediaContent.accessibility.like", { name: restaurant.name })}
						aria-selected={isLiked}>
						<Heart size={28} color={isLiked ? "#FF3040" : "#FFFFFF"} fill={isLiked ? "#FF3040" : "white"} />
					</TouchableOpacity>
					<Text style={styles.actionText}>{formatLikeCount(likeCount)}</Text>
				</View>

				<TouchableOpacity
					testID="dish-action-save"
					style={styles.actionButton}
					onPress={handleSave}
					hitSlop={buttonHitSlop}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("DishMediaContent.accessibility.save", { name: restaurant.name })}
					aria-selected={isSaved}>
					<Bookmark size={30} color={"transparent"} fill={isSaved ? "orange" : "white"} />
				</TouchableOpacity>

				<View style={styles.actionContainer}>
					<TouchableOpacity
						style={styles.actionButton}
						onPress={handleSharePress}
						hitSlop={buttonHitSlop}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("DishMediaContent.accessibility.share", { name: restaurant.name })}>
						<Share size={28} color="#FFFFFF" />
					</TouchableOpacity>
					<Text style={styles.actionText}>{i18n.t("DishMediaContent.actions.share")}</Text>
				</View>

				<View style={styles.actionContainer}>
					<TouchableOpacity
						style={styles.actionButton}
						onPress={handleMapPinPress}
						hitSlop={buttonHitSlop}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("DishMediaContent.accessibility.openMap", { name: restaurant.name })}>
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
								}}
								accessibilityRole="button"
								accessibilityLabel={option.label}>
								<option.icon size={20} color="#FFFFFF" />
								<Text style={styles.menuItemText}>{option.label}</Text>
							</TouchableOpacity>
						))}
					</View>
				</BlurModal>
			</View>
		</GestureDetector>
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
