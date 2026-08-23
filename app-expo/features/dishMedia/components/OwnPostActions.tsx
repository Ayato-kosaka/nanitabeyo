import React, { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ellipsis, Pencil, Trash2, X } from "lucide-react-native";
import { FontAwesome } from "@expo/vector-icons";

import i18n from "@/lib/i18n";
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
import type { UpdateDishReviewDto } from "@shared/api/v1/dto";
import type { DeleteDishMediaResponse, UpdateDishReviewResponse } from "@shared/api/v1/res";

/**
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
};

export function OwnPostActions({ entry }: Props) {
	const dishMediaId = String(entry.dish_media.id);
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
					<Ellipsis size={28} color="#FFFFFF" />
				</TouchableOpacity>
			</View>

			{/* ─────────────── 操作メニュー ─────────────── */}
			<Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
				<Pressable style={styles.backdrop} onPress={() => setMenuVisible(false)}>
					{/* シート本体のタップは閉じる操作に伝播させない */}
					<Pressable testID="own-post-menu" style={styles.sheet} onPress={() => {}}>
						<Text style={styles.sheetTitle}>{i18n.t("DishMediaContent.ownPost.menuTitle")}</Text>

						{myReview && (
							<TouchableOpacity
								testID="own-post-edit-button"
								style={styles.sheetRow}
								onPress={openEdit}
								accessibilityRole="button">
								<Pencil size={20} color="#111827" />
								<Text style={styles.sheetRowText}>{i18n.t("DishMediaContent.ownPost.edit")}</Text>
							</TouchableOpacity>
						)}

						<TouchableOpacity
							testID="own-post-delete-button"
							style={styles.sheetRow}
							onPress={handleDelete}
							accessibilityRole="button">
							<Trash2 size={20} color="#DC2626" />
							<Text style={[styles.sheetRowText, styles.destructiveText]}>
								{i18n.t("DishMediaContent.ownPost.delete")}
							</Text>
						</TouchableOpacity>

						{/* #1513 メディア差し替えの導線が「無い」ことを明示する。
						    ここが無いと、写真を変えたい利用者は探し続けることになる */}
						<Text testID={MEDIA_LOCKED_NOTE_TEST_ID} style={styles.lockedNote}>
							{i18n.t("DishMediaContent.ownPost.mediaLocked")}
						</Text>

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
								<X size={22} color="#111827" />
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
									placeholderTextColor="#A0A0A0"
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

const styles = StyleSheet.create({
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
		backgroundColor: "#FFFFFF",
		borderTopLeftRadius: 16,
		borderTopRightRadius: 16,
		paddingHorizontal: 20,
		paddingTop: 16,
		paddingBottom: 32,
	},
	sheetTitle: {
		fontSize: 14,
		fontWeight: "600",
		color: "#6B7280",
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
		color: "#111827",
		fontWeight: "500",
	},
	destructiveText: {
		color: "#DC2626",
	},
	lockedNote: {
		fontSize: 12,
		color: "#6B7280",
		lineHeight: 18,
		marginTop: 4,
		marginBottom: 12,
	},
	sheetCancel: {
		alignItems: "center",
		paddingVertical: 14,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: "#E5E7EB",
	},
	sheetCancelText: {
		fontSize: 16,
		color: "#6B7280",
		fontWeight: "500",
	},
	editSheet: {
		backgroundColor: "#FFFFFF",
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
		color: "#111827",
	},
	fieldLabel: {
		fontSize: 13,
		fontWeight: "600",
		color: "#6B7280",
		marginBottom: 6,
		marginTop: 8,
	},
	commentInput: {
		minHeight: 96,
		borderWidth: 1,
		borderColor: "#E5E7EB",
		borderRadius: 8,
		padding: 12,
		fontSize: 15,
		color: "#111827",
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
		borderColor: "#E5E7EB",
		borderRadius: 8,
		paddingHorizontal: 12,
	},
	currencySymbol: {
		fontSize: 15,
		color: "#6B7280",
		marginRight: 4,
	},
	priceInput: {
		flex: 1,
		paddingVertical: 10,
		fontSize: 15,
		color: "#111827",
	},
	submitButton: {
		marginTop: 20,
		backgroundColor: "#FF3040",
		borderRadius: 10,
		paddingVertical: 14,
		alignItems: "center",
	},
	submitButtonDisabled: {
		opacity: 0.5,
	},
	submitButtonText: {
		color: "#FFFFFF",
		fontSize: 16,
		fontWeight: "700",
	},
});
