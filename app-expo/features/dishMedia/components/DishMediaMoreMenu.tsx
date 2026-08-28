import React, { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ellipsis, Flag, Pencil, Share, Trash2, X } from "lucide-react-native";
import { FontAwesome } from "@expo/vector-icons";

import i18n from "@/lib/i18n";
// #1513 «…» ボタンだけは常に暗いメディアの上に載るのでテーマ非追従（FixedColors）。
// シート本体は画面の面なのでテーマ追従のトークンを使う
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { useLogger } from "@/hooks/useLogger";
import { useHaptics } from "@/hooks/useHaptics";
import { useAPICall, type ApiError } from "@/hooks/useAPICall";
import { useDialog } from "@/contexts/DialogProvider";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLocale } from "@/hooks/useLocale";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { getMinorUnitDigits, parseAmountString, resolveCurrencySymbol, toMinorAmountInteger } from "@/lib/googlePlaces";
import {
	selectReviewsByMediaId,
	useDishMediaEntriesStore,
	type DishReview,
	type NormalizedDishMediaEntry,
} from "@/stores/useDishMediaEntriesStore";
import { shallow } from "zustand/shallow";
import { bumpMyDishesRevision } from "@/features/myDishes/stores/useMyDishesRevisionStore";
import type { UpdateDishReviewDto } from "@shared/api/v1/dto";
import type { DeleteDishMediaResponse, UpdateDishReviewResponse } from "@shared/api/v1/res";

/**
 * フィード右レールの «…» メニュー。
 *
 * #1629 【仕様】オーナー指示で **«…» を右レールの一番下に置き、シェアと報告をこの中へ入れた**。
 * それまで右レールは «いいね / 食べたい / レビュー / 地図 / シェア / 報告 / （自分の投稿なら）…»
 * と 7 段あり、縦に長すぎた。人に渡す操作（シェア・報告）と自分の投稿の管理（編集・削除）を
 * 1 つのメニューへ畳んで、レールに残すのは «その場で 1 タップで効く操作» だけにする。
 *
 * ⚠️ **このメニューは自分の投稿でなくても出る。** 中身が出し分けられるだけである。
 *    以前の名前は `OwnPostActions` だったが、シェアと報告が入った時点で
 *    «自分の投稿の» という名前は嘘になったので改名した。
 *
 * #1513 自分の投稿に対する編集・削除の導線。
 *
 * ## ここに置いている理由
 * 投稿を一覧できる画面（フィード / 検索結果 / プロフィールの投稿タブ）はすべて
 * `DishMediaFeed` → `ActionButtons` を通る。導線をここ 1 箇所に置けば、
 * マイページからの導線も同時に成立する。PR #1469 がプロフィールのタブ構成を
 * 触っているため、タブ側には手を入れない。
 *
 * ## 編集できないもの
 * **写真・動画は差し替えられない**（オーナー確定仕様）。この画面にはメディアを
 * 選び直す導線が無く、`MEDIA_LOCKED_NOTE_TEST_ID` の注記でそれを明示している。
 * 「なぜか写真だけ変えられない」と読まれないよう、UI 側にも理由を書いておく。
 */

/** Detox / Playwright から「メディア差し替えの UI が無いこと」を検証するための testID */
export const MEDIA_LOCKED_NOTE_TEST_ID = "own-post-media-locked-note";

/** 星の数（レビューの rating は 1..5） */
const MAX_STARS = 5;

type Props = {
	entry: NormalizedDishMediaEntry;
	/** #1629 シェア。右レールから畳んだので、押した先の処理は呼び出し側（ActionButtons）が持つ */
	onShare: () => void;
	/** #1629 通報。同上 */
	onReport: () => void;
};

export function DishMediaMoreMenu({ entry, onShare, onReport }: Props) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	const dishMediaId = String(entry.dish_media.id);
	// #1629 編集・削除の行だけを出し分ける。«…» 自体は誰の投稿でも出す
	const isMine = !!entry.dish_media.isMine;
	const { locale } = useLocale();
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();
	const { confirm } = useDialog();
	const { showSnackbar } = useSnackbar();

	const reviewsSelector = useCallback(selectReviewsByMediaId(dishMediaId), [dishMediaId]);
	const reviews = useDishMediaEntriesStore(reviewsSelector, shallow);

	/**
	 * 編集対象は「この投稿と一緒に作られた自分のレビュー」。
	 *
	 * 所有判定は `review.isMine`（サーバーが返す）を使い、クライアントで
	 * `user_id === 自分の id` を組み立てない。導線を出す根拠と PATCH の認可の根拠を
	 * 同じにしておかないと、「編集ボタンは出るのに 403」がありうる。
	 *
	 * `created_dish_media_id` でも絞るのは、同じ料理には別の投稿に紐づく自分のレビューも
	 * ぶら下がるため。この投稿の本文以外を編集画面に出してはいけない。
	 */
	const myReview: DishReview | undefined = useMemo(
		() => reviews.find((review) => review.isMine && String(review.created_dish_media_id) === dishMediaId),
		[reviews, dishMediaId],
	);

	const [menuVisible, setMenuVisible] = useState(false);
	const [editVisible, setEditVisible] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const [comment, setComment] = useState("");
	const [rating, setRating] = useState(MAX_STARS);
	const [price, setPrice] = useState("");

	const currencyCode = myReview?.currency_code ?? null;
	const currencySymbol = useMemo(() => resolveCurrencySymbol(currencyCode, locale), [currencyCode, locale]);

	const openMenu = useCallback(() => {
		lightImpact();
		setMenuVisible(true);
		logFrontendEvent({
			event_name: "own_post_menu_opened",
			error_level: "log",
			payload: { dishMediaId, hasEditableReview: !!myReview },
		});
	}, [lightImpact, logFrontendEvent, dishMediaId, myReview]);

	const openEdit = useCallback(() => {
		if (!myReview) return;
		setMenuVisible(false);

		// 現在値をフォームへ流し込む。price_cents は最小単位なので表示用に戻す
		setComment(myReview.comment ?? "");
		setRating(myReview.rating ?? MAX_STARS);
		setPrice(
			myReview.price_cents === null || myReview.price_cents === undefined
				? ""
				: String(myReview.price_cents / Math.pow(10, getMinorUnitDigits(myReview.currency_code))),
		);
		setEditVisible(true);
	}, [myReview]);

	/**
	 * 保存。`lockNo` を必ず送り、409 が返ったら **黙って上書きせずに** 失敗として扱う。
	 * ここで再送すると、サーバー側で作った競合検知の意味が消える。
	 */
	const handleSave = useCallback(async () => {
		if (!myReview || isSubmitting) return;
		setIsSubmitting(true);

		const parsedAmount = parseAmountString(price);
		const priceCents =
			price.trim() === "" || Number.isNaN(parsedAmount) ? null : toMinorAmountInteger(parsedAmount, currencyCode);

		try {
			const updated = await callBackend<UpdateDishReviewDto, UpdateDishReviewResponse>(
				`v1/dish-reviews/${myReview.id}`,
				{
					method: "PATCH",
					requestPayload: {
						lockNo: myReview.lock_no,
						comment,
						rating,
						priceCents,
						currencyCode,
					},
				},
			);

			// サーバーが返した行で置き換える。lock_no を進めておかないと、
			// 続けてもう一度編集したときに自分の古い lock_no で 409 になる
			useDishMediaEntriesStore.getState().updateReview(myReview.id, (review) => ({
				...review,
				...updated,
			}));

			logFrontendEvent({
				event_name: "own_review_updated",
				error_level: "log",
				payload: { reviewId: myReview.id, dishMediaId },
			});
			// #1398 の版数（設計 (1/2) §3）。評価・価格は my-dishes の並び替えとフィルタの
			// 入力なので、編集はカードの中身だけでなく «どの行がどこに出るか» を変える
			bumpMyDishesRevision();
			setEditVisible(false);
			showSnackbar(i18n.t("DishMediaContent.ownPost.saved"));
		} catch (error) {
			const status = (error as ApiError)?.status;
			showSnackbar(
				status === 409
					? i18n.t("DishMediaContent.ownPost.conflict")
					: status === 403
						? i18n.t("DishMediaContent.ownPost.forbidden")
						: i18n.t("DishMediaContent.ownPost.saveFailed"),
			);
			logFrontendEvent({
				event_name: "own_review_update_failed",
				error_level: "warn",
				payload: { reviewId: myReview.id, dishMediaId, status, error: toErrorLogMessage(error) },
			});
		} finally {
			setIsSubmitting(false);
		}
	}, [
		myReview,
		isSubmitting,
		price,
		currencyCode,
		callBackend,
		comment,
		rating,
		logFrontendEvent,
		dishMediaId,
		showSnackbar,
	]);

	/**
	 * 削除。取り返しがつかないので必ず確認を挟む。
	 * 成功したらストアからも取り除く（サーバーは論理削除だが、既に読み込み済みの
	 * 画面は再取得しない限り持ち続けるため）。
	 */
	const handleDelete = useCallback(async () => {
		setMenuVisible(false);

		const accepted = await confirm({
			title: i18n.t("DishMediaContent.ownPost.deleteConfirmTitle"),
			message: i18n.t("DishMediaContent.ownPost.deleteConfirmMessage"),
			confirmLabel: i18n.t("DishMediaContent.ownPost.deleteConfirmButton"),
			cancelLabel: i18n.t("DishMediaContent.ownPost.cancel"),
		});
		if (!accepted) return;

		try {
			const result = await callBackend<Record<string, never>, DeleteDishMediaResponse>(`v1/dish-media/${dishMediaId}`, {
				method: "DELETE",
				requestPayload: {},
			});
			useDishMediaEntriesStore.getState().removeDishMediaEntry(dishMediaId);
			// #1398 の版数（設計 (1/2) §3）。削除は «食べた» が 1 行消えるだけでなく、
			// その dish の «食べたい» が復活しうる（want 枝の NOT EXISTS が外れる）ので、
			// 一覧・Map のピン・Calendar の月・meta.oldestOccurredAt のどれにも波及する
			bumpMyDishesRevision();
			logFrontendEvent({
				event_name: "own_post_deleted",
				error_level: "log",
				payload: { dishMediaId, deletedDishReviewCount: result.deletedDishReviewIds.length },
			});
			showSnackbar(i18n.t("DishMediaContent.ownPost.deleted"));
		} catch (error) {
			const status = (error as ApiError)?.status;
			showSnackbar(
				status === 403 ? i18n.t("DishMediaContent.ownPost.forbidden") : i18n.t("DishMediaContent.ownPost.deleteFailed"),
			);
			logFrontendEvent({
				event_name: "own_post_delete_failed",
				error_level: "warn",
				payload: { dishMediaId, status, error: toErrorLogMessage(error) },
			});
		}
	}, [confirm, callBackend, dishMediaId, logFrontendEvent, showSnackbar]);

	return (
		<>
			<View style={styles.actionContainer}>
				<TouchableOpacity
					testID="dish-action-more"
					style={styles.actionButton}
					onPress={openMenu}
					hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("DishMediaContent.accessibility.ownPostMenu", {
						name: entry.restaurant.name,
					})}>
					<Ellipsis size={28} color={FixedColors.onMedia} />
				</TouchableOpacity>
			</View>

			{/* ─────────────── 操作メニュー ─────────────── */}
			<Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
				<Pressable style={styles.backdrop} onPress={() => setMenuVisible(false)}>
					{/* シート本体のタップは閉じる操作に伝播させない */}
					<Pressable testID="own-post-menu" style={styles.sheet} onPress={() => {}}>
						{/*
						  #1629 タイトルを «自分の投稿» から «この投稿» へ変えた。
						  このメニューは **他人の投稿でも出る**（シェアと報告が入っているため）。
						  «自分の投稿» のままだと、他人の投稿を開いたときに嘘になる。
						*/}
						<Text style={styles.sheetTitle}>{i18n.t("DishMediaContent.moreMenu.title")}</Text>

						{/* #1629 誰の投稿でも出る 2 行。«人に渡す» 操作をここへ畳んだ */}
						<TouchableOpacity
							testID="dish-action-share"
							style={styles.sheetRow}
							onPress={() => {
								setMenuVisible(false);
								onShare();
							}}
							accessibilityRole="button">
							<Share size={20} color={colors.textPrimaryAlt} />
							<Text style={styles.sheetRowText}>{i18n.t("DishMediaContent.actions.share")}</Text>
						</TouchableOpacity>

						{/*
						  #1514 (SAF-01) 通報。#1629 でレールからこのメニューへ移した。

						  ⚠️ 通報の敷居を上げないため、**メニューの一番下へ埋めない**。
						     シェアの直下（＝開いてすぐ見える位置）に置くこと。

						  #1629 【仕様】**自分の投稿には出さない**（オーナー指摘）。
						  自分の投稿を通報できても、消したいなら «投稿を削除» があるので意味が無く、
						  運営のキューに «本人が自分を通報した» 行だけが積む。主要な SNS も
						  自分の投稿には通報を出さない（出るのは編集・削除）。
						*/}
						{!isMine && (
							<TouchableOpacity
								testID="dish-action-report"
								style={styles.sheetRow}
								onPress={() => {
									setMenuVisible(false);
									onReport();
								}}
								accessibilityRole="button">
								<Flag size={20} color={colors.textPrimaryAlt} />
								<Text style={styles.sheetRowText}>{i18n.t("Report.action")}</Text>
							</TouchableOpacity>
						)}

						{/* ここから下は自分の投稿にだけ出る */}
						{isMine && myReview && (
							<TouchableOpacity
								testID="own-post-edit-button"
								style={styles.sheetRow}
								onPress={openEdit}
								accessibilityRole="button">
								<Pencil size={20} color={colors.textPrimaryAlt} />
								<Text style={styles.sheetRowText}>{i18n.t("DishMediaContent.ownPost.edit")}</Text>
							</TouchableOpacity>
						)}

						{isMine && (
							<TouchableOpacity
								testID="own-post-delete-button"
								style={styles.sheetRow}
								onPress={handleDelete}
								accessibilityRole="button">
								<Trash2 size={20} color={colors.danger} />
								<Text style={[styles.sheetRowText, styles.destructiveText]}>
									{i18n.t("DishMediaContent.ownPost.delete")}
								</Text>
							</TouchableOpacity>
						)}

						{/* #1513 メディア差し替えの導線が「無い」ことを明示する。
						    ここが無いと、写真を変えたい利用者は探し続けることになる。
						    他人の投稿では編集自体が無いので出さない */}
						{isMine && (
							<Text testID={MEDIA_LOCKED_NOTE_TEST_ID} style={styles.lockedNote}>
								{i18n.t("DishMediaContent.ownPost.mediaLocked")}
							</Text>
						)}

						<TouchableOpacity
							testID="own-post-menu-cancel"
							style={styles.sheetCancel}
							onPress={() => setMenuVisible(false)}
							accessibilityRole="button">
							<Text style={styles.sheetCancelText}>{i18n.t("DishMediaContent.ownPost.cancel")}</Text>
						</TouchableOpacity>
					</Pressable>
				</Pressable>
			</Modal>

			{/* ─────────────── 編集フォーム ─────────────── */}
			<Modal visible={editVisible} transparent animationType="slide" onRequestClose={() => setEditVisible(false)}>
				<View style={styles.backdrop}>
					<View testID="edit-review-modal" style={styles.editSheet}>
						<View style={styles.editHeader}>
							<Text style={styles.editTitle}>{i18n.t("DishMediaContent.ownPost.editTitle")}</Text>
							<TouchableOpacity
								testID="edit-review-cancel-button"
								onPress={() => setEditVisible(false)}
								accessibilityRole="button"
								accessibilityLabel={i18n.t("DishMediaContent.ownPost.cancel")}>
								<X size={22} color={colors.textPrimaryAlt} />
							</TouchableOpacity>
						</View>

						<ScrollView keyboardShouldPersistTaps="handled">
							{/* #1513 編集画面にメディア選択の導線は存在しない。
							    フォームの先頭で理由込みで伝える */}
							<Text testID="edit-review-media-locked-note" style={styles.lockedNote}>
								{i18n.t("DishMediaContent.ownPost.mediaLocked")}
							</Text>

							<Text style={styles.fieldLabel}>{i18n.t("DishMediaContent.ownPost.editComment")}</Text>
							<TextInput
								testID="edit-review-comment-input"
								style={styles.commentInput}
								value={comment}
								onChangeText={setComment}
								multiline
								textAlignVertical="top"
							/>

							<Text style={styles.fieldLabel}>{i18n.t("DishMediaContent.ownPost.editRating")}</Text>
							<View style={styles.starRow}>
								{Array.from({ length: MAX_STARS }).map((_, index) => {
									const value = index + 1;
									return (
										<TouchableOpacity
											key={value}
											testID={`edit-review-star-${value}`}
											onPress={() => setRating(value)}
											accessibilityRole="button"
											accessibilityLabel={i18n.t("Stars.accessibility.rating", { rating: value })}
											aria-selected={rating === value}>
											<FontAwesome
												name={value <= rating ? "star" : "star-o"}
												size={28}
												color="gold"
												style={styles.star}
											/>
										</TouchableOpacity>
									);
								})}
							</View>

							<Text style={styles.fieldLabel}>{i18n.t("DishMediaContent.ownPost.editPrice")}</Text>
							<View style={styles.priceRow}>
								{currencySymbol ? <Text style={styles.currencySymbol}>{currencySymbol}</Text> : null}
								<TextInput
									testID="edit-review-price-input"
									style={styles.priceInput}
									value={price}
									onChangeText={setPrice}
									keyboardType="numeric"
									placeholder="0"
									placeholderTextColor={colors.textPlaceholder}
								/>
							</View>

							<TouchableOpacity
								testID="edit-review-submit-button"
								style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
								onPress={handleSave}
								disabled={isSubmitting}
								accessibilityRole="button">
								<Text style={styles.submitButtonText}>{i18n.t("DishMediaContent.ownPost.save")}</Text>
							</TouchableOpacity>
						</ScrollView>
					</View>
				</View>
			</Modal>
		</>
	);
}

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		actionContainer: {
			alignItems: "center",
		},
		actionButton: {
			padding: 4,
		},
		backdrop: {
			flex: 1,
			backgroundColor: "rgba(0,0,0,0.5)",
			justifyContent: "flex-end",
		},
		sheet: {
			backgroundColor: colors.surface,
			borderTopLeftRadius: 16,
			borderTopRightRadius: 16,
			paddingHorizontal: 20,
			paddingTop: 16,
			paddingBottom: 32,
		},
		sheetTitle: {
			fontSize: 14,
			fontWeight: "600",
			color: colors.textSecondary,
			marginBottom: 8,
		},
		sheetRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: 12,
			paddingVertical: 14,
		},
		sheetRowText: {
			fontSize: 16,
			color: colors.textPrimaryAlt,
			fontWeight: "500",
		},
		destructiveText: {
			color: colors.danger,
		},
		lockedNote: {
			fontSize: 12,
			color: colors.textSecondary,
			lineHeight: 18,
			marginTop: 4,
			marginBottom: 12,
		},
		sheetCancel: {
			alignItems: "center",
			paddingVertical: 14,
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: colors.borderMuted,
		},
		sheetCancelText: {
			fontSize: 16,
			color: colors.textSecondary,
			fontWeight: "500",
		},
		editSheet: {
			backgroundColor: colors.surface,
			borderTopLeftRadius: 16,
			borderTopRightRadius: 16,
			paddingHorizontal: 20,
			paddingTop: 16,
			paddingBottom: 32,
			maxHeight: "85%",
		},
		editHeader: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			marginBottom: 12,
		},
		editTitle: {
			fontSize: 18,
			fontWeight: "700",
			color: colors.textPrimaryAlt,
		},
		fieldLabel: {
			fontSize: 13,
			fontWeight: "600",
			color: colors.textSecondary,
			marginBottom: 6,
			marginTop: 8,
		},
		commentInput: {
			minHeight: 96,
			borderWidth: 1,
			borderColor: colors.borderMuted,
			borderRadius: 8,
			padding: 12,
			fontSize: 15,
			color: colors.textPrimaryAlt,
		},
		starRow: {
			flexDirection: "row",
			alignItems: "center",
		},
		star: {
			marginRight: 6,
		},
		priceRow: {
			flexDirection: "row",
			alignItems: "center",
			borderWidth: 1,
			borderColor: colors.borderMuted,
			borderRadius: 8,
			paddingHorizontal: 12,
		},
		currencySymbol: {
			fontSize: 15,
			color: colors.textSecondary,
			marginRight: 4,
		},
		priceInput: {
			flex: 1,
			paddingVertical: 10,
			fontSize: 15,
			color: colors.textPrimaryAlt,
		},
		submitButton: {
			marginTop: 20,
			backgroundColor: FixedColors.submitFilled,
			borderRadius: 10,
			paddingVertical: 14,
			alignItems: "center",
		},
		submitButtonDisabled: {
			opacity: 0.5,
		},
		submitButtonText: {
			color: FixedColors.onFilled,
			fontSize: 16,
			fontWeight: "700",
		},
	});
