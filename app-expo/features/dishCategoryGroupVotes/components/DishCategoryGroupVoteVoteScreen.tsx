/**
 * #856 【責務】
 * 投票フローの本体を扱う。
 *
 * 最後の候補まで到達したら完了モーダルへ送り、送信完了まではこの画面内で完結させる。
 */
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { SafeAreaView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { SubmitDishCategoryGroupVoteDto } from "@shared/api/v1/dto";
import type { DishCategoryGroupVoteReaction } from "@shared/api/v1/res";
import i18n from "@/lib/i18n";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLogger } from "@/hooks/useLogger";
import { useLocale } from "@/hooks/useLocale";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
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
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const { height: windowHeight } = useWindowDimensions();
	const { detail, isLoading, error, refresh } = useDishCategoryGroupVoteDetail(shareToken);
	const { submitVote } = useDishCategoryGroupVoteActions({
		sessionId: detail?.session.id,
		refresh,
	});
	const {
		BlurModal: CompletionBlurModal,
		open: openCompletionModal,
		close: closeCompletionModal,
	} = useBlurModal({
		closeOnBackdropPress: false,
		backHandlerEnabled: false,
	});
	const [index, setIndex] = useState(0);
	const [votes, setVotes] = useState<DishCategoryGroupVoteDraftVote[]>([]);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const voteCandidates = useMemo(() => {
		// #856 【設計】投票開始時点の未削除候補だけを対象にする。
		// 送信時 API は deleted_at を問わないため、投票中のホスト削除レースでも完走できる。
		return detail?.candidates.filter((candidate) => candidate.deletedAt === null) ?? [];
	}, [detail?.candidates]);

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
			openCompletionModal();
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
			closeCompletionModal();
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
			<CompletionBlurModal
				showCloseButton={false}
				contentContainerStyle={[styles.completionBackdrop, { minHeight: windowHeight }]}
				paddingVertical={0}>
				<DishCategoryGroupVoteCompletionModal
					usedDisplayNames={usedDisplayNames}
					isSubmitting={isSubmitting}
					onSubmit={handleSubmit}
				/>
			</CompletionBlurModal>
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
	completionBackdrop: {
		padding: 20,
		justifyContent: "center",
		alignItems: "center",
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
