import React, { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ellipsis, Flag, Pencil, Share, Trash2 } from "lucide-react-native";

import i18n from "@/lib/i18n";
// #1513 «…» ボタンだけは常に暗いメディアの上に載るのでテーマ非追従（FixedColors）。
// シート本体は画面の面なのでテーマ追従のトークンを使う
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { useLogger } from "@/hooks/useLogger";
import { useHaptics } from "@/hooks/useHaptics";
import { useSheetBottomPadding } from "@/hooks/useSheetBottomPadding";
import { useAPICall, type ApiError } from "@/hooks/useAPICall";
import { useDialog } from "@/contexts/DialogProvider";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { toErrorLogMessage } from "@/lib/errorMessage";
import {
	selectReviewsByMediaId,
	useDishMediaEntriesStore,
	type DishReview,
	type NormalizedDishMediaEntry,
} from "@/stores/useDishMediaEntriesStore";
import { shallow } from "zustand/shallow";
import { bumpMyDishesRevision } from "@/features/myDishes/stores/useMyDishesRevisionStore";
import type { DeleteDishMediaResponse, DeleteDishReviewResponse, UpdateDishReviewResponse } from "@shared/api/v1/res";
import { EditDishReviewModal, EDIT_MEDIA_LOCKED_NOTE_TEST_ID } from "./EditDishReviewModal";

/** シート下端のデザイン上の余白。実際の余白はこれに safe area の inset を足したもの */
const SHEET_PADDING_BOTTOM = 32;

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

// #1629 編集フォーム本体は `EditDishReviewModal` へ移した（写真の無い記録からも開くため）。
// 注記の testID は e2e が見ているので、あちらの値をそのまま再輸出する
export { EDIT_MEDIA_LOCKED_NOTE_TEST_ID };

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
	// #1742 Modal はネイティブでは別ウィンドウで、画面側の safe area が届かない。
	// 足さないと最下行「キャンセル」が Android のナビゲーションバーへ潜る（hooks/useSheetBottomPadding.ts）
	const sheetPaddingBottom = useSheetBottomPadding(SHEET_PADDING_BOTTOM);
	const dishMediaId = String(entry.dish_media.id);
	// #1629 編集・削除の行だけを出し分ける。«…» 自体は誰の投稿でも出す
	const isMine = !!entry.dish_media.isMine;
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();
	const { confirm } = useDialog();
	const { showSnackbar } = useSnackbar();

	const reviewsSelector = useCallback(selectReviewsByMediaId(dishMediaId), [dishMediaId]);
	const reviews = useDishMediaEntriesStore(reviewsSelector, shallow);

	/**
	 * 編集・削除の対象になる «この投稿の中の自分のレビュー»。
	 *
	 * 所有判定は `review.isMine`（サーバーが返す）を使い、クライアントで
	 * `user_id === 自分の id` を組み立てない。導線を出す根拠と PATCH の認可の根拠を
	 * 同じにしておかないと、「編集ボタンは出るのに 403」がありうる。
	 *
	 * 探す順番は 2 段。
	 *
	 * 1. `created_dish_media_id === この dish_media.id` … この投稿と一緒に作られた自分のレビュー
	 * 2. `created_dish_media_id === null` … **クチコミのみの記録**（写真を撮らずに «食べた» を
	 *    記録したもの。`ReviewForm` の `mediaState.status === "none"` 経路で、
	 *    `POST /v1/dish-reviews` を `createdDishMediaId` 無しで叩いた行）
	 *
	 * #1629【36】オーナー実機報告「クチコミのみの投稿を編集・削除できない」の**片方の真因がここ**。
	 * 以前は 1 だけを見ており、しかも `String(null)` が `"null"` になるので、
	 * クチコミのみの記録は **絶対に一致しなかった**。サーバーはその dish に付いた自分のレビューを
	 * どのメディアの `dish_reviews` にも載せて返す（`dish-media.repository.ts` の
	 * `reviewsByDishMediaId` は «その料理の全レビュー»）ので、画面には自分のクチコミが
	 * 出ているのに編集の導線だけが無い、という状態になっていた。
	 *
	 * ⚠️ **他の投稿に紐づく自分のレビュー（`created_dish_media_id` が別の id）は拾わない。**
	 *    同じ料理には別の投稿の自分のレビューもぶら下がる。この投稿の本文以外を
	 *    編集画面に出してはいけない。
	 */
	const myReview: DishReview | undefined = useMemo(() => {
		const mine = reviews.filter((review) => review.isMine);
		return (
			mine.find((review) => String(review.created_dish_media_id) === dishMediaId) ??
			// #1629【36】クチコミのみ（写真なし）の記録。`== null` で undefined も拾う
			mine.find((review) => review.created_dish_media_id == null)
		);
	}, [reviews, dishMediaId]);

	/*
	#1629【36】【設計】**「削除」が何を消すかは «自分が持っているもの» で決まる。**

	- 写真も自分のもの（`dish_media.isMine`）… 投稿ごと消す（`DELETE /v1/dish-media/:id`）。
	  サーバーはこのとき一緒に作られた自分のレビューも巻き添えで消す（#1513 のオーナー確定仕様）
	- 写真は他人のもので、自分のクチコミだけがある … **クチコミ 1 件だけ**を消す
	  （`DELETE /v1/dish-reviews/:id`）。他人の写真を消す権限は無いので投稿ごとは消せない

	この分岐が無かったため、クチコミのみの記録では削除の行がそもそも出ず（`isMine` が false）、
	利用者からは «自分が書いたのに消せない» に見えていた。API（#1513 で実装済み）も
	ストアの `removeDishReview`（同じく #1513）も**呼び出し元が 1 つも無いまま眠っていた**。
	*/
	const canDeletePost = isMine;
	const canDeleteReview = !isMine && myReview !== undefined;
	const canDelete = canDeletePost || canDeleteReview;

	const [menuVisible, setMenuVisible] = useState(false);
	// #1629 編集フォームは `EditDishReviewModal` が持つ。ここは «どのレビューを開くか» だけ
	const [editingReview, setEditingReview] = useState<DishReview | null>(null);

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
		setEditingReview(myReview);
	}, [myReview]);

	/**
	 * 保存されたらストアを差し替える。サーバーが返した行で置き換えること
	 * （`lock_no` を進めないと、続けてもう一度編集したときに古い値で 409 になる）。
	 */
	const handleSaved = useCallback(
		(updated: UpdateDishReviewResponse) => {
			if (!editingReview) return;
			useDishMediaEntriesStore.getState().updateReview(editingReview.id, (review) => ({
				...review,
				...updated,
			}));
		},
		[editingReview],
	);

	/**
	 * 削除。取り返しがつかないので必ず確認を挟む。
	 * 成功したらストアからも取り除く（サーバーは論理削除だが、既に読み込み済みの
	 * 画面は再取得しない限り持ち続けるため）。
	 *
	 * #1629【36】消す単位は `canDeletePost` / `canDeleteReview` で決まる（上の設計コメント）。
	 * 文言も «投稿を削除» と «クチコミを削除» で分ける。同じ「削除する」でも消えるものが
	 * 違うので、確認ダイアログで «写真も消えるのか» が読めないと押せない。
	 */
	const handleDelete = useCallback(async () => {
		setMenuVisible(false);

		const accepted = await confirm(
			canDeletePost
				? {
						title: i18n.t("DishMediaContent.ownPost.deleteConfirmTitle"),
						message: i18n.t("DishMediaContent.ownPost.deleteConfirmMessage"),
						confirmLabel: i18n.t("DishMediaContent.ownPost.deleteConfirmButton"),
						cancelLabel: i18n.t("DishMediaContent.ownPost.cancel"),
					}
				: {
						title: i18n.t("DishMediaContent.ownPost.deleteReviewConfirmTitle"),
						message: i18n.t("DishMediaContent.ownPost.deleteReviewConfirmMessage"),
						confirmLabel: i18n.t("DishMediaContent.ownPost.deleteConfirmButton"),
						cancelLabel: i18n.t("DishMediaContent.ownPost.cancel"),
					},
		);
		if (!accepted) return;

		try {
			if (canDeletePost) {
				const result = await callBackend<Record<string, never>, DeleteDishMediaResponse>(
					`v1/dish-media/${dishMediaId}`,
					{
						method: "DELETE",
						requestPayload: {},
					},
				);
				useDishMediaEntriesStore.getState().removeDishMediaEntry(dishMediaId);
				logFrontendEvent({
					event_name: "own_post_deleted",
					error_level: "log",
					payload: { dishMediaId, deletedDishReviewCount: result.deletedDishReviewIds.length },
				});
			} else {
				// #1629【36】他人の写真に付いた自分のクチコミ。消せるのはレビュー 1 件だけ
				if (!myReview) return;
				await callBackend<Record<string, never>, DeleteDishReviewResponse>(`v1/dish-reviews/${myReview.id}`, {
					method: "DELETE",
					requestPayload: {},
				});
				useDishMediaEntriesStore.getState().removeDishReview(String(myReview.id));
				logFrontendEvent({
					event_name: "own_review_deleted",
					error_level: "log",
					payload: { dishMediaId, reviewId: myReview.id },
				});
			}
			// #1398 の版数（設計 (1/2) §3）。削除は «食べた» が 1 行消えるだけでなく、
			// その dish の «食べたい» が復活しうる（want 枝の NOT EXISTS が外れる）ので、
			// 一覧・Map のピン・Calendar の月・meta.oldestOccurredAt のどれにも波及する。
			// クチコミのみの削除でも同じ（«食べた» の根拠は dish_reviews の行そのもの）
			bumpMyDishesRevision();
			showSnackbar(
				i18n.t(canDeletePost ? "DishMediaContent.ownPost.deleted" : "DishMediaContent.ownPost.reviewDeleted"),
			);
		} catch (error) {
			const status = (error as ApiError)?.status;
			showSnackbar(
				status === 403
					? i18n.t("DishMediaContent.ownPost.forbidden")
					: i18n.t(
							canDeletePost ? "DishMediaContent.ownPost.deleteFailed" : "DishMediaContent.ownPost.reviewDeleteFailed",
						),
			);
			logFrontendEvent({
				event_name: "own_post_delete_failed",
				error_level: "warn",
				payload: { dishMediaId, status, error: toErrorLogMessage(error) },
			});
		}
	}, [confirm, callBackend, canDeletePost, dishMediaId, logFrontendEvent, myReview, showSnackbar]);

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
					<Pressable
						testID="own-post-menu"
						style={[styles.sheet, { paddingBottom: sheetPaddingBottom }]}
						onPress={() => {}}>
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

						{/*
						  ここから下は «自分のものがある» ときだけ出る。

						  #1629【36】判定を `isMine`（写真の持ち主）から **`myReview`（クチコミの持ち主）**へ
						  変えた。編集で触るのは `PATCH /v1/dish-reviews/:id` であり、サーバーの認可も
						  レビューの所有者しか見ていない。写真の所有と揃える理由が無いどころか、
						  **クチコミのみの記録（写真は他人のもの）で自分の本文を直せない**原因になっていた。
						*/}
						{myReview && (
							<TouchableOpacity
								testID="own-post-edit-button"
								style={styles.sheetRow}
								onPress={openEdit}
								accessibilityRole="button">
								<Pencil size={20} color={colors.textPrimaryAlt} />
								<Text style={styles.sheetRowText}>{i18n.t("DishMediaContent.ownPost.edit")}</Text>
							</TouchableOpacity>
						)}

						{/*
						  #1513 削除の行は **常に 1 つ**。«写真を削除» と «レビューを削除» の 2 択へは
						  戻さない（利用者に «写真だけ消したら記録は残るのか» を判断させないため）。
						  #1629【36】消える単位が違うので、文言だけを出し分ける。
						*/}
						{canDelete && (
							<TouchableOpacity
								testID="own-post-delete-button"
								style={styles.sheetRow}
								onPress={handleDelete}
								accessibilityRole="button">
								<Trash2 size={20} color={colors.danger} />
								<Text style={[styles.sheetRowText, styles.destructiveText]}>
									{i18n.t(canDeletePost ? "DishMediaContent.ownPost.delete" : "DishMediaContent.ownPost.deleteReview")}
								</Text>
							</TouchableOpacity>
						)}

						{/* #1513 メディア差し替えの導線が「無い」ことを明示する。
						    ここが無いと、写真を変えたい利用者は探し続けることになる。
						    #1629【36】条件を «編集が出るとき» に揃えた（`isMine` だと、クチコミのみの
						    記録で «編集はあるのに注記が無い» になる） */}
						{myReview && (
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
			{/* #1629 フォーム本体は共有コンポーネント。写真の無い «食べた» 記録
			    （`MyDishOwnReviewSheet`）からも同じものが開く */}
			<EditDishReviewModal
				review={editingReview}
				onClose={() => setEditingReview(null)}
				onSaved={handleSaved}
				logPayload={{ dishMediaId, from: "feed" }}
			/>
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
			// paddingBottom は safe area を足すため呼び出し側で組む（SHEET_PADDING_BOTTOM）
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
	});
