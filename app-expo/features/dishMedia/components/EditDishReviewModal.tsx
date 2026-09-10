/**
 * 自分のクチコミ（`dish_reviews` 1 行）を編集するモーダル。
 *
 * ## なぜ切り出したのか（#1629）
 * 編集フォームはもともと `DishMediaMoreMenu`（フィード右レールの «…»）の中にだけあった。
 * ところが **写真の無い «食べた» 記録はフィードに出ない**ので、そのメニューへ辿り着けず、
 * 「自分が書いたのに直せない」状態になっていた（オーナー実機報告）。
 *
 * my-dishes のシート（`MyDishOwnReviewSheet`）にも同じフォームが要るが、
 * コピーすると **`lock_no` の扱い（409 を握り潰さない）と価格の最小単位変換**という
 * 間違えやすい 2 点が 2 箇所に散る。実際 `String(null)` が `"null"` になる類の事故は
 * このリポジトリで何度も起きているので、フォームごとここへ寄せて 1 実装にする。
 *
 * ## 編集できないもの
 * **写真・動画は差し替えられない**（オーナー確定仕様）。理由込みで注記を出す
 * （`edit-review-media-locked-note`）。呼び出し側で消さないこと。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
	KeyboardAvoidingView,
	Modal,
	Platform,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from "react-native";
import { X } from "lucide-react-native";
import { FontAwesome } from "@expo/vector-icons";

import i18n from "@/lib/i18n";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { useLogger } from "@/hooks/useLogger";
import { useSheetBottomPadding } from "@/hooks/useSheetBottomPadding";
import { useAPICall, type ApiError } from "@/hooks/useAPICall";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLocale } from "@/hooks/useLocale";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { getMinorUnitDigits, parseAmountString, resolveCurrencySymbol, toMinorAmountInteger } from "@/lib/googlePlaces";
import { bumpMyDishesRevision } from "@/features/myDishes/stores/useMyDishesRevisionStore";
import type { UpdateDishReviewDto } from "@shared/api/v1/dto";
import type { UpdateDishReviewResponse } from "@shared/api/v1/res";

/** 星の数（レビューの rating は 1..5） */
export const MAX_STARS = 5;

/** Detox / Playwright から「メディア差し替えの UI が無いこと」を検証するための testID */
export const EDIT_MEDIA_LOCKED_NOTE_TEST_ID = "edit-review-media-locked-note";

/**
 * 編集の対象。`dish_reviews` の行であればどこから来たものでもよい
 * （フィードのストア由来 / my-dishes の一覧行由来の両方が入る）。
 */
export type EditableDishReview = {
	id: string;
	comment: string | null;
	rating: number | null;
	price_cents: number | null;
	currency_code: string | null;
	lock_no: number;
};

type Props = {
	/** null のとき開かない。開いている間に差し替えないこと（入力中の値が飛ぶ） */
	review: EditableDishReview | null;
	onClose: () => void;
	/**
	 * 保存が成功したときに、サーバーが返した行を渡す。
	 * 呼び出し側は自分の持っている複製（ストア / 画面 state）をこれで置き換えること。
	 * **`lock_no` を進めておかないと、続けてもう一度編集したときに自分の古い値で 409 になる。**
	 */
	onSaved: (updated: UpdateDishReviewResponse) => void;
	/** ログに添える文脈（どの画面から開いた編集か）。集計でしか使わない */
	logPayload?: Record<string, unknown>;
};

/** シート下端のデザイン上の余白。実際の余白はこれに safe area の inset を足したもの */
const SHEET_PADDING_BOTTOM = 32;

export function EditDishReviewModal({ review, onClose, onSaved, logPayload }: Props) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	const { locale } = useLocale();
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { showSnackbar } = useSnackbar();
	// #1742 Modal はネイティブでは別ウィンドウで、画面側の safe area が届かない。
	// 足さないと保存ボタンが Android のナビゲーションバーへ潜る（hooks/useSheetBottomPadding.ts）
	const sheetPaddingBottom = useSheetBottomPadding(SHEET_PADDING_BOTTOM);

	const [comment, setComment] = useState("");
	const [rating, setRating] = useState(MAX_STARS);
	const [price, setPrice] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	const currencyCode = review?.currency_code ?? null;
	const currencySymbol = useMemo(() => resolveCurrencySymbol(currencyCode, locale), [currencyCode, locale]);

	/*
	#1774 【設計】**通貨が分からない行では、価格の編集そのものを出さない。**

	`price_cents` は最小単位の整数で、桁数は通貨ごとに違う（JPY は 0 桁、USD は 2 桁）。
	通貨が無ければ «その整数が何円なのか» を決められないので、表示も再変換もできない。

	dev の `dish_reviews` に `currency_code IS NULL` の行が 2 件残っている
	（通貨未確定のまま既定 2 桁で換算していた頃の残骸。¥500 が 50,000 になっている）。
	この行を開くと `toMinorAmountInteger()` が **try の外で throw** して、
	`finally` の `setIsSubmitting(false)` にも届かず **保存ボタンが二度と押せなくなっていた**。
	作成側は塞いだ（API の `@CurrencyCodeWithPrice()`）ので、この分岐は既存行の救済専用である。
	価格は触らせず据え置き、コメントと評価だけ直せるようにする。
	*/
	const canEditPrice = currencyCode !== null;

	/*
	開いたときだけ現在値を流し込む。`review.id` を依存にしているので、
	**入力中に親が再描画しても打った文字は消えない**（オブジェクトの同一性に依存させない）。
	price_cents は最小単位なので表示用に戻す。
	*/
	const reviewId = review?.id ?? null;
	useEffect(() => {
		if (review === null) return;
		setComment(review.comment ?? "");
		setRating(review.rating ?? MAX_STARS);
		setPrice(
			review.price_cents === null || review.price_cents === undefined
				? ""
				: String(review.price_cents / Math.pow(10, getMinorUnitDigits(review.currency_code))),
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [reviewId]);

	/**
	 * 保存。`lockNo` を必ず送り、409 が返ったら **黙って上書きせずに** 失敗として扱う。
	 * ここで再送すると、サーバー側で作った競合検知の意味が消える。
	 */
	const handleSave = useCallback(async () => {
		if (!review || isSubmitting) return;
		setIsSubmitting(true);

		// 通貨が無い行では価格を送らない（undefined = 据え置き）。currencyCode も同様に据え置く
		const parsedAmount = parseAmountString(price);
		const priceCents = !canEditPrice
			? undefined
			: price.trim() === "" || Number.isNaN(parsedAmount)
				? null
				: toMinorAmountInteger(parsedAmount, currencyCode);

		try {
			const updated = await callBackend<UpdateDishReviewDto, UpdateDishReviewResponse>(`v1/dish-reviews/${review.id}`, {
				method: "PATCH",
				requestPayload: {
					lockNo: review.lock_no,
					comment,
					rating,
					priceCents,
					currencyCode: canEditPrice ? currencyCode : undefined,
				},
			});

			onSaved(updated);

			logFrontendEvent({
				event_name: "own_review_updated",
				error_level: "log",
				payload: { reviewId: review.id, ...logPayload },
			});
			// #1398 の版数（設計 (1/2) §3）。評価・価格は my-dishes の並び替えとフィルタの
			// 入力なので、編集はカードの中身だけでなく «どの行がどこに出るか» を変える
			bumpMyDishesRevision();
			onClose();
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
				payload: { reviewId: review.id, status, error: toErrorLogMessage(error), ...logPayload },
			});
		} finally {
			setIsSubmitting(false);
		}
	}, [
		review,
		isSubmitting,
		price,
		currencyCode,
		canEditPrice,
		callBackend,
		comment,
		rating,
		logFrontendEvent,
		logPayload,
		onSaved,
		onClose,
		showSnackbar,
	]);

	return (
		<Modal visible={review !== null} transparent animationType="slide" onRequestClose={onClose}>
			{/*
				#1629 **`<Modal>` の中は親のキーボード回避が届かない。**
				Modal はネイティブでは別ウィンドウとして描かれるので、画面側に
				KeyboardAvoidingView を置いても中の入力欄は守られない。
				さらに Android 15（API 35）は edge-to-edge 強制で adjustResize が
				窓を縮めなくなるため、OS 任せの逃げ道も無い。ここに自前で持つ。
				*/}
			<KeyboardAvoidingView style={styles.backdrop} behavior={Platform.select({ ios: "padding", android: "height" })}>
				<View testID="edit-review-modal" style={[styles.editSheet, { paddingBottom: sheetPaddingBottom }]}>
					<View style={styles.editHeader}>
						<Text style={styles.editTitle}>{i18n.t("DishMediaContent.ownPost.editTitle")}</Text>
						<TouchableOpacity
							testID="edit-review-cancel-button"
							onPress={onClose}
							accessibilityRole="button"
							accessibilityLabel={i18n.t("DishMediaContent.ownPost.cancel")}>
							<X size={22} color={colors.textPrimaryAlt} />
						</TouchableOpacity>
					</View>

					<ScrollView keyboardShouldPersistTaps="handled">
						{/* #1513 編集画面にメディア選択の導線は存在しない。
						    フォームの先頭で理由込みで伝える */}
						<Text testID={EDIT_MEDIA_LOCKED_NOTE_TEST_ID} style={styles.lockedNote}>
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

						{canEditPrice ? (
							<>
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
							</>
						) : null}

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
			</KeyboardAvoidingView>
		</Modal>
	);
}

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		backdrop: {
			flex: 1,
			backgroundColor: "rgba(0,0,0,0.5)",
			justifyContent: "flex-end",
		},
		lockedNote: {
			fontSize: 12,
			color: colors.textSecondary,
			lineHeight: 18,
			marginTop: 4,
			marginBottom: 12,
		},
		editSheet: {
			backgroundColor: colors.surface,
			borderTopLeftRadius: 16,
			borderTopRightRadius: 16,
			paddingHorizontal: 20,
			paddingTop: 16,
			// paddingBottom は safe area を足すため呼び出し側で組む（SHEET_PADDING_BOTTOM）
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
