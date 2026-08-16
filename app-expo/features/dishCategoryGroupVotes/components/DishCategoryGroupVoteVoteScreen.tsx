/**
 * #856 【責務】
 * 投票フローの本体を扱う。
 *
 * 最後の候補まで到達したら完了入力へ切り替え、送信完了まではこの画面内で完結させる。
 * #1358 その完了入力も Portal ではなく同画面内のレイヤーとして描く（DishCategoryGroupVoteInlineOverlay）。
 */
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, SafeAreaView, StyleSheet, Text, View } from "react-native";
import type { SubmitDishCategoryGroupVoteDto } from "@shared/api/v1/dto";
import type { DishCategoryGroupVoteReaction } from "@shared/api/v1/res";
import i18n from "@/lib/i18n";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLogger } from "@/hooks/useLogger";
import { useLocale } from "@/hooks/useLocale";
import { useDishCategoryGroupVoteActions } from "../hooks/useDishCategoryGroupVoteActions";
import { useDishCategoryGroupVoteDetail } from "../hooks/useDishCategoryGroupVoteDetail";
import type { DishCategoryGroupVoteDraftVote } from "../types";
import { DishCategoryGroupVoteCompletionModal } from "./DishCategoryGroupVoteCompletionModal";
import { DishCategoryGroupVoteInlineOverlay } from "./DishCategoryGroupVoteInlineOverlay";
import { DishCategoryGroupVoteVoteCard } from "./DishCategoryGroupVoteVoteCard";

type Props = {
	shareToken: string;
};

export function DishCategoryGroupVoteVoteScreen({ shareToken }: Props) {
	const { showSnackbar } = useSnackbar();
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const { detail, isLoading, error, refresh } = useDishCategoryGroupVoteDetail(shareToken);
	const { submitVote } = useDishCategoryGroupVoteActions({
		sessionId: detail?.session.id,
		refresh,
	});
	/**
	 * #1358 【設計】最後の候補まで投票し終えた状態。完了入力は「この画面の最終ステップ」であって
	 * 別レイヤーではないため、状態変数 1 つで同画面内へ描き分ける。
	 *
	 * 以前は useBlurModal（Portal）で載せていたが、閉じるボタン無し・背景タップ無効・全画面という
	 * 指定だった時点で実質は画面であり、Portal に置く理由が無かった。ナビゲーション履歴の外に
	 * 絶対配置レイヤーを積むと、遷移・戻る・URL と噛み合わない（#1350 / 具体的な破綻は #1122）。
	 */
	const [isCompleted, setIsCompleted] = useState(false);
	const [index, setIndex] = useState(0);
	const [votes, setVotes] = useState<DishCategoryGroupVoteDraftVote[]>([]);
	const [isSubmitting, setIsSubmitting] = useState(false);
	/**
	 * #1205 【修正】投票送信の多重実行を防ぐ同期ガード。
	 *
	 * `isSubmitting`（useState）は完了モーダルのボタンを disabled にする表示用途で、
	 * 多重実行の判定には使えない。React が再レンダリングをコミットする前に 2 発目が
	 * 処理されると、両方が `isSubmitting === false` を読んで通過しうる。
	 *
	 * サーバは `ConflictException('Already voted')` で二重登録自体は防ぐが、
	 * **1 発目が成功して `router.replace` した直後に 2 発目が 409 で返ってくる**ため、
	 * 結果画面の上に「送信に失敗しました」のスナックバーが出る。
	 * 投票は成功しているのに失敗表示になる、いちばん紛らわしい壊れ方になる。
	 *
	 * 解除は finally の 1 箇所（成功・失敗のどちらでも通る）。
	 */
	const isSubmittingRef = useRef(false);

	const voteCandidates = useMemo(() => {
		// #856 【設計】投票開始時点の未削除候補だけを対象にする。
		// 送信時 API は deleted_at を問わないため、投票中のホスト削除レースでも完走できる。
		return detail?.candidates.filter((candidate) => candidate.deletedAt === null) ?? [];
	}, [detail?.candidates]);

	// #945 【仕様】スワイプ/ボタンどちらの操作でもカードが切り替わったことを読み上げる
	useEffect(() => {
		const candidate = voteCandidates[index];
		if (!candidate) return;
		AccessibilityInfo.announceForAccessibility(
			i18n.t("DishCategoryGroupVotes.voteProgressAnnouncement", {
				current: index + 1,
				total: voteCandidates.length,
				title: candidate.displayName,
			}),
		);
	}, [index, voteCandidates]);

	useEffect(() => {
		if (detail?.session.hasVoted) {
			router.replace({
				pathname: "/[locale]/(tabs)/search/dish-category-group-votes/[shareToken]",
				params: {
					locale,
					shareToken,
				},
			});
		}
	}, [detail?.session.hasVoted, locale, shareToken]);

	const usedDisplayNames = useMemo(() => {
		return detail?.participants.map((participant) => participant.displayName) ?? [];
	}, [detail?.participants]);

	const handleVote = (reaction: DishCategoryGroupVoteReaction) => {
		const candidate = voteCandidates[index];
		if (!candidate) return;

		logFrontendEvent({
			event_name: "dish_category_group_vote_choice_selected",
			error_level: "log",
			payload: { shareToken, candidateId: candidate.id, reaction, index },
		});
		const nextVotes = [...votes, { candidateId: candidate.id, reaction }];
		setVotes(nextVotes);

		if (index >= voteCandidates.length - 1) {
			setIsCompleted(true);
			return;
		}
		setIndex((current) => current + 1);
	};

	const handleSubmit = async ({ displayName, comment }: { displayName: string; comment?: string }) => {
		// #1205 多重実行の判定は ref で行う（宣言箇所のコメント参照）。
		// ここより後に submitVote / router.replace を書くこと
		if (isSubmittingRef.current) return;
		isSubmittingRef.current = true;

		const dto: SubmitDishCategoryGroupVoteDto = {
			displayName,
			comment,
			votes,
		};

		setIsSubmitting(true);
		try {
			logFrontendEvent({
				event_name: "dish_category_group_vote_submit_started",
				error_level: "log",
				payload: { shareToken, voteCount: dto.votes.length },
			});
			await submitVote(dto);
			setIsCompleted(false);
			router.replace({
				pathname: "/[locale]/(tabs)/search/dish-category-group-votes/[shareToken]",
				params: {
					locale,
					shareToken,
				},
			});
			logFrontendEvent({
				event_name: "dish_category_group_vote_submit_succeeded",
				error_level: "log",
				payload: { shareToken, voteCount: dto.votes.length },
			});
		} catch {
			logFrontendEvent({
				event_name: "dish_category_group_vote_submit_failed",
				error_level: "error",
				payload: { shareToken, voteCount: dto.votes.length },
			});
			showSnackbar(i18n.t("DishCategoryGroupVotes.submitFailed"));
		} finally {
			// #1205 送信失敗後も押し直せるよう、成功・失敗のいずれでも必ず解除する
			isSubmittingRef.current = false;
			setIsSubmitting(false);
		}
	};

	if (isLoading && !detail) {
		return (
			<SafeAreaView style={styles.center}>
				<LoadingIndicator size="large" />
			</SafeAreaView>
		);
	}

	if (error || !detail) {
		return (
			<SafeAreaView style={styles.center}>
				<Text style={styles.errorText}>{i18n.t("DishCategoryGroupVotes.loadFailed")}</Text>
				<PrimaryButton label={i18n.t("Common.retry")} onPress={() => refresh()} style={styles.retryButton} />
			</SafeAreaView>
		);
	}

	const currentCandidate = voteCandidates[index];

	return (
		<SafeAreaView style={styles.safeArea}>
			<View style={styles.header}>
				<View style={styles.progressSegments}>
					{voteCandidates.map((candidate, segmentIndex) => (
						<View
							key={candidate.id}
							style={[
								styles.progressSegment,
								segmentIndex < getFilledProgressSegments(index, voteCandidates.length) && styles.progressSegmentActive,
							]}
						/>
					))}
				</View>
				<Text style={styles.progress}>
					{i18n.t("DishCategoryGroupVotes.voteProgress", {
						current: Math.min(index + 1, voteCandidates.length),
						total: voteCandidates.length,
					})}
				</Text>
			</View>
			{currentCandidate ? (
				<DishCategoryGroupVoteVoteCard candidate={currentCandidate} onVote={handleVote} />
			) : (
				<View style={styles.center}>
					<Text style={styles.errorText}>{i18n.t("DishCategoryGroupVotes.noVoteCandidates")}</Text>
				</View>
			)}
			{isCompleted ? (
				// #1358 閉じる導線を持たせない（＝ onRequestClose を渡さない）のは旧実装の
				// closeOnBackdropPress:false / backHandlerEnabled:false / showCloseButton:false と同じ意図。
				// 投票を全部終えた後に戻れる先はこの画面には無く、送信するかタブを離れるかしかない
				<DishCategoryGroupVoteInlineOverlay contentContainerStyle={styles.completionContent}>
					<DishCategoryGroupVoteCompletionModal
						usedDisplayNames={usedDisplayNames}
						isSubmitting={isSubmitting}
						onSubmit={handleSubmit}
					/>
				</DishCategoryGroupVoteInlineOverlay>
			) : null}
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	safeArea: {
		flex: 1,
		backgroundColor: "#F9FAFB",
	},
	header: {
		paddingHorizontal: 20,
		paddingTop: 16,
		gap: 10,
	},
	progress: {
		fontSize: 14,
		fontWeight: "800",
		color: "#4B5563",
		textAlign: "center",
	},
	progressSegments: {
		flexDirection: "row",
		gap: 6,
	},
	progressSegment: {
		flex: 1,
		height: 6,
		borderRadius: 999,
		backgroundColor: "#E5E7EB",
	},
	progressSegmentActive: {
		backgroundColor: "#F05537",
	},
	center: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		gap: 12,
		padding: 24,
		backgroundColor: "#F9FAFB",
	},
	completionContent: {
		padding: 20,
	},
	errorText: {
		fontSize: 15,
		color: "#374151",
		textAlign: "center",
	},
	retryButton: {
		minWidth: 160,
	},
});

function getFilledProgressSegments(index: number, total: number) {
	if (total <= 0) return 0;
	return Math.min(total, index + 1);
}
