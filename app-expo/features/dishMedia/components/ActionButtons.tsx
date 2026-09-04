import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import { Heart, Bookmark, MapPinned, UtensilsCrossed } from "lucide-react-native";
import { router } from "expo-router";
import i18n from "@/lib/i18n";
// #1629 いいね数の表示は消したが、楽観更新の整形に使うため import は残す（下のコメント参照）
import { formatLikeCount } from "../utils/text";
import { useLogger } from "@/hooks/useLogger";
import { useHaptics } from "@/hooks/useHaptics";
import { useAPICall } from "@/hooks/useAPICall";
import { useLocale } from "@/hooks/useLocale";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
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
import { profileSavedPostsEntriesKey } from "@/features/profile/entriesKeys";
import { bumpMyDishesRevision } from "@/features/myDishes/stores/useMyDishesRevisionStore";
import { MY_DISH_STATUS_COLORS, MY_DISH_STATUS_ORANGE } from "@/features/myDishes/statusColors";
import { useDishMediaActions } from "../hooks/useDishMediaActions";
import { ReportContentSheet } from "./ReportContentSheet";
import { DishMediaMoreMenu } from "./DishMediaMoreMenu";
import { GestureDetector } from "react-native-gesture-handler";
import type { GestureType } from "react-native-gesture-handler";
import { toErrorLogMessage } from "@/lib/errorMessage";
// #1509 このアクション列は常に暗いメディア（写真・動画）の上に載るため、テーマ非追従の FixedColors を使う
import { FixedColors } from "@/constants/Palette";

interface ActionButtonsProps {
	/**
	 * #1375 実機確認（3 巡目）:「食べたを記録」ボタンを出すか。
	 * 検索動線のフィード（DishMediaMap 系）では出さない — 探している段階で
	 * 食べたを記録する人は居ない、というオーナー判断。既定は true（既存フィードは不変）
	 */
	showRecordEaten?: boolean;
	id: string;
	idType: IdType;
	onLayout: (width: number) => void;
	buttonsGesture: GestureType; // #694 【設計】親Tapとの競合を防ぐための Native Gesture
}

export function ActionButtons({ id, idType, onLayout, buttonsGesture, showRecordEaten = true }: ActionButtonsProps) {
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

	return (
		<ActionButtonsContent
			entry={entry}
			onLayout={onLayout}
			buttonsGesture={buttonsGesture}
			showRecordEaten={showRecordEaten}
		/>
	);
}

function ActionButtonsContent({
	entry,
	onLayout,
	buttonsGesture,
	showRecordEaten = true,
}: Pick<ActionButtonsProps, "onLayout" | "buttonsGesture" | "showRecordEaten"> & { entry: NormalizedDishMediaEntry }) {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();
	const { showSnackbar } = useSnackbar();
	const { locale } = useLocale();
	const { user } = useAuth();
	const { isSaved, isLiked, likeCount, isEaten } = entry.dish_media;
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
			// #1375 実機確認（5 巡目）: フィードで «食べたい» を外しても、戻ってリロードするまで
			// 一覧から消えなかった。save reaction は my-dishes の want 枝の実体そのものなので、
			// 記録（#1398）や取り込み（#1399）と同じくここでもキャッシュを捨てる。
			// ⚠️ 失敗時は捨てない（ロールバック済みの表示と取り直しの結果が食い違う）
			bumpMyDishesRevision();
			if (willSave) {
				// #1401 【仕様】保存操作のみ完了フィードバックを出す(解除は状態変化が見た目で分かるため省略)。
				// DishCategoryCard の「見る」導線(#954)と同じ作法で、遷移先だけ my-dishes タブに変える。
				showSnackbar(i18n.t("DishMediaContent.save.savedMessage"), {
					action: {
						label: i18n.t("Common.view"),
						// #1401 実機確認（4 巡目）: `navigate` 単体でもまだ動かなかった。
						// 原因はネイティブモーダル（検索結果 = transparentModal / SNS 取り込み = modal）が
						// **タブの上に提示されたまま残る**こと。expo-router のタブ切替はモーダルの
						// 下で起きるので、モーダルを閉じない限り画面は変わって見えない。
						// 先に dismissAll でモーダルスタックを畳んでからタブを移す
						onPress: () => {
							if (router.canDismiss()) {
								router.dismissAll();
							}
							router.navigate({
								pathname: "/[locale]/(tabs)/my-dishes",
								params: { locale },
							});
						},
					},
				});
			}
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
	}, [callBackend, dishMediaId, isSaved, lightImpact, locale, logFrontendEvent, showSnackbar]);

	// #1398 (PR3/7) 【設計】全画面 Feed から「食べた」を記録する導線。
	// 遷移先は my-dishes カードや店舗詳細フィードと同じ既存ルート（review-from-media）で、
	// このボタンはその呼び出し元が1つ増えるだけ。
	//
	// #1375 実機確認（5 巡目）: **色だけ**「記録済み」を表す（`isEaten`）。
	// ⚠️ 押せなくはしない。`dish_reviews` に (user_id, dish_id) の一意制約は無く、
	// 再訪 = 別の記録が正しい仕様なので、«済 = 無効化» にすると 2 回目が記録できなくなる。
	// 伝えたいのは「もう記録した料理だ」であって「もう押せない」ではない。
	const handleRecordEaten = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "review_from_media_navigate",
			error_level: "log",
			payload: { restaurant_id: restaurant.id, dish_media_id: dishMediaId, source: "ActionButtons" },
		});
		router.push({
			pathname: "/[locale]/restaurant/[restaurantId]/review-from-media/[dishMediaId]",
			params: { locale, restaurantId: restaurant.id, dishMediaId },
		});
	}, [lightImpact, logFrontendEvent, locale, restaurant, dishMediaId]);

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

	// #1514 (SAF-01) 通報シートの開閉。
	// 「通報された投稿」の見た目は変えないので、ここには開閉以外の state を持たせない
	const [isReportSheetOpen, setIsReportSheetOpen] = useState(false);

	const handleReportPress = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "content_report_opened",
			error_level: "log",
			payload: { targetType: "dish_media", targetId: String(dishMediaId) },
		});
		setIsReportSheetOpen(true);
	}, [dishMediaId, lightImpact, logFrontendEvent]);

	const handleReportSheetClose = useCallback(() => setIsReportSheetOpen(false), []);

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
						<Heart
							size={28}
							color={isLiked ? FixedColors.likeActive : FixedColors.onMedia}
							fill={isLiked ? FixedColors.likeActive : FixedColors.onMedia}
						/>
					</TouchableOpacity>
					{/*
					  #1629 【仕様】オーナー指示で **ハートの下の数字を消した**。
					  いいね数は «自分がこの店へ行くか» の判断材料になっておらず、
					  数字が小さいほど押しにくくなる（社会的証明の逆効果）ため。

					  ⚠️ `likeCount` は楽観更新とロールバックのために残してある（削除しないこと）。
					     表示していないだけである。
					*/}
				</View>

				{/* #1031 【設計】Detox から状態(保存済みか)を検証できるよう、状態別の accessibilityLabel を付与。
				    #1375（5 巡目・デザインレビュー #5）この 1 つだけ **オレンジ（`orange` = パレット外の
				    CSS 名前色）/ サイズ 30 / ラベル無し** で、他 4 つと縦のリズムが崩れていた。
				    他と同じ 28 + ラベル付きに揃え、状態は «塗りの有無» で示す（バッジと同じ語彙） */}
				<View style={styles.actionContainer}>
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
						{/*
						#1375（9 巡目・オーナー指示）**押してある «食べたい» はオレンジで塗る。**

						それまでは «白の塗り» で状態を示していたが、写真の上では
						«白の輪郭（未保存）» と «白の塗り（保存済み）» の差が読めなかった。
						一覧のバッジで承認された同じ色へ揃える。
						⚠️ 下のラベルは白のまま（オーナー指示）。**アイコンだけを色で示す。**

						#1834【オーナー指示】«食べたい» は緑、«食べた» はオレンジ。一覧のバッジと同じ
						«塗りの色»（`fill`）をそのままアイコンの色に使う。⚠️ 色の正は `statusColors.ts` の
						1 箇所だけ。ここで別の緑を書かないこと（一覧とフィードで色がずれる）。
						*/}
						<Bookmark
							size={28}
							color={isSaved ? MY_DISH_STATUS_COLORS.want.fill : FixedColors.onMedia}
							fill={isSaved ? MY_DISH_STATUS_COLORS.want.fill : "transparent"}
						/>
					</TouchableOpacity>
					<Text style={styles.actionText}>{i18n.t("MyDishes.filters.status.want")}</Text>
				</View>

				{/* #1398 (PR3/7) 【仕様】ゲストは非表示。like/save と同じ作法（isGuestUser）。
				    トグルではないため「済」表示・aria-selected は付けない（常時活性） */}
				{showRecordEaten && !isGuestUser(user) && (
					<View style={styles.actionContainer}>
						<TouchableOpacity
							testID="dish-action-eaten"
							style={styles.actionButton}
							onPress={handleRecordEaten}
							hitSlop={buttonHitSlop}
							accessibilityRole="button"
							accessibilityLabel={i18n.t(
								isEaten
									? "DishMediaContent.accessibility.recordEatenAgain"
									: "DishMediaContent.accessibility.recordEaten",
								{ name: restaurant.name },
							)}
							// 読み上げでも «記録済み» が分かるようにする（色だけに頼らない）
							aria-selected={!!isEaten}>
							{/* #1375（9 巡目・オーナー指示）記録済みはオレンジ。
							    #1834 «食べたい»（緑）と色相で分かれる側である。
							    ⚠️ ラベルは白のまま（**色を付けるのはアイコンだけ**） */}
							<UtensilsCrossed size={28} color={isEaten ? MY_DISH_STATUS_ORANGE : FixedColors.onMedia} />
						</TouchableOpacity>
						{/* #1629 【仕様】ラベルは «食べた»（オーナー指示。何も付けない）。

						    経緯: «この料理にレビューを書く» → «レビュー» → **«食べた»**。
						    1 つ上のブックマークが «食べたい» なので、対になる語でなければ
						    「この 2 つが同じ軸の状態だ」と読めない。押した先の画面タイトルは長いままでよい。

						    ⚠️ `MyDishes.filters.status.eaten` を使う。一覧の絞り込み・バッジと
						       **同じキー**にしておくこと。別キーにすると片方だけ direction が変わる */}
							<Text style={styles.actionText}>{i18n.t("MyDishes.filters.status.eaten")}</Text>
					</View>
				)}

				<View style={styles.actionContainer}>
					<TouchableOpacity
						style={styles.actionButton}
						onPress={handleMapPinPress}
						hitSlop={buttonHitSlop}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("DishMediaContent.accessibility.openMap", { name: restaurant.name })}>
						<MapPinned size={28} color={FixedColors.onMedia} />
					</TouchableOpacity>
					<Text style={styles.actionText}>{i18n.t("DishMediaContent.actions.openMap")}</Text>
				</View>

				{/*
				  #1629 【仕様】«…» は右レールの**一番下**（オーナー指示）。
				  シェア・報告・（自分の投稿なら）編集・削除は、この中へ畳んだ。

				  ⚠️ シェアと報告の独立ボタンをレールへ戻さないこと。7 段あったレールを
				     «その場で 1 タップで効く操作» だけに絞るのがこの変更の目的である。
				  ⚠️ «…» は **他人の投稿でも出る**。中身が出し分けられるだけ。
				     `isMine` で «…» ごと消すと、他人の投稿を通報できなくなる。
				*/}
				<DishMediaMoreMenu entry={entry} onShare={handleSharePress} onReport={handleReportPress} />

				<ReportContentSheet
					visible={isReportSheetOpen}
					targetType="dish_media"
					targetId={String(dishMediaId)}
					targetLabel={restaurant.name}
					onClose={handleReportSheetClose}
				/>
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
		// アイコンにも文字と同じ影。白いアイコンが明るい写真に溶けないように
		shadowColor: "rgba(0, 0, 0, 0.5)",
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 1,
		shadowRadius: 2,
		padding: 4,
	},
	actionText: {
		fontSize: 13,
		fontWeight: "500",
		color: FixedColors.onMedia,
		marginTop: 4,
		letterSpacing: 0.2,
		// #1375（5 巡目・デザインレビュー #6）左列（`DishMediaContent` の店名・料理名）と
		// 同じ影を掛ける。明るい料理写真の上で右列だけ沈んでいた
		textShadowColor: "rgba(0, 0, 0, 0.5)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
	},
	// #1375（5 巡目）記録済み。色の正は my-dishes と同じ（`features/myDishes/statusColors.ts`）ので、
	// 一覧・カレンダー・地図で «食べた» を表している赤とここが必ず一致する
});
