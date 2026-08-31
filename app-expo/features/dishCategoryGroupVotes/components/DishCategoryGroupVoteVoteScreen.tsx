/**
 * #856 【責務】
 * 投票フローの本体を扱う。
 *
 * 最後の候補まで到達したら完了入力へ切り替え、送信完了まではこの画面内で完結させる。
 * #1358 その完了入力も Portal ではなく同画面内のレイヤーとして描く（DishCategoryGroupVoteInlineOverlay）。
 */
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
// #1358 【修正】react-native の SafeAreaView は iOS だけ padding を入れる（Android / web では素の View）。
// Yoga は絶対配置の子を親の padding の内側へ置くため、完了レイヤー（StyleSheet.absoluteFill）が
// iOS でだけセーフエリアの内側までしか広がらず、ステータスバー帯とホームインジケータ帯に
// ブラーが届かなかった。#1130 と同じく react-native-safe-area-context のものへ揃え、
// レイヤーを載せる外枠は edges={[]}（padding を入れない）、inset は内側の本文へ明示的に当てる。
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { SubmitDishCategoryGroupVoteDto } from "@shared/api/v1/dto";
import type { DishCategoryGroupVoteCandidate, DishCategoryGroupVoteReaction } from "@shared/api/v1/res";
import type { DishCategoryRecommendation } from "@/types/search";
import { type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import i18n from "@/lib/i18n";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLogger } from "@/hooks/useLogger";
import { useLocale } from "@/hooks/useLocale";
import { useDishCategoryImageResources } from "@/features/dishCategories/hooks/useDishCategoryImageResources";
import { e2eVoteImagePreloadProbeElement } from "@/lib/e2e/voteImagePreloadProbe";
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
	const styles = useThemedStyles(createStyles);
	const insets = useSafeAreaInsets();
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
	 * 以前は共通の BlurModal フック（Portal）で載せていたが、閉じるボタン無し・背景タップ無効・全画面という
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

	/**
	 * #1213 【修正】候補カードは DishCategories 検索と同じ DishCategoryVisualCard を描画に使うが、
	 * ここでは候補切り替えのたびに生の uri をその場で読み込んでいた（= プリロード契約に未参加）。
	 * useDishCategoryImageResources へ候補全件を渡して先読みし、ready になった ImageRef をカードへ渡すことで、
	 * 次の候補へ進んだ瞬間にはすでに読み込み済みの画像が即時表示されるようにする。
	 */
	const candidateDishCategories = useMemo<DishCategoryRecommendation[]>(
		() => voteCandidates.map((candidate) => candidateToDishCategory(candidate)),
		[voteCandidates],
	);
	const { getImageState } = useDishCategoryImageResources({ dishCategories: candidateDishCategories, sessionKey: shareToken });

	/**
	 * #1213 【観測】native には「先読みが効いているか」を外から見る手段が無い（web は Resource Timing で見える）。
	 * 実測値を Detox から読めるようにするための計数で、E2E ビルド以外では
	 * `e2eVoteImagePreloadProbeElement` が null を返すため描画物は増えない。
	 */
	const imagePreloadCounts = useMemo(() => {
		let ready = 0;
		let failed = 0;
		for (const dishCategory of candidateDishCategories) {
			const status = getImageState(dishCategory).status;
			if (status === "ready") ready += 1;
			else if (status === "error") failed += 1;
		}
		return { ready, failed, total: candidateDishCategories.length };
	}, [candidateDishCategories, getImageState]);

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
		<SafeAreaView style={styles.safeArea} edges={[]}>
			{/* #1358 【設計】inset はこのラッパーが持つ（外枠は完了レイヤーを全面に敷くため padding を持てない）。
			    完了レイヤーはこのラッパーの兄弟かつ最後の子に置く。ここに zIndex を持つ要素を並べると
			    レイヤーの上に残ってしまう（DishCategoryGroupVoteInlineOverlay の前提を参照） */}
			<View
				style={[
					styles.body,
					{
						paddingTop: insets.top,
						paddingBottom: insets.bottom,
						// 横向きのノッチ機で本文が切り欠きへ潜らないよう、旧 SafeAreaView と同じく左右も見る
						paddingLeft: insets.left,
						paddingRight: insets.right,
					},
				]}>
				<View style={styles.header}>
					<View style={styles.progressSegments}>
						{voteCandidates.map((candidate, segmentIndex) => (
							<View
								key={candidate.id}
								style={[
									styles.progressSegment,
									segmentIndex < getFilledProgressSegments(index, voteCandidates.length) &&
										styles.progressSegmentActive,
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
					<DishCategoryGroupVoteVoteCard
						candidate={currentCandidate}
						onVote={handleVote}
						imageState={getImageState(candidateToDishCategory(currentCandidate))}
					/>
				) : (
					<View style={styles.center}>
						<Text style={styles.errorText}>{i18n.t("DishCategoryGroupVotes.noVoteCandidates")}</Text>
					</View>
				)}
				{/* #1213 E2E ビルドでだけ描かれる 1×1 の計測要素（通常ビルドでは null）。
				    完了レイヤーの兄弟ではなく本文の内側に置く（外枠直下に zIndex を持たない要素でも
				    並べない、という上のコメントの前提を崩さないため） */}
				{e2eVoteImagePreloadProbeElement(imagePreloadCounts)}
			</View>
			{isCompleted ? (
				// #1358 閉じる導線を持たせない（＝ onRequestClose を渡さない）のは旧実装の
				// closeOnBackdropPress:false / backHandlerEnabled:false / showCloseButton:false と同じ意図。
				// 投票を全部終えた後に戻れる先はこの画面には無く、送信するかタブを離れるかしかない
				// #1415 この画面は «背景» がほとんど無く（カードが全面を占める）、閉じる導線も持たない。
				// 名前とコメントを打った後にキーボードを引っ込める手段が «送信を押す» しか無かったので、
				// カードを押したらキーボードだけ閉じるようにする
				<DishCategoryGroupVoteInlineOverlay
					contentContainerStyle={styles.completionContent}
					dismissKeyboardOnContentPress>
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

const createStyles = (c: Palette) =>
	StyleSheet.create({
		safeArea: {
			flex: 1,
			backgroundColor: c.surfaceFaint,
		},
		// #1358 inset を当てる本文ラッパー。完了レイヤーを外枠直下の全面に敷くために外枠から分離している
		body: {
			flex: 1,
		},
		header: {
			paddingHorizontal: 20,
			paddingTop: 16,
			gap: 10,
		},
		progress: {
			fontSize: 14,
			fontWeight: "800",
			color: c.textSecondaryAlt,
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
			backgroundColor: c.surfacePlaceholder,
		},
		progressSegmentActive: {
			backgroundColor: c.brand,
		},
		center: {
			flex: 1,
			alignItems: "center",
			justifyContent: "center",
			gap: 12,
			padding: 24,
			backgroundColor: c.surfaceFaint,
		},
		completionContent: {
			padding: 20,
		},
		errorText: {
			fontSize: 15,
			color: c.textSecondaryStrong,
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

// #1213 useDishCategoryImageResources は DishCategoryRecommendation 形状（categoryId + imageUrl がキャッシュキーの元）を前提にしているため、
// 候補を最小限のフィールドだけ DishCategoryRecommendation 形状へ写す。displayName/tagline は表示に使わず uri とキーの算出専用。
function candidateToDishCategory(candidate: DishCategoryGroupVoteCandidate): DishCategoryRecommendation {
	return {
		category: candidate.dishCategoryId,
		categoryId: candidate.dishCategoryId,
		title: candidate.displayName,
		reason: candidate.tagline,
		imageUrl: candidate.imageUrl,
	};
}
