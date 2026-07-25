/**
 * #856 【責務】
 * 共有リンクで入った後の結果画面をまとめる。
 *
 * ここでは detail 再取得、参加者数表示、共有導線、候補削除、店を見る起点を扱う。
 */
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
	AppState,
	type AppStateStatus,
	Platform,
	ScrollView,
	StyleSheet,
	Text,
	View,
	useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";
import type { DishCategoryGroupVoteCandidate } from "@shared/api/v1/res";
import type { QueryDishMediaByIdsDto } from "@shared/api/v1/dto";
import type { QueryDishMediaByIdsResponse } from "@shared/api/v1/res";
import { generateShareUrl } from "@/lib/share";
import i18n from "@/lib/i18n";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useDialog } from "@/contexts/DialogProvider";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useAPICall } from "@/hooks/useAPICall";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { useDishCategoryGroupVoteActions } from "../hooks/useDishCategoryGroupVoteActions";
import { useDishCategoryGroupVoteDetail } from "../hooks/useDishCategoryGroupVoteDetail";
import { useDishCategoryGroupVotePolling } from "../hooks/useDishCategoryGroupVotePolling";
import { useCandidateDishMediaCache } from "../hooks/useCandidateDishMediaCache";
import { DishCategoryGroupVoteCandidateList } from "./DishCategoryGroupVoteCandidateList";
import { DishCategoryGroupVoteComments } from "./DishCategoryGroupVoteComments";
import { DishCategoryGroupVoteCandidateDetailModal } from "./DishCategoryGroupVoteCandidateDetailModal";
import { DishCategoryGroupVoteResultHeader } from "./DishCategoryGroupVoteResultHeader";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";

type Props = {
	shareToken: string;
};

export function DishCategoryGroupVoteResultScreen({ shareToken }: Props) {
	const { locale } = useLocale();
	const isFocused = useIsFocused();
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { confirm } = useDialog();
	const { showSnackbar } = useSnackbar();
	const { height: windowHeight } = useWindowDimensions();
	const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
	const [selectedCandidate, setSelectedCandidate] = useState<DishCategoryGroupVoteCandidate | null>(null);
	const {
		BlurModal: CandidateDetailBlurModal,
		open: openCandidateDetail,
		close: closeCandidateDetail,
	} = useBlurModal({
		closeOnBackdropPress: true,
	});
	const { detail, isLoading, error, refresh } = useDishCategoryGroupVoteDetail(shareToken);
	// /store はネイティブ内ではホームへ戻るため、共有リンクを開いた Web 参加者だけに出す。
	const shouldShowStoreCta = detail?.session.hasVoted === true && Platform.OS === "web";

	useEffect(() => {
		const subscription = AppState.addEventListener("change", (nextAppState) => {
			setAppState(nextAppState);
		});

		return () => {
			subscription.remove();
		};
	}, []);

	useDishCategoryGroupVotePolling({
		isFocused: isFocused && shareToken.length > 0,
		appState,
		refresh,
	});

	const actions = useDishCategoryGroupVoteActions({
		sessionId: detail?.session.id,
		refresh,
	});
	const { loadingCandidateId, openCandidateDishMedia } = useCandidateDishMediaCache({
		cacheCandidateDishMedia: actions.cacheCandidateDishMedia,
		searchContext: detail?.session.searchContext,
		onOpenCachedDishMedia: (candidate, dishMediaIds) => {
			const entriesKey = `dish-category-group-votes:${shareToken}:${candidate.id}`;
			const { mediaIdsByKey, isLoadingByKey, upsertDishMediaEntries, updateMediaIdsByKeyAsync } =
				useDishMediaEntriesStore.getState();

			if (mediaIdsByKey[entriesKey] === undefined && !isLoadingByKey[entriesKey]) {
				const fetchIds = async () => {
					const response = await callBackend<QueryDishMediaByIdsDto, QueryDishMediaByIdsResponse>("v1/dish-media", {
						method: "GET",
						requestPayload: {
							ids: dishMediaIds,
						},
					});
					upsertDishMediaEntries(response.items);
					return response.items.map((item) => String(item.dish_media.id));
				};

				updateMediaIdsByKeyAsync(entriesKey, fetchIds(), (_, fetchedIds) => fetchedIds);
			}

			router.push({
				pathname: "/[locale]/(tabs)/search/result",
				params: {
					locale,
					entriesKey,
					location: detail ? JSON.stringify(detail.session.searchContext.location) : undefined,
					category: candidate.displayName,
				},
			});
		},
	});

	const shareUrl = generateShareUrl(`/${locale}/search/dish-category-group-votes/${shareToken}/vote`);

	const handleCopyShareLink = async () => {
		await Clipboard.setStringAsync(shareUrl);
		logFrontendEvent({
			event_name: "dish_category_group_vote_share_link_copied",
			error_level: "log",
			payload: { shareToken },
		});
		showSnackbar(i18n.t("Common.linkCopied"));
	};

	const handlePressCandidate = (candidate: DishCategoryGroupVoteCandidate) => {
		setSelectedCandidate(candidate);
		openCandidateDetail();
	};

	const handleDeleteCandidate = async (candidate: DishCategoryGroupVoteCandidate) => {
		const ok = await confirm({
			title: i18n.t("DishCategoryGroupVotes.deleteCandidateTitle"),
			message: i18n.t("DishCategoryGroupVotes.deleteCandidateMessage", { name: candidate.displayName }),
			confirmLabel: i18n.t("DishCategoryGroupVotes.deleteCandidate"),
			cancelLabel: i18n.t("Common.cancel"),
		});
		if (!ok) return;
		if (selectedCandidate?.id === candidate.id) {
			closeCandidateDetail();
			setSelectedCandidate(null);
		}
		logFrontendEvent({
			event_name: "dish_category_group_vote_candidate_delete_requested",
			error_level: "log",
			payload: { shareToken, candidateId: candidate.id },
		});
		await actions.deleteCandidate(candidate.id);
	};

	const handleOpenCandidateDishMedia = async (candidate: DishCategoryGroupVoteCandidate) => {
		await openCandidateDishMedia(candidate);
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

	// #941 【仕様】全候補の総投票数が 0 のときは BE が返す rank(=同スコアで全員1位) を
	// そのまま表示せず「未投票」に統一する。総投票数はここでのみ判定し、rank の算出ロジック(BE)は変更しない。
	const hasVotes = detail.candidates.some((candidate) => candidate.likeCount > 0 || candidate.dislikeCount > 0);

	return (
		<SafeAreaView style={styles.safeArea} edges={[]}>
			<ScreenHeader title={i18n.t("DishCategoryGroupVotes.resultTitle")} onPressBack={() => router.back()} />
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
								router.replace({
									pathname: `/[locale]/(tabs)/search/dish-category-group-votes/[shareToken]/vote`,
									params: {
										locale,
										shareToken,
									},
								});
							}}
						/>
					</View>
				) : shouldShowStoreCta ? (
					<View style={styles.voteCtaContainer}>
						<PrimaryButton
							label={i18n.t("DeepLinking.downloadApp")}
							style={styles.voteButton}
							onPress={() => {
								logFrontendEvent({
									event_name: "dish_category_group_vote_store_opened",
									error_level: "log",
									payload: { shareToken },
								});
								router.push("/store");
							}}
						/>
					</View>
				) : null}
				<DishCategoryGroupVoteCandidateList
					candidates={detail.candidates}
					isHost={detail.session.isHost}
					hasVotes={hasVotes}
					loadingCandidateId={loadingCandidateId}
					onPressCandidate={handlePressCandidate}
					onPressDishMedia={handleOpenCandidateDishMedia}
					onDeleteCandidate={handleDeleteCandidate}
				/>
				<DishCategoryGroupVoteComments participants={detail.participants} />
			</ScrollView>
			<CandidateDetailBlurModal contentContainerStyle={[styles.detailBackdrop, { minHeight: windowHeight }]}>
				{selectedCandidate ? (
					<DishCategoryGroupVoteCandidateDetailModal
						candidate={selectedCandidate}
						isHost={detail.session.isHost}
						hasVotes={hasVotes}
						isDishMediaLoading={loadingCandidateId === selectedCandidate.id}
						onPressDishMedia={handleOpenCandidateDishMedia}
						onDeleteCandidate={handleDeleteCandidate}
					/>
				) : null}
			</CandidateDetailBlurModal>
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
	detailBackdrop: {
		alignItems: "center",
		justifyContent: "center",
		padding: 18,
	},
});
