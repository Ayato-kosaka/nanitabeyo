import React, { useState, useRef, useEffect } from "react";
import { TouchableOpacity, StyleSheet } from "react-native";
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

export const TopicCard = ({
	item,
	onBlock,
	displayIndex,
	cardHeight,
	imageState,
	onImageRetry,
}: {
	item: Topic;
	onBlock: (id: string) => void;
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
});
