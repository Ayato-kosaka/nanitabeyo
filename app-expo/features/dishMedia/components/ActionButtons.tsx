import React, { useCallback, useEffect, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import { Heart, Bookmark, Share, MapPinned } from "lucide-react-native";
import i18n from "@/lib/i18n";
import { formatLikeCount } from "../utils/text";
import { useLogger } from "@/hooks/useLogger";
import { useHaptics } from "@/hooks/useHaptics";
import { useAPICall } from "@/hooks/useAPICall";
import type { DishMediaReactionBodyDto } from "@shared/api/v1/dto";
import { getCacheKeyForImage } from "@/lib/image";
import {
	DishMediaEntriesStore,
	NormalizedDishMediaEntry,
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
import { toErrorLogMessage } from "@/lib/errorMessage";
import { useSnackbar } from "@/contexts/SnackbarProvider";

interface ActionButtonsProps {
	id: string;
	idType: IdType;
	onLayout: (width: number) => void;
	buttonsGesture: GestureType; // #694 【設計】親Tapとの競合を防ぐための Native Gesture
}

export function ActionButtons({ id, idType, onLayout, buttonsGesture }: ActionButtonsProps) {
	const { logFrontendEvent } = useLogger();

	// ログアウト時は AuthProvider がストアを消去してから旧画面の unmount が完了するまで、
	// FlatList のセルが一度だけ再描画される。欠損を例外にするとログアウトそのものが ErrorBoundary
	// に捕捉されるため、その過渡状態ではアクションを描画しない。
	const selector = useCallback(
		(state: DishMediaEntriesStore) =>
			idType === "dish_media" ? selectEntryByMediaId(id)(state) : selectEntryByReviewId(id)(state),
		[id, idType],
	);
	const entry = useDishMediaEntriesStore(selector, shallow);

	useEffect(() => {
		if (!entry) {
			logFrontendEvent({
				event_name: "action_buttons_entry_missing",
				error_level: "debug",
				payload: { id, idType, context: "logout_or_unmount" },
			});
		}
	}, [entry, id, idType, logFrontendEvent]);

	if (!entry) return null;

	return <ActionButtonsContent entry={entry} onLayout={onLayout} buttonsGesture={buttonsGesture} />;
}

function ActionButtonsContent({
	entry,
	onLayout,
	buttonsGesture,
}: Pick<ActionButtonsProps, "onLayout" | "buttonsGesture"> & { entry: NormalizedDishMediaEntry }) {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();
	const { showSnackbar } = useSnackbar();
	const { isSaved, isLiked, likeCount } = entry.dish_media;
	const dishMediaId = entry.dish_media.id;
	const { restaurant } = entry;

	// #613 【設計】ActionButtons の押下処理を hooks で共通化
	const { openInGoogleMaps, shareRestaurant } = useDishMediaActions({
		source: "ActionButtons", // #613 【設計】呼び出し元を明示
	});

	/**
	 * #1205 【修正】いいね / 保存の多重実行を防ぐ同期ガード（アクション種別ごと）。
	 *
	 * このボタンには `disabled` すら無く、`isLiked` / `isSaved` は props 由来なので、
	 * 連打すると **stale なトグル値を両方が読んで同じ action を 2 回 POST** する。
	 * サーバ側は `dish_media_likes` / `reactions` の一意制約で 2 行目を弾くため
	 * データは壊れないが、失敗リクエストと warn ログが積まれる。
	 *
	 * 表示用の state を足さないのは、楽観更新（`updateEntry`）で見た目は即座に変わり、
	 * ローディングを出す必要が無いため。判定だけを ref で持つ。
	 */
	const inFlightActionsRef = useRef<Set<"like" | "save">>(new Set());

	const handleLike = useCallback(async () => {
		// #1205 進行中なら何もしない（宣言箇所のコメント参照）。楽観更新より前に弾くこと。
		// ここを楽観更新の後にすると、2 発目がトグルを戻してから弾かれ、表示だけ巻き戻る
		if (inFlightActionsRef.current.has("like")) return;
		inFlightActionsRef.current.add("like");

		lightImpact();
		const willLike = !isLiked;
		// #1501 【修正】API失敗時に戻す「操作前の値」。!willLike(トグルの反転)ではなく、
		// 楽観更新の直前に読んだ値そのものを保持する。反転で戻すと、他端末/別画面からの
		// 更新が割り込んでいた場合に誤った値を書き戻してしまう
		const previousIsLiked = isLiked;
		const previousLikeCount = likeCount;
		// #259 【バグ】いいね数が0未満にならないよう下限0を保証
		const newLikeCount = willLike ? likeCount + 1 : Math.max(0, likeCount - 1);
		const { updateEntry, updateMediaIdsByKey } = useDishMediaEntriesStore.getState();
		updateEntry(String(dishMediaId), (entry) => ({
			...entry,
			dish_media: {
				...entry.dish_media,
				isLiked: willLike,
				likeCount: newLikeCount,
			},
		}));

		// #1501 【修正】liked タブの一覧も dish_media 本体と同じタイミングで楽観更新し、
		// 失敗時にロールバックできるよう更新前の一覧を保持しておく
		// #460 【設計】いいね ON → liked タブの先頭に移動、いいね OFF → liked タブから除外
		let previousLikedIds: string[] = [];
		updateMediaIdsByKey(profileLikesEntriesKey, (prev) => {
			previousLikedIds = prev;
			return willLike
				? [String(dishMediaId), ...prev.filter((id) => id !== String(dishMediaId))]
				: prev.filter((id) => id !== String(dishMediaId));
		});

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
			await callBackend<DishMediaReactionBodyDto, void>(`v1/dish-media/${dishMediaId}/reaction`, {
				method: willLike ? "POST" : "DELETE",
				requestPayload: { action_type: "like" },
			});
		} catch (error) {
			// #1501 【修正】API失敗時は表示をサーバーと一致させるため、操作前の値へロールバックする
			updateEntry(String(dishMediaId), (entry) => ({
				...entry,
				dish_media: {
					...entry.dish_media,
					isLiked: previousIsLiked,
					likeCount: previousLikeCount,
				},
			}));
			updateMediaIdsByKey(profileLikesEntriesKey, () => previousLikedIds);

			logFrontendEvent({
				event_name: "dish_like_reaction_failed",
				error_level: "warn",
				payload: {
					error: toErrorLogMessage(error),
					dishMediaId: dishMediaId,
					previousLikeCount: likeCount,
					newLikeCount: newLikeCount,
				},
			});
			showSnackbar(i18n.t("DishMediaContent.errors.likeReactionFailed"), {
				action: { label: i18n.t("Common.retry"), onPress: () => void handleLike() },
			});
		} finally {
			// #1205 失敗しても押し直せるよう、成功・失敗のいずれでも必ず解除する
			inFlightActionsRef.current.delete("like");
		}
	}, [callBackend, dishMediaId, isLiked, likeCount, lightImpact, logFrontendEvent, showSnackbar]);

	const handleSave = useCallback(async () => {
		// #1205 進行中なら何もしない（宣言箇所のコメント参照）。楽観更新より前に弾くこと
		if (inFlightActionsRef.current.has("save")) return;
		inFlightActionsRef.current.add("save");

		lightImpact();
		const willSave = !isSaved;
		// #1501 【修正】API失敗時に戻す「操作前の値」。!willSave(トグルの反転)ではなく、
		// 楽観更新の直前に読んだ値そのものを保持する。反転で戻すと、他端末/別画面からの
		// 更新が割り込んでいた場合に誤った値を書き戻してしまう
		const previousIsSaved = isSaved;
		const { updateEntry, updateMediaIdsByKey } = useDishMediaEntriesStore.getState();

		// #460 【設計】エンティティ更新
		updateEntry(String(dishMediaId), (entry) => ({
			...entry,
			dish_media: {
				...entry.dish_media,
				isSaved: willSave,
			},
		}));

		// #1501 【修正】saved タブの一覧も dish_media 本体と同じタイミングで楽観更新し、
		// 失敗時にロールバックできるよう更新前の一覧を保持しておく
		// #460 【設計】保存 ON → saved タブの先頭に移動、保存 OFF → saved タブから除外
		let previousSavedIds: string[] = [];
		updateMediaIdsByKey(profileSavedPostsEntriesKey, (prev) => {
			previousSavedIds = prev;
			return willSave
				? [String(dishMediaId), ...prev.filter((id) => id !== String(dishMediaId))]
				: prev.filter((id) => id !== String(dishMediaId));
		});

		logFrontendEvent({
			event_name: willSave ? "dish_saved" : "dish_unsaved",
			error_level: "log",
			payload: {
				dishMediaId: dishMediaId,
			},
		});

		try {
			await callBackend<DishMediaReactionBodyDto, void>(`v1/dish-media/${dishMediaId}/reaction`, {
				method: willSave ? "POST" : "DELETE",
				requestPayload: { action_type: "save" },
			});
		} catch (error) {
			// #1501 【修正】API失敗時は表示をサーバーと一致させるため、操作前の値へロールバックする
			updateEntry(String(dishMediaId), (entry) => ({
				...entry,
				dish_media: {
					...entry.dish_media,
					isSaved: previousIsSaved,
				},
			}));
			updateMediaIdsByKey(profileSavedPostsEntriesKey, () => previousSavedIds);

			logFrontendEvent({
				event_name: "dish_save_reaction_failed",
				error_level: "log",
				payload: {
					error: toErrorLogMessage(error),
					target_id: dishMediaId,
					action_type: "save",
					willReact: willSave,
				},
			});
			showSnackbar(i18n.t("DishMediaContent.errors.saveReactionFailed"), {
				action: { label: i18n.t("Common.retry"), onPress: () => void handleSave() },
			});
		} finally {
			// #1205 失敗しても押し直せるよう、成功・失敗のいずれでも必ず解除する
			inFlightActionsRef.current.delete("save");
		}
	}, [callBackend, dishMediaId, isSaved, lightImpact, logFrontendEvent, showSnackbar]);

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

	const handleMapPinPress = useCallback(() => {
		return openInGoogleMaps({
			dishMediaId,
			restaurant,
		});
	}, [dishMediaId, restaurant, openInGoogleMaps]);

	const handleSharePress = useCallback(() => {
		return shareRestaurant({
			dishMediaId,
			restaurant,
		});
	}, [dishMediaId, restaurant, shareRestaurant]);

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
				{/* #1071 【リリース差分】店舗アバターボタンは押しても何も起きないため本番では出さない。
				    店舗詳細への遷移は handleViewRestaurant 内 (router.push) がコメントアウトされたままで、
				    コメントに残る遷移先ルート /(tabs)/(home)/restaurant/1 も存在しない。
				    ログ送信 (restaurant_view_clicked) だけが走る状態なので、ボタン自体を落とす。
				    店舗詳細画面が実装されたら、このコメントを外して復活させる。
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
				*/}

				<View style={styles.actionContainer}>
					{/* #1031 【設計】Detox から状態(いいね済みか)を検証できるよう、状態別の accessibilityLabel を付与 */}
					<TouchableOpacity
						testID="dish-action-like"
						style={styles.actionButton}
						onPress={handleLike}
						hitSlop={buttonHitSlop}
						accessibilityRole="button"
						accessibilityLabel={i18n.t(
							isLiked ? "DishMediaContent.accessibility.likeActive" : "DishMediaContent.accessibility.likeInactive",
							{ name: restaurant.name },
						)}
						aria-selected={isLiked}>
						<Heart size={28} color={isLiked ? "#FF3040" : "#FFFFFF"} fill={isLiked ? "#FF3040" : "white"} />
					</TouchableOpacity>
					<Text style={styles.actionText}>{formatLikeCount(likeCount)}</Text>
				</View>

				{/* #1031 【設計】Detox から状態(保存済みか)を検証できるよう、状態別の accessibilityLabel を付与 */}
				<TouchableOpacity
					testID="dish-action-save"
					style={styles.actionButton}
					onPress={handleSave}
					hitSlop={buttonHitSlop}
					accessibilityRole="button"
					accessibilityLabel={i18n.t(
						isSaved ? "DishMediaContent.accessibility.saveActive" : "DishMediaContent.accessibility.saveInactive",
						{ name: restaurant.name },
					)}
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
});
