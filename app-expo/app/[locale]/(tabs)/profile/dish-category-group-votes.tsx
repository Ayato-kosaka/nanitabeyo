// #1505 【設計】自分が主催したグループ投票の一覧画面。
// profile/blocked-topics.tsx と同じ「Stack push + ScreenHeader + FlatList + cursorページング」の
// 型に揃える。差分は「操作(ブロック解除)が無く、タップで投票詳細へ戻る」だけ。
//
// 【仕様】一覧は **自分が主催した投票だけ**（参加しただけの投票は出さない）。
// 絞り込みはこの画面ではなく API 側（GET /v1/users/me/dish-category-group-votes の where 句）で
// 行っている。ここでクライアント側の再フィルタを足さないこと（真実の置き場所を二重にしない）。
//
// ## 行の作り（オーナー指摘「デザインが不格好すぎる」への再設計）
//
// 元の行は「日付 · 候補 N 件」＋テキストバッジで、**料理アプリなのに料理が 1 つも見えなかった**。
// 情報の無い行はどう組んでも汎用リストにしかならないので、行の主役を «候補の写真» に据え直した。
//
// - 左: 候補サムネイルを 3 枚オーバーラップさせて重ねる。4 件目以降は「+N」。ここが主役
// - 中: 1 行目 = 勝者が決まっていればその料理名（太字）、未決なら候補名の要約。
//       2 行目 = 参加人数と相対時刻
// - 右: 遷移を示すシェブロン。テキストバッジは廃止し、状態は
//       「勝者名が出ているか」と「未投票のドット」だけで伝える
// - 区切りはカードの羅列ではなく、1 枚の面の中の細い区切り線
//
// ## 色
//
// #1509 の `constants/Palette.ts` / `contexts/ThemeProvider.tsx` のトークンを使う。
// `StyleSheet.create` はモジュール評価時に 1 度しか走らずテーマを追従できないため、
// ファクトリ（createStyles）をモジュールスコープに置いて `useThemedStyles` で組む
// （#1509 が定めた作法。画面ごとに別のやり方を発明しない）。
import React, { useCallback, useEffect, useState, useRef, memo } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ChevronRight, UtensilsCrossed } from "lucide-react-native";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/EmptyState";
import i18n from "@/lib/i18n";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { dateStringToTimestamp } from "@/lib/frontend-utils";
import { FixedColors, type Palette } from "@/constants/Palette";

import type { QueryMeDishCategoryGroupVotesResponse } from "@shared/api/v1/res";
import type { MeDishCategoryGroupVoteListItem } from "@shared/api/v1/res";
import { toErrorLogMessage } from "@/lib/errorMessage";

/**
 * #1505 e2e（Playwright / Detox）の観測点。
 *
 * 行は全て同じ testID を持ち、区別は「上から何番目か」か「行内のテキスト」で行う。
 * 旧実装は行に testID が無く、観測点が accessibilityLabel（表示日付）しか無かったため、
 * 同じ日付の投票が 2 件あると行を特定できなかった。
 */
const ITEM_TEST_ID = "me-dish-category-group-votes-item";
const ITEM_TITLE_TEST_ID = "me-dish-category-group-votes-item-title";
/** 未投票のドット。出ている＝主催者である自分がまだ投票していない */
const ITEM_UNVOTED_TEST_ID = "me-dish-category-group-votes-item-unvoted";

/** サムネイル 1 枚の一辺。行の最小高（44pt）は上下 padding 14 と合わせてこれで満たす */
const THUMBNAIL_SIZE = 44;
/** 重なり量。少しだけ重ねて «同じ投票の候補» に見せる（隠しすぎると何の写真か分からない） */
const THUMBNAIL_OVERLAP = 14;

/**
 * 候補名の要約。「ラーメン・寿司ほか2件」。
 *
 * 区切り記号と「ほか N 件」の語順はロケールごとに違うので、両方 i18n に持たせる
 * （日本語の「・」を英語へそのまま持ち込むと読めない）。
 */
function buildCandidateSummary(item: MeDishCategoryGroupVoteListItem): string {
	const names = item.candidatePreviews.map((preview) => preview.displayName);
	if (names.length === 0) return i18n.t("DishCategoryGroupVotes.myVotes.noCandidates");

	const joined = names.join(i18n.t("DishCategoryGroupVotes.myVotes.candidateSeparator"));
	const rest = item.candidateCount - names.length;

	return rest > 0
		? i18n.t("DishCategoryGroupVotes.myVotes.candidateSummaryMore", { names: joined, count: rest })
		: joined;
}

interface VoteListItemProps {
	item: MeDishCategoryGroupVoteListItem;
	locale: string;
	onPress: (item: MeDishCategoryGroupVoteListItem) => void;
}

const VoteListItem = memo(({ item, locale, onPress }: VoteListItemProps) => {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();

	// 表示は相対時刻（「2日前」）。一覧は updated_at の降順で並ぶので、
	// 見えている時刻も updated_at にしないと「並びがおかしい」と見える。
	const relativeTime = dateStringToTimestamp(item.updatedAt);
	// 読み上げは相対時刻ではなく絶対日付にする。「2日前」は音声だけで聞くと何日か分からない。
	const absoluteDate = new Date(item.updatedAt).toLocaleDateString(locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});

	const summary = buildCandidateSummary(item);
	const title = item.winnerName ?? summary;
	const participants = i18n.t("DishCategoryGroupVotes.myVotes.participantSummary", {
		count: item.participantCount,
	});

	// 「いつ・何の投票・状態」を 1 つのラベルに畳む。行の中の Text を個別に読ませると
	// 「2日前」「5人が投票」だけが読み上がって、何の投票かが分からない。
	const accessibilityLabel = i18n.t("DishCategoryGroupVotes.myVotes.itemAccessibilityLabel", {
		date: absoluteDate,
		summary: item.winnerName
			? i18n.t("DishCategoryGroupVotes.myVotes.decidedLabel", { name: item.winnerName })
			: summary,
		participants,
		status: i18n.t(
			item.hasVoted ? "DishCategoryGroupVotes.myVotes.votedLabel" : "DishCategoryGroupVotes.myVotes.notVotedLabel",
		),
	});

	const restCount = item.candidateCount - item.candidatePreviews.length;

	return (
		<TouchableOpacity
			style={styles.itemContainer}
			onPress={() => onPress(item)}
			activeOpacity={0.7}
			accessibilityRole="link"
			accessibilityLabel={accessibilityLabel}
			// #1505 e2e の観測点。**全行で同じ testID** にしてある。session id を含めると
			// Detox 側が「id を知らないと行を掴めない」形になり（prefix 一致が無い）、
			// 実データで作った投票を掴めなくなる。行の区別は index か行内のテキストで行う。
			testID={ITEM_TEST_ID}>
			<View style={styles.thumbnails}>
				{item.candidatePreviews.length === 0 ? (
					// 候補が 1 件も無い投票でも行の高さと左端を揃える（レイアウトを崩さない）
					<View style={[styles.thumbnail, styles.thumbnailFallback]}>
						<UtensilsCrossed size={18} color={colors.textTertiary} />
					</View>
				) : (
					item.candidatePreviews.map((preview, index) => (
						<View key={`${item.id}-${index}`} style={[styles.thumbnail, index > 0 && styles.thumbnailStacked]}>
							{/* 読み込み中・失敗のどちらでも、この View の寸法と地色がそのまま残る。
							    画像側にサイズを持たせないので、画像が来なくても行が動かない */}
							<Image
								source={{ uri: preview.imageUrl }}
								style={StyleSheet.absoluteFill}
								contentFit="cover"
								cachePolicy="memory-disk"
								transition={100}
								// 行の accessibilityLabel が候補名を含むので、画像自体は装飾扱い
								alt=""
								accessibilityElementsHidden
								importantForAccessibility="no"
							/>
						</View>
					))
				)}
				{restCount > 0 && (
					<View style={[styles.thumbnail, styles.thumbnailStacked, styles.moreThumbnail]}>
						<Text style={styles.moreThumbnailText}>{`+${restCount}`}</Text>
					</View>
				)}
			</View>

			<View style={styles.itemBody}>
				<Text
					style={[styles.itemTitle, !item.winnerName && styles.itemTitleUndecided]}
					numberOfLines={1}
					testID={ITEM_TITLE_TEST_ID}>
					{title}
				</Text>
				<Text style={styles.itemMeta} numberOfLines={1}>
					{`${participants} · ${relativeTime}`}
				</Text>
			</View>

			{/* 状態はバッジではなくドットで示す。未投票の行だけに出す控えめな印。
			    「未投票」という語は accessibilityLabel が持つので、ここは装飾に徹する */}
			{!item.hasVoted && <View style={styles.unvotedDot} testID={ITEM_UNVOTED_TEST_ID} />}
			<ChevronRight size={18} color={colors.textTertiary} accessibilityElementsHidden importantForAccessibility="no" />
		</TouchableOpacity>
	);
});
VoteListItem.displayName = "VoteListItem";

export default function MyDishCategoryGroupVotesScreen() {
	const { showSnackbar } = useSnackbar();
	const { callBackend } = useAPICall();
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();

	const [votes, setVotes] = useState<MeDishCategoryGroupVoteListItem[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(true);

	const isFetchingRef = useRef(false);

	const fetchVotes = useCallback(
		async (options: { cursor?: string; isRefresh?: boolean } = {}) => {
			if (isFetchingRef.current) return;
			isFetchingRef.current = true;

			const { cursor, isRefresh = false } = options;

			try {
				if (!isRefresh) {
					if (!cursor) {
						setIsLoading(true);
					} else {
						setIsLoadingMore(true);
					}
				}

				const params = new URLSearchParams();
				if (cursor) params.append("cursor", cursor);

				const response = await callBackend<Record<string, never>, QueryMeDishCategoryGroupVotesResponse>(
					`/v1/users/me/dish-category-group-votes?${params.toString()}`,
					{
						method: "GET",
						requestPayload: {},
					},
				);

				/*
				#1561 と同じ形の事故を防ぐ。`response.data` は **無いことがある**
				（レスポンスの形が変わった / 別の封筒が返った / 想定外の 200）。
				そのまま setVotes(undefined) すると、**次のレンダーの votes.map が throw** し、
				try/catch の外なので拾えず、画面ごと ErrorBoundary の
				「予期しないエラーが発生しました」になる。

				実際、エビデンス撮影（モックが空配列を返す構成）でこの画面が丸ごと落ちた。
				一覧が空なのと、一覧が取れないのは、利用者にとって別物である。
				取れない形で返ってきたら «空» ではなく «エラー表示» へ倒す。
				*/
				const items = Array.isArray(response?.data) ? response.data : null;
				if (items === null) {
					throw new Error(
						`想定外のレスポンス形式です（data が配列ではありません）: ${typeof response?.data}`,
					);
				}

				if (!cursor || isRefresh) {
					setVotes(items);
				} else {
					setVotes((prev) => [...prev, ...items]);
				}

				setNextCursor(response.nextCursor ?? null);
				setHasMore(!!response.nextCursor);
			} catch (error) {
				logFrontendEvent({
					event_name: "fetch_me_dish_category_group_votes_failed",
					error_level: "error",
					payload: {
						error: toErrorLogMessage(error),
					},
				});
				showSnackbar(i18n.t("DishCategoryGroupVotes.myVotes.loadFailed"));
			} finally {
				setIsLoading(false);
				setIsLoadingMore(false);
				isFetchingRef.current = false;
			}
		},
		[callBackend, showSnackbar, logFrontendEvent],
	);

	useEffect(() => {
		fetchVotes();
	}, [fetchVotes]);

	const handleLoadMore = useCallback(() => {
		if (!isLoadingMore && !isRefreshing && !isLoading && hasMore && nextCursor) {
			fetchVotes({ cursor: nextCursor });
		}
	}, [isLoadingMore, isRefreshing, isLoading, hasMore, nextCursor, fetchVotes]);

	const handleRefresh = useCallback(async () => {
		if (isFetchingRef.current) return;
		setIsRefreshing(true);
		try {
			await fetchVotes({ isRefresh: true });
		} finally {
			setIsRefreshing(false);
		}
	}, [fetchVotes]);

	const handleBack = useCallback(() => {
		lightImpact();
		router.back();
	}, [lightImpact]);

	const handlePressItem = useCallback(
		(item: MeDishCategoryGroupVoteListItem) => {
			lightImpact();
			logFrontendEvent({
				event_name: "me_dish_category_group_votes_item_pressed",
				error_level: "log",
				payload: { session_id: item.id, has_voted: item.hasVoted },
			});
			router.push({
				pathname: "/[locale]/(tabs)/search/dish-category-group-votes/[shareToken]",
				params: { locale, shareToken: item.shareToken },
			});
		},
		[lightImpact, logFrontendEvent, locale],
	);

	// #1505 空状態の導線。投票は「検索 → 候補を出す → 友達に聞く」でしか作れないので、
	// その入口である検索タブへ送る（行き先の無い CTA を置かない）。
	const handleCreateVote = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "me_dish_category_group_votes_empty_cta_pressed",
			error_level: "log",
			payload: {},
		});
		router.push({ pathname: "/[locale]/(tabs)/search", params: { locale } });
	}, [lightImpact, logFrontendEvent, locale]);

	const keyExtractor = useCallback((item: MeDishCategoryGroupVoteListItem) => item.id, []);

	const renderItem = useCallback(
		({ item }: { item: MeDishCategoryGroupVoteListItem }) => (
			<VoteListItem item={item} locale={locale} onPress={handlePressItem} />
		),
		[locale, handlePressItem],
	);

	const renderSeparator = useCallback(() => <View style={styles.separator} />, [styles.separator]);

	const renderFooter = useCallback(() => {
		if (!isLoadingMore) return null;
		return (
			<View style={styles.footerLoader}>
				<LoadingIndicator size="small" />
			</View>
		);
	}, [isLoadingMore, styles.footerLoader]);

	const renderEmpty = useCallback(() => {
		if (isLoading) return null;
		return (
			<EmptyState
				// 白いシートの中に置くので、白いカードは重ねない（輪郭が見えず余白が増えるだけ）
				variant="plain"
				icon={<UtensilsCrossed size={28} color={colors.textTertiary} />}
				message={i18n.t("DishCategoryGroupVotes.myVotes.emptyTitle")}
				description={i18n.t("DishCategoryGroupVotes.myVotes.emptyDescription")}
				actionLabel={i18n.t("DishCategoryGroupVotes.myVotes.emptyAction")}
				onAction={handleCreateVote}
				testID="me-dish-category-group-votes-empty-state"
			/>
		);
	}, [isLoading, colors.textTertiary, handleCreateVote]);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader
					testID="me-dish-category-group-votes-header"
					title={i18n.t("DishCategoryGroupVotes.myVotes.pageTitle")}
					onPressBack={handleBack}
				/>

				<View style={styles.listWrapper}>
					<View style={styles.sheet}>
						{isLoading ? (
							<View style={styles.loaderContainer}>
								<LoadingIndicator size="large" />
							</View>
						) : (
							<FlatList
								data={votes}
								keyExtractor={keyExtractor}
								renderItem={renderItem}
								ItemSeparatorComponent={renderSeparator}
								ListEmptyComponent={renderEmpty}
								ListFooterComponent={renderFooter}
								onEndReached={handleLoadMore}
								onEndReachedThreshold={0.5}
								// #1629 `refreshing` / `onRefresh` を直接渡すと RN が色を持たない RefreshControl を
								// 作り、ダークの地に OS 既定の暗いスピナーが出て見えない。GridList と同じ渡し方に揃える
								refreshControl={
									<RefreshControl
										refreshing={isRefreshing}
										onRefresh={handleRefresh}
										colors={[colors.brand]}
										tintColor={colors.brand}
									/>
								}
								contentContainerStyle={[styles.listContent, votes.length === 0 && styles.listContentEmpty]}
								removeClippedSubviews={true}
								initialNumToRender={10}
								maxToRenderPerBatch={10}
								windowSize={5}
							/>
						)}
					</View>
				</View>
			</SafeAreaView>
		</LinearGradient>
	);
}

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
		},
		safeArea: {
			flex: 1,
		},
		listWrapper: {
			flex: 1,
			marginTop: 16,
			borderTopLeftRadius: 32,
			borderTopRightRadius: 32,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.1,
			shadowRadius: 24,
			elevation: 10,
		},
		sheet: {
			flex: 1,
			backgroundColor: colors.surface,
			borderTopLeftRadius: 32,
			borderTopRightRadius: 32,
			overflow: "hidden",
			paddingTop: 8,
		},
		loaderContainer: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
		},
		listContent: {
			paddingBottom: 32,
		},
		// 0 件のときだけ、空状態をシートの中で上下中央に置くために伸ばす
		listContentEmpty: {
			flexGrow: 1,
			justifyContent: "center",
			paddingHorizontal: 16,
		},
		// #1505 行はカードにしない。1 枚の面（sheet）の中に行が並び、細い区切り線で切る。
		// 影付きカードを 20 個積むと «情報の少ない箱の羅列» に見えるのが元の不格好さの一因だった。
		itemContainer: {
			flexDirection: "row",
			alignItems: "center",
			paddingVertical: 14,
			paddingHorizontal: 16,
			// サムネイル 44 + 上下 14 で 72。タップ領域は 44pt を余裕で超える
			minHeight: 72,
		},
		separator: {
			height: StyleSheet.hairlineWidth,
			backgroundColor: colors.divider,
			marginHorizontal: 16,
		},
		thumbnails: {
			flexDirection: "row",
			alignItems: "center",
			marginRight: 12,
		},
		thumbnail: {
			width: THUMBNAIL_SIZE,
			height: THUMBNAIL_SIZE,
			borderRadius: 12,
			// 画像が来る前・失敗時に残る地。ここが «同寸法のプレースホルダ» になる。
			// 面（surface）より一段沈めて、写真が来なくても «枠がある» ことが分かるようにする
			backgroundColor: colors.surfaceSubtle,
			// 面と同色の縁。重ねたときに隣の写真との境目が消えないようにする
			borderWidth: 2,
			borderColor: colors.surface,
			overflow: "hidden",
			alignItems: "center",
			justifyContent: "center",
		},
		thumbnailStacked: {
			marginLeft: -THUMBNAIL_OVERLAP,
		},
		thumbnailFallback: {
			backgroundColor: colors.surfaceSubtle,
		},
		moreThumbnail: {
			backgroundColor: colors.surfaceSubtle,
		},
		moreThumbnailText: {
			fontSize: 12,
			fontWeight: "700",
			color: colors.textSecondary,
		},
		itemBody: {
			flex: 1,
		},
		itemTitle: {
			fontSize: 15,
			fontWeight: "700",
			color: colors.textPrimary,
		},
		// 未決のときは候補名の «要約» であって決定事項ではないので、勝者名より一段弱くする
		itemTitleUndecided: {
			fontWeight: "500",
			color: colors.textPrimaryAlt,
		},
		itemMeta: {
			marginTop: 3,
			fontSize: 13,
			color: colors.textSecondary,
		},
		unvotedDot: {
			width: 6,
			height: 6,
			borderRadius: 3,
			marginRight: 8,
			backgroundColor: colors.textPrimaryAlt,
		},
		footerLoader: {
			paddingVertical: 20,
			alignItems: "center",
		},
	});
