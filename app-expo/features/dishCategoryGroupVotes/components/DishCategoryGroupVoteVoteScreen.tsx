/**
 * #856 【責務】
 * 投票フローの本体を扱う。
 *
 * 最後の候補まで到達したら完了モーダルへ送り、送信完了まではこの画面内で完結させる。
 */
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { SubmitDishCategoryGroupVoteDto } from "@shared/api/v1/dto";
import type { DishCategoryGroupVoteReaction } from "@shared/api/v1/res";
import i18n from "@/lib/i18n";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLogger } from "@/hooks/useLogger";
import { useDishCategoryGroupVoteActions } from "../hooks/useDishCategoryGroupVoteActions";
import { useDishCategoryGroupVoteDetail } from "../hooks/useDishCategoryGroupVoteDetail";
import type { DishCategoryGroupVoteDraftVote } from "../types";
import { DishCategoryGroupVoteCompletionModal } from "./DishCategoryGroupVoteCompletionModal";
import { DishCategoryGroupVoteVoteCard } from "./DishCategoryGroupVoteVoteCard";

type Props = {
	shareToken: string;
};

export function DishCategoryGroupVoteVoteScreen({ shareToken }: Props) {
	const { showSnackbar } = useSnackbar();
	const { logFrontendEvent } = useLogger();
	const { detail, isLoading, error, refresh } = useDishCategoryGroupVoteDetail(shareToken);
	const { submitVote } = useDishCategoryGroupVoteActions({
		sessionId: detail?.session.id,
		refresh,
	});
	const [index, setIndex] = useState(0);
	const [votes, setVotes] = useState<DishCategoryGroupVoteDraftVote[]>([]);
	const [isCompletionOpen, setIsCompletionOpen] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const voteCandidates = useMemo(() => {
		// #856 【設計】投票開始時点の未削除候補だけを対象にする。
		// 送信時 API は deleted_at を問わないため、投票中のホスト削除レースでも完走できる。
		return detail?.candidates.filter((candidate) => candidate.deletedAt === null) ?? [];
	}, [detail?.candidates]);

	useEffect(() => {
		if (detail?.session.hasVoted) {
			router.back();
		}
	}, [detail?.session.hasVoted]);

	const usedDisplayNames = useMemo(() => {
		const names = new Set<string>();
		detail?.comments.forEach((comment) => names.add(comment.displayName));
		detail?.candidates.forEach((candidate) => {
			candidate.votes.forEach((vote) => names.add(vote.displayName));
		});
		return [...names];
	}, [detail?.candidates, detail?.comments]);

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
			setIsCompletionOpen(true);
			return;
		}
		setIndex((current) => current + 1);
	};

	const handleSubmit = async ({ displayName, comment }: { displayName: string; comment?: string }) => {
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
			setIsCompletionOpen(false);
			router.back();
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
			setIsSubmitting(false);
		}
	};

	if (isLoading && !detail) {
		return (
			<SafeAreaView style={styles.center}>
				<ActivityIndicator />
			</SafeAreaView>
		);
	}

	if (error || !detail) {
		return (
			<SafeAreaView style={styles.center}>
				<Text style={styles.errorText}>{i18n.t("DishCategoryGroupVotes.loadFailed")}</Text>
				<TouchableOpacity style={styles.primaryButton} onPress={() => refresh()} activeOpacity={0.85}>
					<Text style={styles.primaryButtonText}>{i18n.t("Common.retry")}</Text>
				</TouchableOpacity>
			</SafeAreaView>
		);
	}

	const currentCandidate = voteCandidates[index];

	return (
		<SafeAreaView style={styles.safeArea}>
			<View style={styles.header}>
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
			<DishCategoryGroupVoteCompletionModal
				visible={isCompletionOpen}
				usedDisplayNames={usedDisplayNames}
				isSubmitting={isSubmitting}
				onSubmit={handleSubmit}
			/>
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
	},
	progress: {
		fontSize: 14,
		fontWeight: "800",
		color: "#4B5563",
		textAlign: "center",
	},
	center: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		gap: 12,
		padding: 24,
		backgroundColor: "#F9FAFB",
	},
	errorText: {
		fontSize: 15,
		color: "#374151",
		textAlign: "center",
	},
	primaryButton: {
		height: 46,
		borderRadius: 8,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#111827",
		paddingHorizontal: 18,
	},
	primaryButtonText: {
		color: "#FFFFFF",
		fontSize: 15,
		fontWeight: "800",
	},
});
