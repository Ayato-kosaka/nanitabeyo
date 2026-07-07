import React, { useState, useRef, useEffect } from "react";
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
import { TopicVisualCard } from "./TopicVisualCard";

export type TopicDeepDiveOption = {
	key: string;
	label: string;
	featureType: string;
	featureKey: string;
};

export const TopicCard = ({
	item,
	onBlock,
	onDeepDive,
	deepDiveOptions = [],
	displayIndex,
	cardHeight,
	imageState,
	onImageRetry,
}: {
	item: Topic;
	onBlock: (id: string) => void;
	onDeepDive?: (topic: Topic, option: TopicDeepDiveOption) => void;
	deepDiveOptions?: TopicDeepDiveOption[];
	displayIndex?: number;
	cardHeight: number;
	imageState: TopicImageResourceState;
	onImageRetry?: (topic: Topic) => void;
}) => {
	const [isSaved, setIsSaved] = useState(false);
	const { lightImpact, errorNotification } = useHaptics();
	const { logFrontendEvent } = useLogger();

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

	const handleBlock = async () => {
		errorNotification();
		onBlock(item.categoryId);
	};

	// impression ログ送信済みフラグ（重複防止用）
	const impressionLoggedRef = useRef(false);

	// ログ追加【仕様】topic_impression ログ送信（カード表示時に1回のみ）
	useEffect(() => {
		if (!impressionLoggedRef.current) {
			impressionLoggedRef.current = true;
			logFrontendEvent({
				event_name: "topic_impression",
				error_level: "log",
				payload: {
					topic_id: item.categoryId,
					display_index: displayIndex ?? null,
				},
			});
		}
	}, [item.categoryId, displayIndex, logFrontendEvent]);

	return (
		<TopicVisualCard
			title={item.topicTitle}
			tagline={item.reason}
			imageSource={{ uri: item.imageUrl }}
			cardHeight={cardHeight}
			imageState={imageState}
			recyclingKey={item.categoryId}
			onImageRetry={onImageRetry ? () => onImageRetry(item) : undefined}
			bottomContent={
				deepDiveOptions.length > 0 ? (
					<View style={styles.deepDiveContainer}>
						<Text style={styles.deepDiveTitle}>--- {i18n.t("Topics.deepDive.title")} ---</Text>
						<View style={styles.deepDiveChips}>
							{deepDiveOptions.map((option) => (
								<TouchableOpacity
									key={option.key}
									style={styles.deepDiveChip}
									onPress={() => onDeepDive?.(item, option)}
									activeOpacity={0.8}>
									<Text style={styles.deepDiveChipText}>{option.label}</Text>
								</TouchableOpacity>
							))}
						</View>
					</View>
				) : undefined
			}
			topRightContent={
				<>
					<TouchableOpacity style={styles.topButton} onPress={handleSave}>
						<Bookmark size={20} color={isSaved ? "transparent" : "white"} fill={isSaved ? "orange" : "transparent"} />
					</TouchableOpacity>
					{/* <TouchableOpacity style={styles.topButton} onPress={handleHide}>
						<Trash size={18} color="#FFF" />
					</TouchableOpacity> */}
					<TouchableOpacity
						style={styles.topButton}
						onPress={handleBlock}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("Topics.BlockTopicModal.title")}>
						<Ban size={18} color="#FFF" />
					</TouchableOpacity>
				</>
			}
		/>
	);
};

const styles = StyleSheet.create({
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
		marginTop: 2,
		gap: 8,
	},
	deepDiveTitle: {
		color: "#FFFFFF",
		fontSize: 12,
		fontWeight: "700",
		textAlign: "center",
		textShadowColor: "rgba(0, 0, 0, 0.8)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 3,
	},
	deepDiveChips: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 8,
		justifyContent: "center",
	},
	deepDiveChip: {
		borderWidth: 1,
		borderColor: "rgba(255, 255, 255, 0.9)",
		backgroundColor: "rgba(255, 255, 255, 0.24)",
		paddingHorizontal: 12,
		paddingVertical: 7,
		borderRadius: 18,
	},
	deepDiveChipText: {
		color: "#FFFFFF",
		fontSize: 12,
		fontWeight: "700",
		textShadowColor: "rgba(0, 0, 0, 0.6)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
	},
});
