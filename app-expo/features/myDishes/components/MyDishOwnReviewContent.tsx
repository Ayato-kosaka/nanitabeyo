/**
 * 📝 «写真の無い / 写真を消した» 自分の記録の中身（墓標＋星＋金額＋本文＋編集/削除）。
 *
 * ## なぜ部品として切り出しているのか（#1752）
 * 同じ中身を **2 つの器**から出すからである。
 *
 * | 器 | 入口 | 器を持つファイル |
 * | --- | --- | --- |
 * | ボトムシート | グリッド（一覧）のセル | `MyDishOwnReviewSheet.tsx` |
 * | 全画面のページ | Calendar の日付 / Map のピンから開くフィードの 1 ページ | `MyDishOwnReviewPage.tsx` |
 *
 * オーナー実機報告（2026-08-31）: カレンダーの 8/20（削除済みの記録しか無い日）が
 * 「見つかりません」になり、Map の «食べた 3 件» もフィードでは 2 件しか送れず、
 * **書いたクチコミがどこからも読めない**状態だった。器は入口ごとに違ってよいが、
 * 中身（読む・編集する・消す）は 1 つでなければならない。写経して 2 つ持つと、
 * 片方だけ直った状態が必ず生まれる（CLAUDE.md「本番のロジックを写経しない」）。
 *
 * ## 追加の API 呼び出しをしない
 * 行（`MyDishItem`）は既に `myReview`（`dish_reviews` の 1 行そのもの）を持っている。
 * 星・コメント・金額・食べた日はすべてそこから読めるので、開くときに何も取りに行かない。
 */
import React, { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ImageOff, Pencil, Trash2, X } from "lucide-react-native";

import Stars from "@/components/Stars";
import { DeletedMediaTombstone } from "@/components/DeletedMediaTombstone";
import type { Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import i18n from "@/lib/i18n";
import { useLocale } from "@/hooks/useLocale";
import { useAPICall, type ApiError } from "@/hooks/useAPICall";
import { useDialog } from "@/contexts/DialogProvider";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLogger } from "@/hooks/useLogger";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { EditDishReviewModal, type EditableDishReview } from "@/features/dishMedia/components/EditDishReviewModal";
import { bumpMyDishesRevision } from "../stores/useMyDishesRevisionStore";
import { resolveDishCategoryLabel } from "../dishCategoryLabel";
import type { DeleteDishReviewResponse, MyDishItem, UpdateDishReviewResponse } from "@shared/api/v1/res";

/**
 * 金額を «その通貨の正しい桁» で組む。
 *
 * ⚠️ `price_cents` は最小単位の整数であり、**桁数は通貨ごとに違う**（JPY は 0 桁、USD は 2 桁）。
 * 一律に 100 で割ると円の 1000 円が 10 円になる。`Intl.NumberFormat` は通貨コードから
 * 桁数も記号も決めてくれるので、自前の対応表を持たない。
 * 通貨が分からない記録では金額そのものを出さない（単位の無い数字は誤読を招く）。
 */
export function formatReviewPrice(
	priceCents: number | null,
	currencyCode: string | null,
	locale: string,
): string | null {
	if (priceCents === null || !currencyCode) return null;
	try {
		const formatter = new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode });
		const digits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
		return formatter.format(priceCents / Math.pow(10, digits));
	} catch {
		// 端末の Intl が知らない通貨コードのとき。数字だけを出すより出さないほうが安全
		return null;
	}
}

/**
 * どの器に入っているか。
 *
 * - `sheet` … 下から出るシート。閉じる «×» は自分で持つ
 * - `page` … 全画面フィードの 1 ページ。閉じる «×» は**フィードのルートが 1 つだけ持つ**ので
 *   ここには置かない（置くと画面に × が 2 つ出る）
 */
export type MyDishOwnReviewVariant = "sheet" | "page";

export function MyDishOwnReviewContent({
	item,
	variant,
	onClose,
	onOpenRestaurant,
}: {
	item: MyDishItem;
	variant: MyDishOwnReviewVariant;
	/** 器を閉じる。削除が成功したときにも呼ぶ（記録そのものが消えるため） */
	onClose: () => void;
	/** 「お店の詳細を見る」。#1629 以前の遷移先を «選べる出口» として残すためのもの */
	onOpenRestaurant: (item: MyDishItem) => void;
}) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	const { locale } = useLocale();
	const { callBackend } = useAPICall();
	const { confirm } = useDialog();
	const { showSnackbar } = useSnackbar();
	const { logFrontendEvent } = useLogger();

	/*
	#1629【オーナー実機報告】「編集&削除できない」。

	編集・削除の導線はフィード右レールの «…»（`DishMediaMoreMenu`）にしか無く、
	**写真の無い «食べた» 記録はフィードのメディアページに出ない**ので、そこへ辿り着く手段が
	そもそも存在しなかった。この中身が唯一の «その記録を開く場所» なので、ここに置く。

	⚠️ 消せるのは **クチコミ 1 件だけ**（`DELETE /v1/dish-reviews/:id`）。
	   写真は «無い» か «既に削除済み»（`isOwnMediaDeleted`）のどちらかなので、
	   `DELETE /v1/dish-media/:id` を呼ぶ相手がいない。
	*/
	const [editingReview, setEditingReview] = useState<EditableDishReview | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	/**
	 * 編集の結果はここに退避する。一覧（`items`）は親が持っており、
	 * `bumpMyDishesRevision()` で取り直されるまで古いままなので、
	 * **保存直後のこの画面には保存した内容が出ている**ようにする。
	 */
	const [savedOverride, setSavedOverride] = useState<UpdateDishReviewResponse | null>(null);

	const review = useMemo(() => {
		const base = item.myReview ?? null;
		if (base === null) return null;
		return savedOverride !== null && String(savedOverride.id) === String(base.id)
			? { ...base, ...savedOverride }
			: base;
	}, [item.myReview, savedOverride]);

	const dishName = useMemo(
		() => resolveDishCategoryLabel(item.dish.categoryLabels, locale) ?? null,
		[item.dish.categoryLabels, locale],
	);
	const price = useMemo(
		() => (review ? formatReviewPrice(review.price_cents, review.currency_code, locale) : null),
		[review, locale],
	);
	const eatenOn = useMemo(() => {
		const raw = item.eatenAt ?? review?.created_at ?? null;
		if (!raw) return null;
		const date = new Date(raw);
		return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(locale);
	}, [item.eatenAt, review?.created_at, locale]);

	const handleOpenRestaurant = useCallback(() => onOpenRestaurant(item), [item, onOpenRestaurant]);

	const handleOpenEdit = useCallback(() => {
		if (review === null) return;
		setEditingReview({
			id: String(review.id),
			comment: review.comment,
			rating: review.rating,
			price_cents: review.price_cents,
			currency_code: review.currency_code,
			lock_no: review.lock_no,
		});
	}, [review]);

	/**
	 * 削除。取り返しがつかないので確認を挟む。
	 *
	 * ⚠️ 文言は `DishMediaContent.ownPost.deleteReviewConfirmMessage`（「写真は他の人のものなので
	 *    残ります」）を使い回さないこと。ここには残る写真が無く、**記録ごと一覧から消える**。
	 */
	const handleDelete = useCallback(async () => {
		if (review === null || isDeleting) return;

		const accepted = await confirm({
			title: i18n.t("MyDishes.ownReview.deleteConfirmTitle"),
			message: i18n.t("MyDishes.ownReview.deleteConfirmMessage"),
			confirmLabel: i18n.t("DishMediaContent.ownPost.deleteConfirmButton"),
			cancelLabel: i18n.t("DishMediaContent.ownPost.cancel"),
		});
		if (!accepted) return;

		setIsDeleting(true);
		try {
			await callBackend<Record<string, never>, DeleteDishReviewResponse>(`v1/dish-reviews/${review.id}`, {
				method: "DELETE",
				requestPayload: {},
			});
			logFrontendEvent({
				event_name: "own_review_deleted",
				error_level: "log",
				payload: { reviewId: String(review.id), itemKey: item.key, from: `my-dishes-own-review-${variant}` },
			});
			// #1398 の版数。«食べた» の行が消えるだけでなく、その dish の «食べたい» が
			// 復活しうる（want 枝の NOT EXISTS が外れる）ので一覧・Map・Calendar 全部に波及する
			bumpMyDishesRevision();
			// 一覧の取り直しは `bumpMyDishesRevision()` が起こす（`useMyDishesQuery` が版を見ている）
			onClose();
			showSnackbar(i18n.t("DishMediaContent.ownPost.reviewDeleted"));
		} catch (error) {
			const status = (error as ApiError)?.status;
			showSnackbar(
				status === 403
					? i18n.t("DishMediaContent.ownPost.forbidden")
					: i18n.t("DishMediaContent.ownPost.reviewDeleteFailed"),
			);
			logFrontendEvent({
				event_name: "own_review_delete_failed",
				error_level: "warn",
				payload: { reviewId: String(review.id), status, error: toErrorLogMessage(error) },
			});
		} finally {
			setIsDeleting(false);
		}
	}, [review, item.key, variant, isDeleting, confirm, callBackend, logFrontendEvent, onClose, showSnackbar]);

	return (
		<>
			<View style={styles.header}>
				<Text style={styles.title} numberOfLines={1}>
					{item.restaurant.name ?? ""}
				</Text>
				{variant === "sheet" ? (
					<TouchableOpacity
						onPress={onClose}
						hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("Common.close")}
						testID="my-dish-own-review-close">
						<X size={20} color={colors.textSecondary} />
					</TouchableOpacity>
				) : null}
			</View>

			{dishName ? <Text style={styles.dishName}>{dishName}</Text> : null}

			{/*
			写真が «無い» のか «消された» のかを混ぜない。
			削除は #1513 が決めた墓標をそのまま出す（別の絵へ差し替えない）。
			*/}
			<View
				style={[styles.mediaNotice, variant === "page" && styles.mediaNoticePage]}
				testID="my-dish-own-review-media-notice">
				{item.isOwnMediaDeleted ? (
					<DeletedMediaTombstone style={styles.tombstone} />
				) : (
					<>
						<ImageOff size={16} color={colors.textTertiary} />
						<Text style={styles.mediaNoticeText}>{i18n.t("MyDishes.ownReview.noPhoto")}</Text>
					</>
				)}
			</View>

			<ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
				{review ? (
					<>
						{/*
						自己レビューで足した。これが «自分が書いたもの» だと言わないと、
						店の紹介文と読み分けられない（オーナーの要望は «自分の書いたクチコミが見たい»）。
						*/}
						<Text style={styles.sectionLabel}>{i18n.t("MyDishes.ownReview.title")}</Text>
						<View style={styles.metaRow}>
							<Stars rating={review.rating} size={14} />
							{price ? (
								<Text style={styles.price} testID="my-dish-own-review-price">
									{price}
								</Text>
							) : null}
						</View>
						{eatenOn ? <Text style={styles.eatenOn}>{eatenOn}</Text> : null}
						<Text style={styles.comment} testID="my-dish-own-review-comment">
							{review.comment.trim().length > 0 ? review.comment : i18n.t("MyDishes.ownReview.noComment")}
						</Text>
					</>
				) : (
					// «食べたい» 行はレビューを持たない。そこからこの中身は開かないが、
					// 型の上では null を取りうるので黙って空にせず理由を出す
					<Text style={styles.comment}>{i18n.t("MyDishes.ownReview.noReview")}</Text>
				)}
			</ScrollView>

			{review ? (
				<View style={styles.actionRow}>
					<TouchableOpacity
						style={styles.actionButton}
						onPress={handleOpenEdit}
						accessibilityRole="button"
						testID="my-dish-own-review-edit">
						<Pencil size={18} color={colors.textPrimaryAlt} />
						<Text style={styles.actionButtonText}>{i18n.t("MyDishes.ownReview.edit")}</Text>
					</TouchableOpacity>
					<TouchableOpacity
						style={styles.actionButton}
						onPress={handleDelete}
						disabled={isDeleting}
						accessibilityRole="button"
						testID="my-dish-own-review-delete">
						<Trash2 size={18} color={colors.danger} />
						<Text style={[styles.actionButtonText, styles.destructiveText]}>{i18n.t("MyDishes.ownReview.delete")}</Text>
					</TouchableOpacity>
				</View>
			) : null}

			{/*
			#1629 «お店の詳細を見る» は主導線ではない（オーナーが読みたいのは自分のクチコミ）。
			編集・削除の下に、控えめな文字リンクとして置く。
			*/}
			<TouchableOpacity
				style={styles.restaurantButton}
				onPress={handleOpenRestaurant}
				accessibilityRole="button"
				testID="my-dish-own-review-open-restaurant">
				<Text style={styles.restaurantButtonText}>{i18n.t("MyDishes.ownReview.openRestaurant")}</Text>
			</TouchableOpacity>

			{/*
			#1629 編集フォームはフィードの «…» と同じ実装を使う（`EditDishReviewModal`）。

			⚠️ **シートの `<Modal>` の «中» へ入れないこと。** Modal はネイティブでは別ウィンドウで、
			   入れ子にすると Android で下の窓が閉じるまで上が出ない / 閉じたときに両方消える、といった
			   挙動差が出る。器（`MyDishOwnReviewSheet`）は Modal の **兄弟**としてこの中身を並べる。
			*/}
			<EditDishReviewModal
				review={editingReview}
				onClose={() => setEditingReview(null)}
				onSaved={setSavedOverride}
				logPayload={{ itemKey: item.key, from: `my-dishes-own-review-${variant}` }}
			/>
		</>
	);
}

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		header: {
			flexDirection: "row",
			alignItems: "center",
			gap: 8,
		},
		title: {
			flex: 1,
			fontSize: 17,
			fontWeight: "700",
			color: colors.textPrimaryAlt,
		},
		dishName: {
			marginTop: 2,
			fontSize: 13,
			color: colors.textSecondary,
		},
		mediaNotice: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: 6,
			marginTop: 12,
			minHeight: 44,
			paddingHorizontal: 12,
			borderRadius: 12,
			backgroundColor: colors.surfaceMuted,
			overflow: "hidden",
		},
		/*
		全画面のページでは «跡地» に高さを与える。シートは下から出る帯なので 44pt の細い枠で
		足りるが、全画面で 44pt だけだと «上に細い線が 1 本あるだけ» に見えて、
		そこに写真があったことが伝わらない（墓標を出す意味が消える）。
		*/
		mediaNoticePage: {
			minHeight: 160,
		},
		tombstone: {
			...StyleSheet.absoluteFillObject,
		},
		mediaNoticeText: {
			fontSize: 13,
			color: colors.textTertiary,
		},
		body: {
			marginTop: 14,
		},
		bodyContent: {
			paddingBottom: 8,
		},
		sectionLabel: {
			fontSize: 12,
			fontWeight: "600",
			color: colors.textTertiary,
			marginBottom: 6,
		},
		metaRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: 10,
		},
		price: {
			fontSize: 13,
			fontWeight: "600",
			color: colors.textSecondary,
		},
		eatenOn: {
			marginTop: 4,
			fontSize: 12,
			color: colors.textTertiary,
		},
		comment: {
			marginTop: 10,
			fontSize: 15,
			lineHeight: 22,
			color: colors.textPrimaryAlt,
		},
		actionRow: {
			flexDirection: "row",
			gap: 10,
			marginTop: 16,
		},
		actionButton: {
			flex: 1,
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: 8,
			paddingVertical: 13,
			borderRadius: 12,
			borderWidth: 1,
			borderColor: colors.borderMuted,
		},
		actionButtonText: {
			fontSize: 15,
			fontWeight: "600",
			color: colors.textPrimaryAlt,
		},
		destructiveText: {
			color: colors.danger,
		},
		restaurantButton: {
			marginTop: 10,
			paddingVertical: 12,
			alignItems: "center",
		},
		restaurantButtonText: {
			fontSize: 14,
			fontWeight: "600",
			color: colors.textSecondary,
		},
	});
