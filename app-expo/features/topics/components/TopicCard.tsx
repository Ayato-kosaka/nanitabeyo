import React, { useState } from "react";
import { Text, TouchableOpacity, StyleSheet, View } from "react-native";
import { Bookmark, Ban } from "lucide-react-native";
import { Topic } from "@/types/search";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { toggleReaction } from "@/lib/reactions";
import { useTopicsStore } from "@/stores/useTopicsStore";
import { profileSavedTopicsEntriesKey } from "@/features/profile/tabs/SavedTopicsTab";
import i18n from "@/lib/i18n";
import { type TopicImageResourceState } from "@/features/topics/hooks/useTopicImageResources";
import { CARD_WIDTH } from "@/features/topics/constants";
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
	const [isSaved, setIsSaved] = useState(false);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

	const deepDiveChipWidth = deepDiveOptions.length === 1 ? "100%" : deepDiveOptions.length === 2 ? "48.5%" : "31.5%";

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
			} else {
				updateTopicIdsByKey(profileSavedTopicsEntriesKey, (prev) => prev.filter((id) => id !== item.categoryId));
			}
		} catch (error) {
			logFrontendEvent({
				event_name: "topic_save_reaction_failed",
				error_level: "log",
				payload: {
					error: error instanceof Error ? error.message : String(error),
					target_id: item.categoryId,
					action_type: "save",
					willReact: willSave,
				},
			});
		}
	};

	const handleBlock = () => {
		onBlock(item);
	};

	return (
		<View style={[styles.cardPressArea, { height: cardHeight + TOPIC_CARD_CTA_OVERHANG }]}>
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
										<View style={styles.deepDiveChips}>
											{deepDiveOptions.map((option) => (
												<TouchableOpacity
													key={option.key}
													style={[styles.deepDiveChip, { width: deepDiveChipWidth }]}
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
									accessibilityLabel={i18n.t("Common.save")}
									accessibilityState={{ selected: isSaved }}>
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
									accessibilityLabel={i18n.t("Topics.BlockTopicModal.title")}>
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
		width: CARD_WIDTH,
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
		gap: 10,
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
		justifyContent: "space-between",
		rowGap: 10,
	},
	deepDiveChip: {
		borderWidth: 1,
		borderColor: "rgba(255, 255, 255, 0.92)",
		backgroundColor: "rgba(255, 255, 255, 0.32)",
		paddingHorizontal: 12,
		paddingVertical: 11,
		borderRadius: 18,
		minHeight: 42,
		justifyContent: "center",
		alignItems: "center",
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
