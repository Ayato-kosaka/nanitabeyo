import React, { useState } from "react";
import { Text, TouchableOpacity, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Bookmark, Ban } from "lucide-react-native";
import { Topic } from "@/types/search";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useLocale } from "@/hooks/useLocale";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { toggleReaction } from "@/lib/reactions";
import { useTopicsStore } from "@/stores/useTopicsStore";
import { profileSavedTopicsEntriesKey } from "@/features/profile/tabs/SavedTopicsTab";
import i18n from "@/lib/i18n";
import { type TopicImageResourceState } from "@/features/topics/hooks/useTopicImageResources";
import type { TopicsTutorialTargetRefs } from "@/features/topics/types/tutorial";
import { TopicVisualCard } from "./TopicVisualCard";

export type TopicDeepDiveOption = {
	key: string;
	label: string;
	featureType: string;
	featureKey: string;
};

export const TOPIC_CARD_CTA_OVERHANG = 14;

export const TopicCard = ({
	item,
	onBlock,
	onDeepDive,
	onSelect,
	deepDiveOptions = [],
	cardWidth,
	cardHeight,
	imageState,
	onImageRetry,
	tutorialTargetRefs,
}: {
	item: Topic;
	onBlock: (topic: Topic) => void;
	onDeepDive?: (topic: Topic, option: TopicDeepDiveOption) => void;
	onSelect: (topic: Topic) => void;
	deepDiveOptions?: TopicDeepDiveOption[];
	// #958 【修正】CARD_WIDTH の直接 import(window幅固定・中央カラム幅と不一致)をやめ、
	// cardHeight と同様に呼び出し元(topics.tsx)から算出済みの値を受け取る
	cardWidth: number;
	cardHeight: number;
	imageState: TopicImageResourceState;
	onImageRetry?: (topic: Topic) => void;
	/**
	 * アクティブなCarouselカードにだけ渡すチュートリアル用ref。
	 *
	 * 非表示カードにも同じrefを渡すと、Carouselの事前描画・再利用により
	 * 画面外カードの座標で上書きされるため、親画面でactive indexを判定する。
	 */
	tutorialTargetRefs?: Pick<TopicsTutorialTargetRefs, "swipeArea" | "selectCta" | "deepDive" | "topicActions">;
}) => {
	// #954 【仕様】サーバの保存状態(item.isSaved)で初期化する。従来は常にfalseだったため
	// 保存済みカテゴリでも再訪時は未保存表示になっていた。
	const [isSaved, setIsSaved] = useState(item.isSaved ?? false);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const { showSnackbar } = useSnackbar();

	// #973【設計】3件表示時は折り返さず1行に収める。1〜2件は内容幅で主CTAより確実に小さく見せる
	const isThreeDeepDiveChips = deepDiveOptions.length >= 3;

	const handleSave = async () => {
		const willSave = !isSaved;
		lightImpact();
		setIsSaved(willSave);

		const { updateTopicIdsByKey, upsertTopics } = useTopicsStore.getState();

		try {
			await toggleReaction({
				target_type: "dish_categories",
				target_id: item.categoryId,
				action_type: "save",
				willReact: willSave,
			});

			// #472【設計】保存 ON → saved タブの先頭に移動、保存 OFF → saved タブから除外
			if (willSave) {
				upsertTopics([
					{
						id: item.categoryId,
						image_url: item.imageUrl,
						labels: {},
						label_en: item.topicTitle,
					},
				]);
				updateTopicIdsByKey(profileSavedTopicsEntriesKey, (prev) => {
					const without = prev.filter((id) => id !== item.categoryId);
					return [item.categoryId, ...without];
				});
				// #954 【仕様】保存操作のみ完了フィードバックを出す(解除は状態変化が見た目で分かるため省略)
				// #954 【修正】保存したのは料理トピックなので、遷移先は既定の「投稿」タブではなく
				// 「トピック」タブ(tab=saved-topics)を明示する(レビュー指摘)。
				// tabRequest は同じタブへの2回目以降の遷移でも切替を発火させるためのリクエスト識別子
				showSnackbar(i18n.t("Topics.savedMessage"), {
					action: {
						label: i18n.t("Common.view"),
						onPress: () =>
							router.push({
								pathname: "/[locale]/(tabs)/profile",
								params: { locale, tab: "saved-topics", tabRequest: String(Date.now()) },
							}),
					},
				});
			} else {
				updateTopicIdsByKey(profileSavedTopicsEntriesKey, (prev) => prev.filter((id) => id !== item.categoryId));
			}
		} catch (error) {
			// #954 【仕様】保存APIが失敗した場合、見た目だけ切り替わったままにせず表示を元に戻す
			setIsSaved(!willSave);
			logFrontendEvent({
				event_name: "topic_save_reaction_failed",
				error_level: "error",
				payload: {
					error: error instanceof Error ? error.message : String(error),
					target_id: item.categoryId,
					action_type: "save",
					willReact: willSave,
				},
			});
			showSnackbar(i18n.t("Common.error"));
		}
	};

	const handleBlock = () => {
		onBlock(item);
	};

	return (
		<View style={[styles.cardPressArea, { width: cardWidth, height: cardHeight + TOPIC_CARD_CTA_OVERHANG }]}>
			{/* measureInWindowの基準を安定させるため、Touchableではなく明示的なViewを計測する。 */}
			<View
				ref={tutorialTargetRefs?.swipeArea}
				collapsable={false}
				testID={tutorialTargetRefs ? "topics-tutorial-target-swipe" : undefined}>
				<TouchableOpacity onPress={() => onSelect(item)} activeOpacity={0.95}>
					<TopicVisualCard
						title={item.topicTitle}
						tagline={item.reason}
						imageSource={{ uri: item.imageUrl }}
						cardWidth={cardWidth}
						cardHeight={cardHeight}
						imageState={imageState}
						recyclingKey={item.categoryId}
						onImageRetry={onImageRetry ? () => onImageRetry(item) : undefined}
						bottomContent={
							<View style={styles.bottomContent}>
								{deepDiveOptions.length > 0 ? (
									<View
										ref={tutorialTargetRefs?.deepDive}
										collapsable={false}
										style={styles.deepDiveContainer}
										testID={tutorialTargetRefs ? "topics-tutorial-target-deep-dive" : undefined}>
										<View style={styles.deepDiveTitleRow}>
											<View style={styles.deepDiveTitleLine} />
											<Text style={styles.deepDiveTitle}>{i18n.t("Topics.deepDive.title")}</Text>
											<View style={styles.deepDiveTitleLine} />
										</View>
										<View style={[styles.deepDiveChips, isThreeDeepDiveChips && styles.deepDiveChipsRow]}>
											{deepDiveOptions.map((option) => (
												<TouchableOpacity
													key={option.key}
													style={[styles.deepDiveChip, isThreeDeepDiveChips && styles.deepDiveChipThird]}
													hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
													onPress={(event) => {
														event.stopPropagation();
														onDeepDive?.(item, option);
													}}
													activeOpacity={0.8}>
													<Text style={styles.deepDiveChipText}>{option.label}</Text>
												</TouchableOpacity>
											))}
										</View>
									</View>
								) : null}
								<View style={styles.ctaSpacer} />
							</View>
						}
						topRightContent={
							<View
								ref={tutorialTargetRefs?.topicActions}
								collapsable={false}
								style={styles.topicActions}
								testID={tutorialTargetRefs ? "topics-tutorial-target-actions" : undefined}>
								<TouchableOpacity
									style={styles.topButton}
									onPress={(event) => {
										event.stopPropagation();
										void handleSave();
									}}
									accessibilityRole="button"
									accessibilityState={{ selected: isSaved }}
									accessibilityLabel={i18n.t(
										isSaved ? "Topics.accessibility.unsaveTopic" : "Topics.accessibility.saveTopic",
										{ title: item.topicTitle },
									)}>
									<Bookmark
										size={20}
										color={isSaved ? "transparent" : "white"}
										fill={isSaved ? "orange" : "transparent"}
									/>
								</TouchableOpacity>
								<TouchableOpacity
									style={styles.topButton}
									onPress={(event) => {
										event.stopPropagation();
										void handleBlock();
									}}
									accessibilityRole="button"
									accessibilityLabel={i18n.t("Topics.accessibility.blockTopic", { title: item.topicTitle })}>
									<Ban size={18} color="#FFF" />
								</TouchableOpacity>
							</View>
						}
					/>
				</TouchableOpacity>
			</View>
			<View
				ref={tutorialTargetRefs?.selectCta}
				collapsable={false}
				style={styles.selectButtonTarget}
				testID={tutorialTargetRefs ? "topics-tutorial-target-select" : undefined}>
				<TouchableOpacity
					style={styles.selectButton}
					onPress={() => onSelect(item)}
					activeOpacity={0.85}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("Topics.chooseThis")}>
					<Text style={styles.selectButtonText}>{i18n.t("Topics.chooseThis")}</Text>
				</TouchableOpacity>
			</View>
		</View>
	);
};

const styles = StyleSheet.create({
	cardPressArea: {
		position: "relative",
	},
	bottomContent: {
		gap: 10,
	},
	ctaSpacer: {
		height: 16,
	},
	selectButtonTarget: {
		position: "absolute",
		left: "10%",
		right: "10%",
		bottom: 0,
		zIndex: 10,
	},
	selectButton: {
		minHeight: 52,
		borderRadius: 24,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#F05537",
	},
	selectButtonText: {
		color: "#FFFFFF",
		fontSize: 17,
		fontWeight: "800",
		letterSpacing: 0.2,
	},
	topButton: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		minWidth: 44,
		minHeight: 44,
		backgroundColor: "rgba(0, 0, 0, 0.3)",
		paddingHorizontal: 16,
		paddingVertical: 10,
		borderRadius: 20,
		gap: 6,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.3,
		shadowRadius: 4,
		elevation: 4,
	},
	topicActions: {
		gap: 12,
	},
	deepDiveContainer: {
		marginTop: 10,
		gap: 8,
		paddingBottom: 6,
	},
	deepDiveTitleRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
	},
	deepDiveTitleLine: {
		flex: 1,
		height: 1,
		backgroundColor: "rgba(255, 255, 255, 0.75)",
	},
	deepDiveTitle: {
		color: "#FFFFFF",
		fontSize: 13,
		fontWeight: "800",
		textAlign: "center",
		textShadowColor: "rgba(0, 0, 0, 0.9)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 3,
	},
	deepDiveChips: {
		flexDirection: "row",
		flexWrap: "wrap",
		justifyContent: "center",
		alignSelf: "center",
		// #973【設計】主CTA(左右10%インセット=横幅80%)より確実に狭くし、深堀チップ行が主CTAより目立たないようにする(1〜2件時)
		maxWidth: "76%",
		gap: 8,
	},
	// #973【設計】3件時は折り返さず1行に収める。flex:1による均等割りはWebでチップが
	// 不当に縮み文字が視認できなくなる問題があったため、固定%幅＋定幅の行コンテナに戻した
	deepDiveChipsRow: {
		flexWrap: "nowrap",
		alignSelf: "center",
		justifyContent: "space-between",
		width: "94%",
		maxWidth: undefined,
	},
	deepDiveChip: {
		borderWidth: 1,
		borderColor: "rgba(255, 255, 255, 0.92)",
		backgroundColor: "rgba(255, 255, 255, 0.32)",
		paddingHorizontal: 12,
		paddingVertical: 7,
		borderRadius: 14,
		minHeight: 32,
		justifyContent: "center",
		alignItems: "center",
	},
	deepDiveChipThird: {
		width: "31%",
		paddingHorizontal: 6,
	},
	deepDiveChipText: {
		color: "#FFFFFF",
		fontSize: 13,
		fontWeight: "800",
		textAlign: "center",
		textShadowColor: "rgba(0, 0, 0, 0.7)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
	},
});
