/**
 * #856 【責務】
 * 共有リンクで入った後の結果画面をまとめる。
 *
 * ここでは detail 再取得、参加者数表示、共有導線、候補削除、店を見る起点を扱う。
 */
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import type { DishCategoryGroupVoteCandidate } from "@shared/api/v1/res";
import { generateShareUrl } from "@/lib/share";
import i18n from "@/lib/i18n";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useDialog } from "@/contexts/DialogProvider";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { SearchHeader } from "@/features/search/components/SearchHeader";
import { useDishCategoryGroupVoteActions } from "../hooks/useDishCategoryGroupVoteActions";
import { useDishCategoryGroupVoteDetail } from "../hooks/useDishCategoryGroupVoteDetail";
import { useDishCategoryGroupVoteRealtime } from "../hooks/useDishCategoryGroupVoteRealtime";
import { useCandidateDishMediaCache } from "../hooks/useCandidateDishMediaCache";
import { DishCategoryGroupVoteCandidateList } from "./DishCategoryGroupVoteCandidateList";
import { DishCategoryGroupVoteComments } from "./DishCategoryGroupVoteComments";
import { DishCategoryGroupVoteResultHeader } from "./DishCategoryGroupVoteResultHeader";

type Props = {
	shareToken: string;
};

export function DishCategoryGroupVoteResultScreen({ shareToken }: Props) {
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const { confirm } = useDialog();
	const { showSnackbar } = useSnackbar();
	const { detail, isLoading, error, refresh } = useDishCategoryGroupVoteDetail(shareToken);
	const actions = useDishCategoryGroupVoteActions({
		sessionId: detail?.session.id,
		refresh,
	});
	const { loadingCandidateId, openCandidateDishMedia } = useCandidateDishMediaCache({
		cacheCandidateDishMedia: actions.cacheCandidateDishMedia,
		searchContext: detail?.session.searchContext,
		onOpenCachedDishMedia: (candidate, dishMediaIds) => {
			// #856 【設計】posts 画面へ寄せて、既存の DishMediaMap / Feed 周りを再利用する。
			// entriesKey は group vote 起点の一時キーとして扱い、posts screen 側で明示的にクリーンアップする。
			router.push({
				pathname: "/[locale]/(tabs)/posts",
				params: {
					locale,
					ids: dishMediaIds.join(","),
					entriesKey: `dish-category-group-votes:${shareToken}:${candidate.id}`,
				},
			});
		},
	});

	useDishCategoryGroupVoteRealtime({
		sessionId: detail?.session.id,
		onParticipantInserted: () => {
			refresh().catch(() => {
				showSnackbar(i18n.t("DishCategoryGroupVotes.refreshFailed"));
			});
		},
	});

	const shareUrl = generateShareUrl(`/${locale}/dish-category-group-votes/${shareToken}/vote`);

	const handleCopyShareLink = async () => {
		await Clipboard.setStringAsync(shareUrl);
		logFrontendEvent({
			event_name: "dish_category_group_vote_share_link_copied",
			error_level: "log",
			payload: { shareToken },
		});
		showSnackbar(i18n.t("Common.linkCopied"));
	};

	const handleDeleteCandidate = async (candidate: DishCategoryGroupVoteCandidate) => {
		const ok = await confirm({
			title: i18n.t("DishCategoryGroupVotes.deleteCandidateTitle"),
			message: i18n.t("DishCategoryGroupVotes.deleteCandidateMessage", { name: candidate.displayName }),
			confirmLabel: i18n.t("DishCategoryGroupVotes.deleteCandidate"),
			cancelLabel: i18n.t("Common.cancel"),
		});
		if (!ok) return;
		logFrontendEvent({
			event_name: "dish_category_group_vote_candidate_delete_requested",
			error_level: "log",
			payload: { shareToken, candidateId: candidate.id },
		});
		await actions.deleteCandidate(candidate.id);
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

	return (
		<SafeAreaView style={styles.safeArea}>
			<SearchHeader title={i18n.t("DishCategoryGroupVotes.resultTitle")} onPressBack={() => router.back()} />
			<ScrollView contentContainerStyle={styles.content}>
				<DishCategoryGroupVoteResultHeader
					session={detail.session}
					participants={detail.participants}
					onCopyShareLink={handleCopyShareLink}
				/>
				{!detail.session.hasVoted ? (
					<View style={styles.voteCtaContainer}>
						<PrimaryButton
							label={i18n.t("DishCategoryGroupVotes.voteCta")}
							style={styles.voteButton}
							onPress={() => {
								logFrontendEvent({
									event_name: "dish_category_group_vote_vote_opened",
									error_level: "log",
									payload: { shareToken },
								});
								router.push({
									pathname: `/[locale]/(tabs)/dish-category-group-votes/[shareToken]/vote`,
									params: {
										locale,
										shareToken,
									},
								});
							}}
						/>
					</View>
				) : null}
				<DishCategoryGroupVoteCandidateList
					candidates={detail.candidates}
					isHost={detail.session.isHost}
					loadingCandidateId={loadingCandidateId}
					onPressDishMedia={openCandidateDishMedia}
					onDeleteCandidate={handleDeleteCandidate}
				/>
				<DishCategoryGroupVoteComments participants={detail.participants} />
			</ScrollView>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	safeArea: {
		flex: 1,
		backgroundColor: "#F9FAFB",
	},
	content: {
		paddingBottom: 28,
	},
	center: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		gap: 12,
		backgroundColor: "#F9FAFB",
		padding: 24,
	},
	errorText: {
		fontSize: 15,
		color: "#374151",
		textAlign: "center",
	},
	voteCtaContainer: {
		paddingHorizontal: 16,
		paddingTop: 16,
	},
	retryButton: {
		minWidth: 160,
	},
	voteButton: {
		width: "100%",
	},
});
