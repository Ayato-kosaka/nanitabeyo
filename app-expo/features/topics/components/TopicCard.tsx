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
}: {
	item: Topic;
	onBlock: (topic: Topic) => void;
	onDeepDive?: (topic: Topic, option: TopicDeepDiveOption) => void;
	onSelect: (topic: Topic) => void;
	deepDiveOptions?: TopicDeepDiveOption[];
	cardHeight: number;
	imageState: TopicImageResourceState;
	onImageRetry?: (topic: Topic) => void;
}) => {
	const [isSaved, setIsSaved] = useState(false);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

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
								<View style={styles.deepDiveContainer}>
									<View style={styles.deepDiveTitleRow}>
										<View style={styles.deepDiveTitleLine} />
										<Text style={styles.deepDiveTitle}>{i18n.t("Topics.deepDive.title")}</Text>
										<View style={styles.deepDiveTitleLine} />
									</View>
									<View style={[styles.deepDiveChips, isThreeDeepDiveChips && styles.deepDiveChipsRow]}>
										{deepDiveOptions.map((option) => (
											<TouchableOpacity
												key={option.key}
												style={[styles.deepDiveChip, isThreeDeepDiveChips && styles.deepDiveChipFlex]}
												hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
												onPress={(event) => {
													event.stopPropagation();
													onDeepDive?.(item, option);
												}}
												activeOpacity={0.8}>
												<Text style={styles.deepDiveChipText} numberOfLines={1}>
													{option.label}
												</Text>
											</TouchableOpacity>
										))}
									</View>
								</View>
							) : null}
							<View style={styles.ctaSpacer} />
						</View>
					}
					topRightContent={
						<>
							<TouchableOpacity
								style={styles.topButton}
								onPress={(event) => {
									event.stopPropagation();
									void handleSave();
								}}>
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
						</>
					}
				/>
			</TouchableOpacity>
			<TouchableOpacity
				style={styles.selectButton}
				onPress={() => onSelect(item)}
				activeOpacity={0.85}
				accessibilityRole="button"
				accessibilityLabel={i18n.t("Topics.chooseThis")}>
				<Text style={styles.selectButtonText}>{i18n.t("Topics.chooseThis")}</Text>
			</TouchableOpacity>
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
	selectButton: {
		position: "absolute",
		left: "10%",
		right: "10%",
		bottom: 0,
		minHeight: 52,
		borderRadius: 24,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#F05537",
		zIndex: 10,
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
	// #973【設計】3件時は折り返さず1行×均等幅で収め、はみ出す分はテキストを1行省略する
	deepDiveChipsRow: {
		flexWrap: "nowrap",
		alignSelf: "stretch",
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
	deepDiveChipFlex: {
		flex: 1,
		flexShrink: 1,
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
