import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import { Flag, Heart } from "lucide-react-native";
import Stars from "@/components/Stars";
import { formatLikeCount, sliceByUnitLimit } from "../utils/text";
import { dateStringToTimestamp } from "@/lib/frontend-utils";
import { useLogger } from "@/hooks/useLogger";
import { getRemoteConfig } from "@/lib/remoteConfig";
import { useHaptics } from "@/hooks/useHaptics";
import { useAPICall } from "@/hooks/useAPICall";
import i18n from "@/lib/i18n";
import {
	DishMediaEntriesStore,
	selectReviewsByMediaId,
	selectReviewByReviewId,
	useDishMediaEntriesStore,
	IdType,
} from "@/stores/useDishMediaEntriesStore";
import { shallow } from "zustand/shallow";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { useAuth } from "@/contexts/AuthProvider";
import { ReportContentSheet } from "./ReportContentSheet";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { FixedColors } from "@/constants/Palette";

interface DishReviewsSectionProps {
	id: string;
	idType: IdType;
	paddingRight: number;
	carouselRef: React.RefObject<any> | undefined;
}

// コメントの表示のみを担当。状態変更は親側のコールバックに委譲
export function DishReviewsSection({ id, idType, paddingRight, carouselRef }: DishReviewsSectionProps) {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();
	const { user } = useAuth();
	const { showSnackbar } = useSnackbar();
	// #1599 二重タップで 2 発飛ぶのを防ぐ。楽観更新より前に弾くこと
	// （後にすると 2 発目がトグルを戻してから弾かれ、表示だけ巻き戻る）。
	// ActionButtons の inFlightActionsRef（#1205）と同じ役割。
	const inFlightLikesRef = useRef<Set<string>>(new Set());

	const selector = useCallback(
		(state: DishMediaEntriesStore) => {
			// idType に応じて適切なセレクタを使用
			if (idType === "dish_media") {
				return selectReviewsByMediaId(id)(state);
			} else {
				// dish_reviews の場合は単一のレビューを配列で返す
				const review = selectReviewByReviewId(id)(state);
				return review ? [review] : [];
			}
		},
		[id, idType],
	);
	const reviews = useDishMediaEntriesStore(selector, shallow);

	// コメントを最下部までスクロールする
	//
	// #817 【設計】この挙動は従来どおり維持する。レビュー欄は画面下部に固定され、
	// created_at 昇順（#509「古い→新しい」）の最新が最下部に来る。つまり
	// **プライム位置は末尾** であり、scrollToEnd はその着地点を保証している。
	// グラデーションも下ほど濃く、下端のほうが可読性が高い。
	//
	// 優先言語の反映は API 側の並び順（prioritizeReviewsByLanguage）が
	// 優先言語を *末尾* へ寄せることで行う。ここを触る必要はない。
	const scrollViewRef = useRef<ScrollView>(null);
	useEffect(() => {
		scrollViewRef.current?.scrollToEnd({ animated: false });
	}, [reviews.length]);

	// State to track expanded characters count for each comment
	const [commentExpandedChars, setCommentExpandedChars] = useState(
		reviews.reduce(
			(acc, review) => {
				const remoteConfig = getRemoteConfig();
				const charLimit = parseInt(remoteConfig?.v1_dish_comment_review_show_number!, 10);
				// Interpret as unit limit (FW=2, half=1)
				acc[review.id] = charLimit;
				return acc;
			},
			{} as { [key: string]: number },
		),
	);
	const handleSeeMore = (reviewId: string) => {
		lightImpact();
		const remoteConfig = getRemoteConfig();
		const charUnitIncrement = parseInt(remoteConfig?.v1_dish_comment_review_show_number!, 10);

		setCommentExpandedChars((prev) => ({
			...prev,
			[reviewId]: prev[reviewId] + charUnitIncrement,
		}));

		logFrontendEvent({
			event_name: "review_see_more_clicked",
			error_level: "log",
			payload: {
				reviewId,
				previousExpandedChars: commentExpandedChars[reviewId],
				newExpandedChars: commentExpandedChars[reviewId] + charUnitIncrement,
				unitIncrement: charUnitIncrement,
			},
		});
	};

	// #1599 【バグ】ここは楽観更新だけして、**失敗しても戻していなかった**。
	// オフライン・タイムアウト・5xx で callBackend が reject しても catch はログを送るだけで、
	// 画面は「いいね済み」のまま残る。通知も出ないので、ユーザーには
	// サーバーへ届いていないことを知る手段が無い（次にこの画面を開き直すと消えている）。
	//
	// 投稿本体のいいね（ActionButtons.tsx）は #1501 でロールバックとリトライ Snackbar を
	// 入れてある。**同じ画面の同じジェスチャーで、レビュー側だけが取り残されていた。**
	// 挙動を揃える。
	const handleReviewLike = useCallback(
		async (reviewId: string) => {
			// 楽観更新より前に弾く（下の #1205 のコメント参照）
			if (inFlightLikesRef.current.has(reviewId)) return;
			inFlightLikesRef.current.add(reviewId);

			lightImpact();
			const { reviewsByReviewId, updateReview } = useDishMediaEntriesStore.getState();
			const review = reviewsByReviewId[reviewId];
			if (!review) {
				inFlightLikesRef.current.delete(reviewId);
				return;
			}
			const currentLikeState = review.isLiked || false;
			const willLike = !currentLikeState;
			// #1501 と同じ作法。戻す値は `!willLike`（トグルの反転）ではなく、
			// **楽観更新の直前に読んだ値そのもの**を持つ。反転で戻すと、他端末や
			// 別画面からの更新が割り込んでいた場合に誤った値を書き戻す。
			const previousIsLiked = currentLikeState;
			const previousLikeCount = review.likeCount;
			const newLikeCount = willLike ? review.likeCount + 1 : Math.max(0, review.likeCount - 1);
			updateReview(review.id, (r) => ({
				...r,
				isLiked: willLike,
				likeCount: newLikeCount,
			}));

			logFrontendEvent({
				event_name: currentLikeState ? "review_unliked" : "review_liked",
				error_level: "log",
				payload: {
					reviewId: review.id,
				},
			});

			try {
				await callBackend<{}, void>(`v1/dish-reviews/${review.id}/likes`, {
					method: willLike ? "POST" : "DELETE",
					requestPayload: {},
				});
			} catch (error) {
				// 表示をサーバーと一致させるため、操作前の値へ戻す
				updateReview(review.id, (r) => ({
					...r,
					isLiked: previousIsLiked,
					likeCount: previousLikeCount,
				}));

				logFrontendEvent({
					event_name: "review_like_reaction_failed",
					// 黙って戻すと «勝手に取り消された» に見えるので、起票対象の warn へ上げる
					error_level: "warn",
					payload: {
						error: toErrorLogMessage(error),
						target_id: review.id,
						action_type: "like",
					},
				});
				// 文言は投稿本体のいいねと共用（「いいねの更新に失敗しました」）。
				// レビュー専用の文言を足すと 8 ロケール増えるが、伝える内容は同じ
				showSnackbar(i18n.t("DishMediaContent.errors.likeReactionFailed"), {
					action: { label: i18n.t("Common.retry"), onPress: () => void handleReviewLike(reviewId) },
				});
			} finally {
				// #1205 失敗しても押し直せるよう、成功・失敗のいずれでも必ず解除する
				inFlightLikesRef.current.delete(reviewId);
			}
		},
		[callBackend, lightImpact, logFrontendEvent, showSnackbar],
	);

	// #1514 (SAF-01) レビューの通報。
	//
	// 開いているレビューを 1 件だけ持つ。レビュー行ごとにシートを描くと、
	// 画面に出ている件数ぶん Modal が積まれる（レビューは 1 投稿に何件でも付く）。
	//
	// 通報しても表示は変えないので、ここにも「通報済みかどうか」は持たない。
	// 送信の冪等性は API 側にあり、2 回目も «受け付けました» としか見えない。
	const [reportTarget, setReportTarget] = useState<{ id: string; username: string } | null>(null);

	const handleReportPress = (reviewId: string, username: string) => {
		lightImpact();
		logFrontendEvent({
			event_name: "content_report_opened",
			error_level: "log",
			payload: { targetType: "dish_reviews", targetId: reviewId },
		});
		setReportTarget({ id: reviewId, username });
	};

	const handleReportSheetClose = () => setReportTarget(null);

	return (
		<LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.6)"]} style={styles.commentsGradient}>
			<ScrollView
				ref={scrollViewRef}
				style={[styles.commentsContainer, { paddingRight }]}
				showsVerticalScrollIndicator={false}
				nestedScrollEnabled={Platform.OS === "android"}
				simultaneousHandlers={carouselRef}>
				{reviews.map((review, index) => {
					const unitLimit = commentExpandedChars[review.id]!;
					const { substring, isTruncated } = sliceByUnitLimit(review.comment, unitLimit);
					const displayText = substring;

					// #1514 (SAF-01) 自分のレビューには通報を出さない。
					//
					// 自分で自分を通報しても運営のキューが増えるだけで、ユーザーには
					// 「消せるのかと思ったら消せない」としか映らない（レビューの削除導線は別）。
					// user が未確定（null）のあいだは «自分のものではない» に倒れて通報が出るが、
					// 押しても API が 404/重複で無害に終わるので、出ない側へ倒すより害が小さい。
					const isOwnReview = !!user?.id && review.user_id === user.id;

					return (
						<View key={review.id} style={styles.commentItem}>
							<View style={styles.commentHeader}>
								<Text style={styles.commentUsername}>{review.username}</Text>
								{/* #956 【仕様】投稿者が付けた星をコメントごとに表示する。
								    色はデフォルトの金だと動画の上で悪目立ちするため、
								    タイムスタンプと同じ `onMediaMuted` に合わせる */}
								<Stars rating={review.rating} size={11} color={FixedColors.onMediaMuted} />
								<Text style={styles.commentTimestamp}>{dateStringToTimestamp(review.created_at)}</Text>
							</View>
							<View style={styles.commentContent}>
								<View style={styles.commentTextContainer}>
									<Text style={styles.commentText}>
										{displayText}
										{isTruncated && "...  "}
										{isTruncated && (
											<TouchableOpacity
												style={styles.seeMoreButton}
												onPress={() => handleSeeMore(review.id)}
												accessibilityRole="button"
												accessibilityLabel={i18n.t("DishMediaContent.actions.seeMore")}>
												<Text style={styles.seeMoreText}>{i18n.t("DishMediaContent.actions.seeMore")}</Text>
											</TouchableOpacity>
										)}
									</Text>
								</View>
								<View style={styles.commentActions}>
									<TouchableOpacity
										style={styles.commentLikeButton}
										testID={`review-action-like-${review.id}`}
										onPress={() => handleReviewLike(review.id)}
										accessibilityRole="button"
										accessibilityLabel={i18n.t("DishMediaContent.accessibility.reviewLike", {
											username: review.username,
										})}
										aria-selected={review.isLiked ?? false}>
										<Heart
											size={14}
											color={review.isLiked ? FixedColors.likeActive : FixedColors.onMediaMuted}
											fill={review.isLiked ? FixedColors.likeActive : "transparent"}
										/>
									</TouchableOpacity>
									{review.likeCount > 0 && (
										<Text style={styles.commentLikeCount}>{formatLikeCount(review.likeCount)}</Text>
									)}
									{/* #1514 (SAF-01) レビューの通報導線。
									    いいねと同じ縦列に置く。投稿の通報（ActionButtons の右レール）は
									    投稿全体が対象なので、「このレビューを報告したい」の受け皿がここに要る */}
									{!isOwnReview && (
										<TouchableOpacity
											style={styles.commentReportButton}
											onPress={() => handleReportPress(review.id, review.username)}
											hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
											accessibilityRole="button"
											accessibilityLabel={i18n.t("Report.accessibility.openReview", {
												name: review.username,
											})}
											testID={`review-action-report-${review.id}`}>
											<Flag size={13} color={FixedColors.onMediaMuted} />
										</TouchableOpacity>
									)}
								</View>
							</View>
						</View>
					);
				})}
			</ScrollView>

			{/* 理由選択は投稿と同じコンポーネント。targetType だけが違う */}
			<ReportContentSheet
				visible={reportTarget !== null}
				targetType="dish_reviews"
				targetId={reportTarget?.id ?? ""}
				targetLabel={reportTarget?.username ?? ""}
				onClose={handleReportSheetClose}
			/>
		</LinearGradient>
	);
}

/*
#1629 このセクションは全画面のメディア（写真・動画）の上に、下端の黒いグラデーションと
一緒に載る。だからテーマで振らない（振ると、ライトのときにメディアの上へ黒い文字が出て
何も読めなくなる）。本文・ユーザー名は `onMedia`、日時・いいね数・星・通報は一段弱い
`onMediaMuted`、いいね済みのハートは `likeActive`。
*/
const styles = StyleSheet.create({
	commentsGradient: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		maxHeight: 200,
	},
	commentsContainer: {
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
	commentItem: {
		marginBottom: 12,
	},
	commentHeader: {
		flexDirection: "row",
		alignItems: "center",
		marginBottom: 4,
	},
	commentUsername: {
		fontSize: 14,
		fontWeight: "600",
		color: FixedColors.onMedia,
		marginRight: 8,
		letterSpacing: 0.1,
	},
	commentTimestamp: {
		fontSize: 12,
		color: FixedColors.onMediaMuted,
		fontWeight: "500",
	},
	commentContent: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "flex-start",
	},
	commentTextContainer: {
		flex: 1,
		marginRight: 8,
	},
	commentText: {
		fontSize: 14,
		color: FixedColors.onMedia,
		lineHeight: 20,
		fontWeight: "400",
	},
	seeMoreButton: {},
	seeMoreText: {
		fontSize: 12,
		color: FixedColors.onMediaMuted,
		fontWeight: "500",
	},
	commentActions: {
		alignItems: "center",
		width: 18,
	},
	commentLikeButton: {
		paddingVertical: 4,
	},
	commentLikeCount: {
		fontSize: 12,
		color: FixedColors.onMediaMuted,
		fontWeight: "500",
	},
	commentReportButton: {
		paddingTop: 6,
	},
});
