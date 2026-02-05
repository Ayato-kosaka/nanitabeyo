// app-expo/app/[locale]/contribution-tasks/dish-ranking-summary.tsx
//
// 料理ランキング総括コメント（条件プルダウン＋一覧＋BlurModal）実装

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { View, StyleSheet, Text, Pressable, FlatList, TextInput, ActivityIndicator, ScrollView } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HelpCircle, ChevronDown } from "lucide-react-native";
import * as Crypto from "expo-crypto";

import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLogger } from "@/hooks/useLogger";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Env } from "@/constants/Env";

/* -------------------------------------------------------------------------- */
/*                                    型定義                                   */
/* -------------------------------------------------------------------------- */

type Condition = { key: string; label: string };
type DishRankItem = { qid: string; label: string; image: string | null };

type CdnPayload = {
	conditions: Condition[];
	rankings: Record<string, { items: DishRankItem[] }>;
};

type SubmitPayload = {
	sessionId: string;
	startedAt: string;
	submittedAt: string;
	conditionKey: string;
	conditionLabel: string;
	comment: string;
	rankedQids: string[];
};

/* -------------------------------------------------------------------------- */
/*                              定数・固定値                                   */
/* -------------------------------------------------------------------------- */

const CDN_BASE_URL = Env.CDN_PUBLIC_HOST || "https://cdn-public.nanitabeyo.net";
const CDN_JSON_PATH = "rankings/dish-ranking-summary.json";
const CDN_JSON_URL = `${CDN_BASE_URL}/${CDN_JSON_PATH}`;

/* -------------------------------------------------------------------------- */
/*                              メインコンポーネント                             */
/* -------------------------------------------------------------------------- */

export default function DishRankingSummaryScreen() {
	const insets = useSafeAreaInsets();
	const { showSnackbar } = useSnackbar();
	const { logFrontendEvent } = useLogger();

	/* ---- State ---- */
	const [isLoading, setIsLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [cdnData, setCdnData] = useState<CdnPayload | null>(null);
	const [selectedConditionKey, setSelectedConditionKey] = useState<string>("");
	const [comment, setComment] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [showConditionPicker, setShowConditionPicker] = useState(false);

	/* ---- Session tracking ---- */
	const sessionId = useMemo(() => Crypto.randomUUID(), []);
	const startedAt = useMemo(() => new Date().toISOString(), []);

	/* ---- BlurModal ---- */
	const {
		BlurModal: CommentModal,
		open: openCommentModal,
		close: closeCommentModal,
	} = useBlurModal({
		closeOnBackdropPress: false,
	});

	const {
		BlurModal: ConditionPickerModal,
		open: openConditionPickerModal,
		close: closeConditionPickerModal,
	} = useBlurModal({
		closeOnBackdropPress: true,
	});

	/* ------------------------------------------------------------------ */
	/*                          CDN データ取得                             */
	/* ------------------------------------------------------------------ */

	useEffect(() => {
		const fetchData = async () => {
			try {
				setIsLoading(true);
				setLoadError(null);

				const response = await fetch(CDN_JSON_URL);
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}: ${response.statusText}`);
				}

				const data: CdnPayload = await response.json();

				if (!data.conditions || !Array.isArray(data.conditions) || data.conditions.length === 0) {
					throw new Error("条件データが不正です");
				}

				setCdnData(data);
				setSelectedConditionKey(data.conditions[0].key);

				logFrontendEvent({
					event_name: "dish_ranking_summary_loaded",
					error_level: "log",
					payload: { conditionCount: data.conditions.length },
				});
			} catch (error: any) {
				const errorMsg = error?.message || "Unknown error";
				setLoadError(errorMsg);
				logFrontendEvent({
					event_name: "dish_ranking_summary_load_error",
					error_level: "error",
					payload: { error: errorMsg },
				});
			} finally {
				setIsLoading(false);
			}
		};

		fetchData();
	}, [logFrontendEvent]);

	/* ------------------------------------------------------------------ */
	/*                          現在選択中のデータ                          */
	/* ------------------------------------------------------------------ */

	const selectedCondition = useMemo(() => {
		if (!cdnData) return null;
		return cdnData.conditions.find((c) => c.key === selectedConditionKey) || null;
	}, [cdnData, selectedConditionKey]);

	const currentRankingItems = useMemo(() => {
		if (!cdnData || !selectedConditionKey) return [];
		const ranking = cdnData.rankings[selectedConditionKey];
		return ranking?.items || [];
	}, [cdnData, selectedConditionKey]);

	const rankedQids = useMemo(() => {
		return currentRankingItems.map((item) => item.qid);
	}, [currentRankingItems]);

	/* ------------------------------------------------------------------ */
	/*                          条件切替                                  */
	/* ------------------------------------------------------------------ */

	const handleConditionChange = useCallback(
		(key: string) => {
			setSelectedConditionKey(key);
			closeConditionPickerModal();
			logFrontendEvent({
				event_name: "dish_ranking_summary_condition_changed",
				error_level: "log",
				payload: { conditionKey: key },
			});
		},
		[logFrontendEvent, closeConditionPickerModal],
	);

	/* ------------------------------------------------------------------ */
	/*                          コメント送信                               */
	/* ------------------------------------------------------------------ */

	const handleSubmit = useCallback(async () => {
		if (comment.trim().length < 1) {
			showSnackbar("コメントを入力してください");
			return;
		}

		if (!selectedCondition) {
			showSnackbar("条件が選択されていません");
			return;
		}

		try {
			setIsSubmitting(true);

			const payload: SubmitPayload = {
				sessionId,
				startedAt,
				submittedAt: new Date().toISOString(),
				conditionKey: selectedConditionKey,
				conditionLabel: selectedCondition.label,
				comment: comment.trim(),
				rankedQids,
			};

			await logFrontendEvent({
				event_name: "dish_ranking_summary_submitted",
				error_level: "log",
				payload,
			});

			showSnackbar("送信しました");
			closeCommentModal();
			setComment("");
		} catch (error: any) {
			const errorMsg = error?.message || "Unknown error";
			showSnackbar("送信に失敗しました。もう一度お試しください。");
			logFrontendEvent({
				event_name: "dish_ranking_summary_submit_error",
				error_level: "error",
				payload: { error: errorMsg },
			});
		} finally {
			setIsSubmitting(false);
		}
	}, [
		comment,
		selectedCondition,
		sessionId,
		startedAt,
		selectedConditionKey,
		rankedQids,
		logFrontendEvent,
		showSnackbar,
		closeCommentModal,
	]);

	const handleOpenCommentModal = useCallback(() => {
		openCommentModal();
		logFrontendEvent({
			event_name: "dish_ranking_summary_comment_modal_opened",
			error_level: "log",
			payload: { conditionKey: selectedConditionKey },
		});
	}, [openCommentModal, logFrontendEvent, selectedConditionKey]);

	/* ------------------------------------------------------------------ */
	/*                          ランキングアイテム描画                       */
	/* ------------------------------------------------------------------ */

	const renderRankingItem = useCallback(({ item, index }: { item: DishRankItem; index: number }) => {
		const rank = index + 1;

		return (
			<View style={styles.rankItem}>
				<View style={styles.rankNumber}>
					<Text style={styles.rankNumberText}>{rank}</Text>
				</View>
				{item.image ? (
					<Image source={{ uri: item.image }} style={styles.dishImage} contentFit="cover" />
				) : (
					<View style={[styles.dishImage, styles.dishImagePlaceholder]} />
				)}
				<Text style={styles.dishLabel} numberOfLines={2}>
					{item.label}
				</Text>
			</View>
		);
	}, []);

	/* ------------------------------------------------------------------ */
	/*                          ローディング・エラー表示                     */
	/* ------------------------------------------------------------------ */

	if (isLoading) {
		return (
			<View style={styles.centerContainer}>
				<ActivityIndicator size="large" color="#f05537" />
				<Text style={styles.loadingText}>データを読み込み中...</Text>
			</View>
		);
	}

	if (loadError) {
		return (
			<View style={styles.centerContainer}>
				<Text style={styles.errorText}>データの読み込みに失敗しました</Text>
				<Text style={styles.errorDetail}>{loadError}</Text>
			</View>
		);
	}

	if (!cdnData || !selectedCondition) {
		return (
			<View style={styles.centerContainer}>
				<Text style={styles.errorText}>データが不正です</Text>
			</View>
		);
	}

	/* ------------------------------------------------------------------ */
	/*                          メイン UI                                 */
	/* ------------------------------------------------------------------ */

	return (
		<View style={[styles.container, { paddingTop: insets.top }]}>
			{/* ヘッダー */}
			<View style={styles.header}>
				<Text style={styles.headerTitle}>料理ランキングレビュー</Text>
				<Pressable style={styles.helpButton}>
					<HelpCircle size={24} color="#666" />
				</Pressable>
				<Pressable style={styles.commentButton} onPress={handleOpenCommentModal}>
					<Text style={styles.commentButtonText}>コメントを書く</Text>
				</Pressable>
			</View>

			{/* 条件プルダウン */}
			<Pressable
				style={styles.conditionSelector}
				onPress={() => {
					setShowConditionPicker(true);
					openConditionPickerModal();
				}}>
				<Text style={styles.conditionLabel}>{selectedCondition.label}</Text>
				<ChevronDown size={20} color="#333" />
			</Pressable>

			{/* ランキング一覧 */}
			{currentRankingItems.length === 0 ? (
				<View style={styles.emptyContainer}>
					<Text style={styles.emptyText}>ランキング準備中</Text>
				</View>
			) : (
				<FlatList
					data={currentRankingItems}
					keyExtractor={(item) => item.qid}
					renderItem={renderRankingItem}
					contentContainerStyle={styles.listContent}
					showsVerticalScrollIndicator={false}
				/>
			)}

			{/* コメント入力モーダル */}
			<CommentModal contentContainerStyle={styles.modalContent}>
				<View style={styles.modalInner}>
					<Text style={styles.modalTitle}>総括コメント入力</Text>
					<Text style={styles.modalDescription}>この条件に対する総括を入力してください。</Text>
					<TextInput
						style={styles.commentInput}
						placeholder="例: 牛丼もっと上が良い（理由：早い/満足感）&#10;生姜焼き定食がランキングに無いのは違和感&#10;お好み焼きは昼は時間がかかるので下げたい&#10;この条件だと「軽い/早い」料理が上位のほうが良い"
						placeholderTextColor="#999"
						value={comment}
						onChangeText={setComment}
						multiline
						numberOfLines={8}
						textAlignVertical="top"
					/>
					<View style={styles.modalButtons}>
						<Pressable style={styles.cancelButton} onPress={closeCommentModal} disabled={isSubmitting}>
							<Text style={styles.cancelButtonText}>キャンセル</Text>
						</Pressable>
						<PrimaryButton
							label="送信"
							onPress={handleSubmit}
							loading={isSubmitting}
							disabled={comment.trim().length < 1 || isSubmitting}
							style={styles.submitButton}
						/>
					</View>
				</View>
			</CommentModal>

			{/* 条件選択モーダル */}
			<ConditionPickerModal contentContainerStyle={styles.pickerModalContent}>
				<View style={styles.pickerInner}>
					<Text style={styles.pickerTitle}>条件を選択</Text>
					<ScrollView style={styles.pickerScroll}>
						{cdnData.conditions.map((condition) => (
							<Pressable
								key={condition.key}
								style={[styles.pickerItem, condition.key === selectedConditionKey && styles.pickerItemSelected]}
								onPress={() => handleConditionChange(condition.key)}>
								<Text
									style={[
										styles.pickerItemText,
										condition.key === selectedConditionKey && styles.pickerItemTextSelected,
									]}>
									{condition.label}
								</Text>
							</Pressable>
						))}
					</ScrollView>
				</View>
			</ConditionPickerModal>
		</View>
	);
}

/* -------------------------------------------------------------------------- */
/*                               スタイル定義                                  */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#fff",
	},
	centerContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		padding: 20,
	},
	loadingText: {
		marginTop: 16,
		fontSize: 16,
		color: "#666",
	},
	errorText: {
		fontSize: 18,
		fontWeight: "bold",
		color: "#d32f2f",
		marginBottom: 8,
		textAlign: "center",
	},
	errorDetail: {
		fontSize: 14,
		color: "#666",
		textAlign: "center",
	},
	header: {
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 16,
		paddingVertical: 12,
		borderBottomWidth: 1,
		borderBottomColor: "#eee",
	},
	headerTitle: {
		flex: 1,
		fontSize: 18,
		fontWeight: "bold",
		color: "#333",
	},
	helpButton: {
		padding: 8,
		marginRight: 8,
	},
	commentButton: {
		backgroundColor: "#f05537",
		paddingHorizontal: 16,
		paddingVertical: 8,
		borderRadius: 8,
	},
	commentButtonText: {
		color: "#fff",
		fontSize: 14,
		fontWeight: "bold",
	},
	conditionSelector: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 16,
		paddingVertical: 12,
		marginHorizontal: 16,
		marginTop: 12,
		backgroundColor: "#f5f5f5",
		borderRadius: 8,
		borderWidth: 1,
		borderColor: "#ddd",
	},
	conditionLabel: {
		fontSize: 16,
		color: "#333",
		fontWeight: "500",
	},
	listContent: {
		padding: 16,
	},
	rankItem: {
		flexDirection: "row",
		alignItems: "center",
		padding: 12,
		marginBottom: 8,
		backgroundColor: "#f9f9f9",
		borderRadius: 8,
		borderWidth: 1,
		borderColor: "#eee",
	},
	rankNumber: {
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: "#f05537",
		justifyContent: "center",
		alignItems: "center",
		marginRight: 12,
	},
	rankNumberText: {
		color: "#fff",
		fontSize: 14,
		fontWeight: "bold",
	},
	dishImage: {
		width: 56,
		height: 56,
		borderRadius: 8,
		backgroundColor: "#eee",
		marginRight: 12,
	},
	dishImagePlaceholder: {
		backgroundColor: "#ddd",
	},
	dishLabel: {
		flex: 1,
		fontSize: 15,
		color: "#333",
	},
	emptyContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		padding: 40,
	},
	emptyText: {
		fontSize: 16,
		color: "#999",
	},
	modalContent: {
		justifyContent: "center",
		alignItems: "center",
		padding: 20,
	},
	modalInner: {
		width: "100%",
		maxWidth: 400,
		backgroundColor: "#fff",
		borderRadius: 16,
		padding: 24,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.25,
		shadowRadius: 4,
		elevation: 5,
	},
	modalTitle: {
		fontSize: 20,
		fontWeight: "bold",
		color: "#333",
		marginBottom: 8,
	},
	modalDescription: {
		fontSize: 14,
		color: "#666",
		marginBottom: 16,
	},
	commentInput: {
		borderWidth: 1,
		borderColor: "#ddd",
		borderRadius: 8,
		padding: 12,
		fontSize: 14,
		minHeight: 120,
		backgroundColor: "#f9f9f9",
		marginBottom: 16,
	},
	modalButtons: {
		flexDirection: "row",
		justifyContent: "flex-end",
		gap: 12,
	},
	cancelButton: {
		paddingHorizontal: 20,
		paddingVertical: 10,
		borderRadius: 8,
		backgroundColor: "#eee",
	},
	cancelButtonText: {
		fontSize: 14,
		fontWeight: "bold",
		color: "#666",
	},
	submitButton: {
		flex: 1,
	},
	pickerModalContent: {
		justifyContent: "center",
		alignItems: "center",
		padding: 20,
	},
	pickerInner: {
		width: "100%",
		maxWidth: 400,
		maxHeight: "70%",
		backgroundColor: "#fff",
		borderRadius: 16,
		padding: 24,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.25,
		shadowRadius: 4,
		elevation: 5,
	},
	pickerTitle: {
		fontSize: 18,
		fontWeight: "bold",
		color: "#333",
		marginBottom: 16,
	},
	pickerScroll: {
		flex: 1,
	},
	pickerItem: {
		paddingVertical: 16,
		paddingHorizontal: 16,
		borderRadius: 8,
		marginBottom: 8,
		backgroundColor: "#f5f5f5",
	},
	pickerItemSelected: {
		backgroundColor: "#f05537",
	},
	pickerItemText: {
		fontSize: 16,
		color: "#333",
	},
	pickerItemTextSelected: {
		color: "#fff",
		fontWeight: "bold",
	},
});
