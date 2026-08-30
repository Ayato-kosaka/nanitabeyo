import React, { useEffect, useState } from "react";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { Pressable, StyleSheet, Text, View } from "react-native";
import i18n from "@/lib/i18n";
import { useLocalSearchParams, router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronLeft } from "lucide-react-native";
import { useAPICall } from "@/hooks/useAPICall";
import {
	useDishMediaEntriesStore,
	NormalizedDishMediaEntry,
	selectEntryByReviewId,
} from "@/stores/useDishMediaEntriesStore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

export default function ReviewPostScreen() {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { id: dishReviewId } = useLocalSearchParams<{ id?: string }>();
	const { callBackend } = useAPICall();
	const insets = useSafeAreaInsets();
	const entriesKey = "ReviewPostScreen";
	const [dishMediaEntry, setDishMediaEntry] = useState<NormalizedDishMediaEntry | null>(null);
	/**
	 * #1398 Q3 【設計】ストアの引き当てが済んだか。
	 *
	 * この画面は `selectEntryByReviewId` でストアを引くだけで、API フォールバックは
	 * 下のとおりコメントアウトされている（reviewId から取れないため）。そのため
	 * **ストアに無いレビュー（= 写真なしの記録）で着地するとローディングのまま固着する**。
	 * 記録直後は `/restaurant/[id]/review` 側が遷移しないので現時点で到達経路は無いが、
	 * 共有リンクや通知から直接来る経路が将来生えた瞬間に固着へ戻るため、
	 * 「引き当て済み・でも無い」を空表示（+ 戻る導線）へ倒せるようにここで区別する。
	 */
	const [isResolved, setIsResolved] = useState(false);

	useEffect(() => {
		/**
		 * #1441 M-3 【レビュー対応】`id` が取れない（不正な直リンク等）ときも `isResolved` を立てる。
		 * 立てずに抜けると `isResolved` が false のまま固着し、Q3 の趣旨（固着を作らない）に反する。
		 */
		if (!dishReviewId) {
			setIsResolved(true);
			return;
		}

		// #644 【設計】ストアから DishMedia を取得（存在しない場合は API フェッチ）
		const entry = selectEntryByReviewId(dishReviewId)(useDishMediaEntriesStore.getState());

		const { updateReviewIdsByKey, clearByKey } = useDishMediaEntriesStore.getState();

		// ストアに存在する場合はフェッチをスキップ
		if (entry) {
			updateReviewIdsByKey(entriesKey, () => [dishReviewId]);
			setDishMediaEntry(entry);
			setIsResolved(true);
			return;
		}

		// reviewId から取れないのでコメントアウト
		// ストアに存在しない場合は API フェッチ
		// const fetchData = async () => {
		// 	const requestPayload: QueryDishMediaByIdsDto = { ids: [id] };
		// 	const response = await callBackend<QueryDishMediaByIdsDto, QueryDishMediaByIdsResponse>("v1/dish-media", {
		// 		method: "GET",
		// 		requestPayload,
		// 	});
		// 	upsertDishMediaEntries(response.items);
		// 	updateMediaIdsByKey(entriesKey, () => [id]);
		// 	const fetchedEntry = selectEntryByMediaId(id)(useDishMediaEntriesStore.getState());
		// 	setDishMediaEntry(fetchedEntry || null);
		// };

		// fetchData();

		// #1398 Q3 ストアに無い = この画面では表示できない。空表示へ倒す（スピナー固着を避ける）
		setIsResolved(true);

		return () => {
			clearByKey(entriesKey);
		};
	}, [dishReviewId, callBackend]);

	// #644 【設計】戻るボタン押下時に /review/index に遷移
	const handleBack = () => {
		router.back();
	};

	return (
		<>
			<View style={[styles.headerButton, { top: insets.top + 8 }]}>
				{/* 半透明の黒バッジ（メディアフィードの上）に載るアイコンなのでテーマで振らない */}
				<ChevronLeft size={28} color={FixedColors.onMedia} onPress={handleBack} />
			</View>
			<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
				{/* #644 【設計】データ取得中はローディング表示 */}
				{dishMediaEntry ? (
					<DishMediaFeed entriesKey={entriesKey} idType="dish_reviews" />
				) : isResolved ? (
					// #1398 Q3 引き当て済みで見つからなかった場合（写真なしのレビューへ直リンク等）。
					// スピナーのまま固着させず、空表示と戻る導線に倒す
					//
					// #1441 M-4 【レビュー対応】この画面がストアに引き当てられないのは主に写真なしの
					// 記録（この画面はメディア前提の Feed しか描けない）であり、レビュー自体は存在する。
					// 汎用の「見つかりません」だと「記録が消えた」ように読めて誤解を招くため専用文言にする
					<View testID="post-not-found" style={styles.emptyContainer}>
						<Text style={styles.emptyText}>{i18n.t("MyDishes.record.postNotFoundNoPhoto")}</Text>
						<Pressable testID="post-not-found-back-button" onPress={handleBack} accessibilityRole="button">
							<Text style={styles.emptyBackText}>{i18n.t("Common.back")}</Text>
						</Pressable>
					</View>
				) : (
					<View style={styles.loadingContainer}>
						<LoadingIndicator size="large" />
					</View>
				)}
			</LinearGradient>
		</>
	);
}

// #1509 【設計】テーマ依存のスタイルはファクトリで組む（contexts/ThemeProvider.tsx の useThemedStyles）
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: { flex: 1 },
		loadingContainer: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
		},
		// #1398 Q3 引き当てできなかったときの空表示
		emptyContainer: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
			gap: 16,
			padding: 24,
		},
		emptyText: {
			fontSize: 16,
			color: c.textMuted,
			textAlign: "center",
		},
		emptyBackText: {
			fontSize: 16,
			fontWeight: "600",
			color: c.linkAlt,
		},
		headerButton: {
			position: "absolute",
			left: 16,
			zIndex: 10,
			backgroundColor: "rgba(0,0,0,0.4)",
			borderRadius: 24,
			marginLeft: 8,
			padding: 8,
		},
	});
