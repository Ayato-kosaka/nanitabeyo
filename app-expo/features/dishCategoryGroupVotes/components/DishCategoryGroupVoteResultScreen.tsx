/**
 * #856 【責務】
 * 共有リンクで入った後の結果画面をまとめる。
 *
 * ここでは detail 再取得、参加者数表示、共有導線、候補削除、店を見る起点を扱う。
 */
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";
import type { DishCategoryGroupVoteCandidate } from "@shared/api/v1/res";
import type { QueryDishMediaByIdsDto } from "@shared/api/v1/dto";
import type { QueryDishMediaByIdsResponse } from "@shared/api/v1/res";
import { generateShareUrl } from "@/lib/share";
import { createShareLink } from "@/lib/createShareLink";
import { resolvePublicLocale } from "@/constants/seoLocales";
import { type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import i18n from "@/lib/i18n";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useDialog } from "@/contexts/DialogProvider";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useAPICall } from "@/hooks/useAPICall";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useDishCategoryGroupVoteActions } from "../hooks/useDishCategoryGroupVoteActions";
import { useDishCategoryGroupVoteDetail } from "../hooks/useDishCategoryGroupVoteDetail";
import { useDishCategoryGroupVotePolling } from "../hooks/useDishCategoryGroupVotePolling";
import { useCandidateDishMediaCache } from "../hooks/useCandidateDishMediaCache";
import { DishCategoryGroupVoteCandidateList } from "./DishCategoryGroupVoteCandidateList";
import { DishCategoryGroupVoteComments } from "./DishCategoryGroupVoteComments";
import { DishCategoryGroupVoteCandidateDetailModal } from "./DishCategoryGroupVoteCandidateDetailModal";
import { DishCategoryGroupVoteInlineOverlay } from "./DishCategoryGroupVoteInlineOverlay";
import { DishCategoryGroupVoteResultHeader } from "./DishCategoryGroupVoteResultHeader";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { toErrorLogMessage } from "@/lib/errorMessage";

type Props = {
	shareToken: string;
};

export function DishCategoryGroupVoteResultScreen({ shareToken }: Props) {
	const styles = useThemedStyles(createStyles);
	const { locale } = useLocale();
	const isFocused = useIsFocused();
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { confirm } = useDialog();
	const { showSnackbar } = useSnackbar();
	const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
	const [selectedCandidate, setSelectedCandidate] = useState<DishCategoryGroupVoteCandidate | null>(null);
	// #1358 【設計】候補詳細は共通の BlurModal フック(= react-native-paper の Portal)をやめ、この画面の子として描く
	// (DishCategoryGroupVoteInlineOverlay)。#1122 の「開いたまま遷移すると遷移先の上に
	// バックドロップが残って一切タップできない」は Portal.Host が画面スタックの外側に
	// あることが原因だったので、画面の内側へ戻した時点で**構造として起こせなくなった**。
	//
	// #1122 【修正】それでも「閉じてから遷移する」順序は残す。理由は 2 つある:
	//   1. 遷移先から戻ったときに詳細が開きっぱなしだと、押した覚えのない詳細が復活して見える。
	//   2. web は遷移しても前の画面の DOM が残るため、レイヤーを開いたまま積み増す設計に
	//      戻すと #1122 と同じ「上に残る」経路が再びありうる。順序を仕様として固定しておく。
	//
	// 順序は setTimeout ではなく因果で書く: クローズ後に実行したい処理を ref へ積み、
	// 可視状態の変化を見る useEffect(= visible=false のコミット後 ＝ レイヤーがアンマウント済み)
	// で取り出して実行する。
	const pendingAfterCandidateDetailCloseRef = useRef<(() => void) | null>(null);
	// #1122 【追補】未検索(not_searched)の候補では openCandidateDishMedia が非同期検索を await して
	// から遷移を要求してくる。その待ち時間にユーザーが X / バックドロップでモーダルを閉じられるため、
	// 「押した時点の状態」で判断すると (a) 遷移が黙って消える (b) pending に積んだ navigate が残留し、
	// 次に別候補のモーダルを開いて閉じただけで発火する、という 2 つの事故が起きる。
	//
	// そこで表示セッションの世代番号(開閉のたびに +1)を持ち、押下時の世代を控えておく。
	// 完了時に世代が変わっていたら「ユーザーが自分でモーダルを閉じた/別候補へ移った」なので
	// 遷移はキャンセルする。意図して閉じたのに勝手に画面が変わる方がユーザーには有害なため、
	// (a) は「遷移を復活させる」ではなく「キャンセルを正とする」を選ぶ。
	const candidateDetailSessionRef = useRef(0);
	const isCandidateDetailVisibleRef = useRef(false);
	// 「店を見る」押下時に詳細モーダルが開いていたならその世代、一覧カード導線なら null。
	// 候補ごとに保持することで、別候補への操作が割り込んでも取り違えない。
	const dishMediaRequestSessionRef = useRef(new Map<string, number | null>());
	const handleCandidateDetailOpened = useCallback(() => {
		isCandidateDetailVisibleRef.current = true;
		candidateDetailSessionRef.current += 1;
		// 前のセッションの積み残しはここで確実に捨てる(残っていると無関係な店へ飛ぶ)
		pendingAfterCandidateDetailCloseRef.current = null;
	}, []);
	const handleCandidateDetailClosed = useCallback(() => {
		isCandidateDetailVisibleRef.current = false;
		candidateDetailSessionRef.current += 1;
		const pending = pendingAfterCandidateDetailCloseRef.current;
		pendingAfterCandidateDetailCloseRef.current = null;
		pending?.();
	}, []);
	const [isCandidateDetailVisible, setIsCandidateDetailVisible] = useState(false);
	const openCandidateDetail = useCallback(() => setIsCandidateDetailVisible(true), []);
	const closeCandidateDetail = useCallback(() => setIsCandidateDetailVisible(false), []);
	// #1122 開閉の副作用は「コミット後」に走る useEffect でだけ起こす。
	// close の呼び出し直後（＝まだレイヤーがツリーに居る時点）で pending を実行すると、
	// 「閉じてから遷移する」が崩れる。onOpen / onClose は依存に入るので安定参照であること
	useEffect(() => {
		isCandidateDetailVisible ? handleCandidateDetailOpened() : handleCandidateDetailClosed();
	}, [isCandidateDetailVisible, handleCandidateDetailOpened, handleCandidateDetailClosed]);

	// #1122 モーダルが開いていれば閉じ、閉じ終わってから navigate を実行する。
	// 既に閉じている(一覧カードからの導線)ときは待つものが無いのでそのまま実行する。
	const navigateAfterCandidateDetailClosed = useCallback(
		(candidateId: string, navigate: () => void) => {
			const requestedSession = dishMediaRequestSessionRef.current.get(candidateId) ?? null;
			if (requestedSession === null) {
				// 一覧カードからの導線。待つモーダルが無いのでそのまま遷移する
				navigate();
				return;
			}
			if (!isCandidateDetailVisibleRef.current || requestedSession !== candidateDetailSessionRef.current) {
				// 検索中にユーザーがモーダルを閉じた(または別候補を開いた)。ユーザーの操作を優先して遷移しない
				logFrontendEvent({
					event_name: "dish_category_group_vote_candidate_dish_media_navigation_cancelled",
					error_level: "log",
					payload: { shareToken, candidateId },
				});
				return;
			}
			pendingAfterCandidateDetailCloseRef.current = navigate;
			closeCandidateDetail();
		},
		[closeCandidateDetail, logFrontendEvent, shareToken],
	);
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

			// #1122 モーダルのクローズ完了を待ってから遷移する(上の設計コメント参照)
			navigateAfterCandidateDetailClosed(candidate.id, () => {
				router.push({
					pathname: "/[locale]/(tabs)/search/result",
					params: {
						locale,
						entriesKey,
						location: detail ? JSON.stringify(detail.session.searchContext.location) : undefined,
						category: candidate.displayName,
					},
				});
			});
		},
	});

	// #721 共有 URL を /s/:token に寄せる。友達投票は共有カードに投稿固有の画像が要らないが、
	// 共有 URL・Deep Link・OGP の生成経路を 1 本にまとめる価値があるので同じ基盤へ乗せる。
	//
	// ⚠️ 共有トークンを 2 系統にしない。友達投票は #856 の時点で share_token を持っており、
	// `/s/:token` はその上に OGP と入口を足す層。share_links.target_params.shareToken に
	// 既存トークンを持たせるだけなので、既存 URL・既存 API・既存 E2E は 1 つも壊れない。
	const fallbackShareUrl = generateShareUrl(`/${locale}/search/dish-category-group-votes/${shareToken}/vote`);

	const handleCopyShareLink = async () => {
		// #942 【仕様】Web ではクリップボードAPIが非セキュアコンテキスト等で失敗しうるため、
		// 失敗を無音にせずエラー通知する
		try {
			// 発行に失敗しても共有そのものは止めない（既存 URL へ落とす）
			const shareUrl =
				(await createShareLink(callBackend, {
					target: { type: "dish_category_group_vote_sessions", params: { shareToken } },
					locale: resolvePublicLocale(locale),
				} as never)) ?? fallbackShareUrl;
			await Clipboard.setStringAsync(shareUrl);
			logFrontendEvent({
				event_name: "dish_category_group_vote_share_link_copied",
				error_level: "log",
				payload: { shareToken },
			});
			showSnackbar(i18n.t("Common.linkCopied"));
		} catch (error) {
			logFrontendEvent({
				event_name: "dish_category_group_vote_share_link_copy_failed",
				error_level: "error",
				payload: { shareToken, error: toErrorLogMessage(error) },
			});
			showSnackbar(i18n.t("Common.shareFailed"));
		}
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
		try {
			await actions.deleteCandidate(candidate.id);
			// #943 【仕様】ホストの誤削除からの回復導線として、10秒間Undo可能なスナックバーを出す
			showSnackbar(i18n.t("DishCategoryGroupVotes.candidateDeleted", { name: candidate.displayName }), {
				action: {
					label: i18n.t("Common.undo"),
					onPress: () => handleUndoDeleteCandidate(candidate),
				},
				duration: 10000,
			});
		} catch (error) {
			logFrontendEvent({
				event_name: "dish_category_group_vote_candidate_delete_failed",
				error_level: "error",
				payload: {
					shareToken,
					candidateId: candidate.id,
					error: toErrorLogMessage(error),
				},
			});
			showSnackbar(i18n.t("Common.error"));
		}
	};

	// #943 【仕様】削除のUndo。BEの復元APIを叩き、成功したらrefreshで整合させる(actions.restoreCandidate内で実施済み)
	const handleUndoDeleteCandidate = async (candidate: DishCategoryGroupVoteCandidate) => {
		try {
			await actions.restoreCandidate(candidate.id);
			logFrontendEvent({
				event_name: "dish_category_group_vote_candidate_delete_undo",
				error_level: "log",
				payload: { shareToken, candidateId: candidate.id },
			});
		} catch (error) {
			logFrontendEvent({
				event_name: "dish_category_group_vote_candidate_restore_failed",
				error_level: "error",
				payload: {
					shareToken,
					candidateId: candidate.id,
					error: toErrorLogMessage(error),
				},
			});
			showSnackbar(i18n.t("Common.error"));
		}
	};

	const handleOpenCandidateDishMedia = async (candidate: DishCategoryGroupVoteCandidate) => {
		// #1122 押下時点で詳細モーダルが開いていたか(=どの表示セッションから来た要求か)を控える。
		// 検索を挟む経路では完了までに数秒空くため、判断材料は押下時に固定しておく必要がある。
		dishMediaRequestSessionRef.current.set(
			candidate.id,
			isCandidateDetailVisibleRef.current ? candidateDetailSessionRef.current : null,
		);
		try {
			await openCandidateDishMedia(candidate);
		} finally {
			dishMediaRequestSessionRef.current.delete(candidate.id);
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

	// #941 【仕様】全候補の総投票数が 0 のときは BE が返す rank(=同スコアで全員1位) を
	// そのまま表示せず「未投票」に統一する。総投票数はここでのみ判定し、rank の算出ロジック(BE)は変更しない。
	const hasVotes = detail.candidates.some((candidate) => candidate.likeCount > 0 || candidate.dislikeCount > 0);

	return (
		<SafeAreaView style={styles.safeArea} edges={[]}>
			{/* #1358 【設計】ヘッダーと本文は 1 枚の View で包み、詳細レイヤーの兄弟から外す。
			    ScreenHeader は container に zIndex:100 と不透明な白背景を持つため、詳細レイヤーと
			    兄弟のままだと**ヘッダー帯だけレイヤーの上**に残る（= X が押せず、戻るボタンだけ生きて
			    「閉じてから遷移する」順序を迂回できてしまう）。View は RN Web でも
			    position:relative / zIndex:0 が既定なので、包めばその zIndex はこの中に閉じ込められる。
			    ここを外すと DishCategoryGroupVoteResultScreen.test.tsx の兄弟 zIndex 検査が赤くなる。 */}
			<View style={styles.body}>
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
			</View>
			{/* #1358 詳細レイヤーは本文ラッパーの兄弟かつ**最後の子**として置く。
			    RN / RN Web とも兄弟の描画順は子の順序で決まるので、zIndex を積まずにこれだけで上に載る。
			    ただし成立条件は「兄弟に zIndex を持つ要素が居ないこと」なので、zIndex を持つ要素
			    （ScreenHeader など）をここへ並べてはいけない（上のラッパーのコメント参照） */}
			{isCandidateDetailVisible && selectedCandidate ? (
				<DishCategoryGroupVoteInlineOverlay
					contentContainerStyle={styles.detailContent}
					onRequestClose={closeCandidateDetail}>
					<DishCategoryGroupVoteCandidateDetailModal
						candidate={selectedCandidate}
						isHost={detail.session.isHost}
						hasVotes={hasVotes}
						isDishMediaLoading={loadingCandidateId === selectedCandidate.id}
						onPressDishMedia={handleOpenCandidateDishMedia}
						onDeleteCandidate={handleDeleteCandidate}
					/>
				</DishCategoryGroupVoteInlineOverlay>
			) : null}
		</SafeAreaView>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		safeArea: {
			flex: 1,
			backgroundColor: c.surfaceFaint,
		},
		// #1358 ヘッダー + 本文のラッパー。ScreenHeader の zIndex をここへ閉じ込めるためだけに存在する
		body: {
			flex: 1,
		},
		content: {
			paddingBottom: 28,
		},
		center: {
			flex: 1,
			alignItems: "center",
			justifyContent: "center",
			gap: 12,
			backgroundColor: c.surfaceFaint,
			padding: 24,
		},
		errorText: {
			fontSize: 15,
			color: c.textSecondaryStrong,
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
		detailContent: {
			padding: 18,
			// #1358 上下は 32（移行元 BlurModal の paddingVertical 既定値）に揃える。
			// 18 のままだと候補名や投票者名が長い小型端末でカードが画面上下端に接する
			paddingVertical: 32,
		},
	});
