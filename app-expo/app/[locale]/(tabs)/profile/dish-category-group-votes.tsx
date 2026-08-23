// #1505 【設計】自分が作成/参加したグループ投票の一覧画面。
// profile/blocked-topics.tsx と同じ「Stack push + ScreenHeader + FlatList + cursorページング」の
// 型に揃える。差分は「操作(ブロック解除)が無く、タップで投票詳細へ戻る」だけ。
import React, { useCallback, useEffect, useState, useRef, memo } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/EmptyState";
import i18n from "@/lib/i18n";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";

import type { QueryMeDishCategoryGroupVotesResponse } from "@shared/api/v1/res";
import type { MeDishCategoryGroupVoteListItem } from "@shared/api/v1/res";
import { toErrorLogMessage } from "@/lib/errorMessage";

interface VoteListItemProps {
	item: MeDishCategoryGroupVoteListItem;
	locale: string;
	onPress: (item: MeDishCategoryGroupVoteListItem) => void;
}

const VoteListItem = memo(({ item, locale, onPress }: VoteListItemProps) => {
	const formattedDate = new Date(item.createdAt).toLocaleDateString(locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});

	return (
		<TouchableOpacity
			style={styles.itemContainer}
			onPress={() => onPress(item)}
			activeOpacity={0.7}
			accessibilityRole="link"
			accessibilityLabel={formattedDate}>
			<View style={styles.itemMain}>
				<Text style={styles.itemDate}>{formattedDate}</Text>
				<Text style={styles.itemCandidateCount}>
					{i18n.t("DishCategoryGroupVotes.myVotes.candidateCount", { count: item.candidateCount })}
				</Text>
			</View>
			<View style={styles.badgeRow}>
				{item.isHost && (
					<View style={[styles.badge, styles.hostBadge]}>
						<Text style={styles.badgeText}>{i18n.t("DishCategoryGroupVotes.myVotes.hostBadge")}</Text>
					</View>
				)}
				<View style={[styles.badge, item.hasVoted ? styles.votedBadge : styles.notVotedBadge]}>
					<Text style={styles.badgeText}>
						{i18n.t(
							item.hasVoted
								? "DishCategoryGroupVotes.myVotes.votedBadge"
								: "DishCategoryGroupVotes.myVotes.notVotedBadge",
						)}
					</Text>
				</View>
			</View>
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

				if (!cursor || isRefresh) {
					setVotes(response.data);
				} else {
					setVotes((prev) => [...prev, ...response.data]);
				}

				setNextCursor(response.nextCursor);
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
				payload: { session_id: item.id, is_host: item.isHost, has_voted: item.hasVoted },
			});
			router.push({
				pathname: "/[locale]/(tabs)/search/dish-category-group-votes/[shareToken]",
				params: { locale, shareToken: item.shareToken },
			});
		},
		[lightImpact, logFrontendEvent, locale],
	);

	const keyExtractor = useCallback((item: MeDishCategoryGroupVoteListItem) => item.id, []);

	const renderItem = useCallback(
		({ item }: { item: MeDishCategoryGroupVoteListItem }) => (
			<VoteListItem item={item} locale={locale} onPress={handlePressItem} />
		),
		[locale, handlePressItem],
	);

	const renderFooter = useCallback(() => {
		if (!isLoadingMore) return null;
		return (
			<View style={styles.footerLoader}>
				<LoadingIndicator size="small" />
			</View>
		);
	}, [isLoadingMore]);

	const renderEmpty = useCallback(() => {
		if (isLoading) return null;
		return (
			<EmptyState
				message={i18n.t("DishCategoryGroupVotes.myVotes.empty")}
				testID="me-dish-category-group-votes-empty-state"
			/>
		);
	}, [isLoading]);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
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
								ListEmptyComponent={renderEmpty}
								ListFooterComponent={renderFooter}
								onEndReached={handleLoadMore}
								onEndReachedThreshold={0.5}
								refreshing={isRefreshing}
								onRefresh={handleRefresh}
								contentContainerStyle={styles.listContent}
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

const styles = StyleSheet.create({
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
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.1,
		shadowRadius: 24,
		elevation: 10,
	},
	sheet: {
		flex: 1,
		backgroundColor: "#FFFFFF",
		borderTopLeftRadius: 32,
		borderTopRightRadius: 32,
		overflow: "hidden",
		paddingTop: 24,
	},
	loaderContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	listContent: {
		paddingHorizontal: 16,
		paddingBottom: 32,
	},
	itemContainer: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		backgroundColor: "#FFFFFF",
		borderRadius: 12,
		padding: 16,
		marginBottom: 12,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.05,
		shadowRadius: 2,
		elevation: 2,
	},
	itemMain: {
		flex: 1,
	},
	itemDate: {
		fontSize: 16,
		fontWeight: "600",
		color: "#1A1A1A",
	},
	itemCandidateCount: {
		marginTop: 4,
		fontSize: 14,
		color: "#6B7280",
	},
	badgeRow: {
		flexDirection: "row",
		gap: 8,
	},
	badge: {
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: 8,
	},
	hostBadge: {
		backgroundColor: "#FEF3C7",
	},
	votedBadge: {
		backgroundColor: "#D1FAE5",
	},
	notVotedBadge: {
		backgroundColor: "#F3F4F6",
	},
	badgeText: {
		fontSize: 12,
		fontWeight: "600",
		color: "#1A1A1A",
	},
	footerLoader: {
		paddingVertical: 20,
		alignItems: "center",
	},
});
