import React, { useState } from "react";
import { View, Text, Image, TouchableOpacity, StyleSheet } from "react-native";
import { Trash, Bookmark } from "lucide-react-native";
import { Topic } from "@/types/search";
import { CARD_WIDTH, CARD_HEIGHT } from "@/features/topics/constants";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { toggleReaction } from "@/lib/reactions";

// Display a single topic card inside the carousel
export const TopicCard = ({ item, onHide }: { item: Topic; onHide: (id: string) => void }) => {
	const [isSaved, setIsSaved] = useState(false);
	const { lightImpact, errorNotification } = useHaptics();
	const { logFrontendEvent } = useLogger();

	const handleSave = async () => {
		const willSave = !isSaved;
		lightImpact();
		setIsSaved(willSave);

		try {
			await toggleReaction({
				target_type: "dish_categories",
				target_id: item.categoryId,
				action_type: "save",
				willReact: willSave,
			});
		} catch (error) {
			// Revert state on error
			setIsSaved(!willSave);
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

	const handleHide = async () => {
		errorNotification();
		onHide(item.categoryId);

		try {
			await toggleReaction({
				target_type: "dish_categories",
				target_id: item.categoryId,
				action_type: "hide",
				willReact: true,
			});
		} catch (error) {
			logFrontendEvent({
				event_name: "topic_hide_reaction_failed",
				error_level: "log",
				payload: {
					error: error instanceof Error ? error.message : String(error),
					target_id: item.categoryId,
					action_type: "hide",
				},
			});
		}
	};

	return (
		<View style={styles.card}>
			<Image source={{ uri: item.imageUrl }} style={styles.cardImage} />

			{/* Content Overlay */}
			<View style={styles.cardOverlay}>
				{/* Top Buttons */}
				<View style={styles.topButtons}>
					<TouchableOpacity style={styles.topButton} onPress={handleSave}>
						<Bookmark size={20} color={isSaved ? "transparent" : "white"} fill={isSaved ? "orange" : "transparent"} />
					</TouchableOpacity>
					<TouchableOpacity style={styles.topButton} onPress={handleHide}>
						<Trash size={18} color="#FFF" />
					</TouchableOpacity>
				</View>

				{/* Content */}
				<View style={styles.cardContent}>
					<Text style={styles.cardTitle}>{item.topicTitle}</Text>
					<Text style={styles.cardDescription}>{item.reason}</Text>
				</View>
			</View>
		</View>
	);
};

const styles = StyleSheet.create({
	card: {
		width: CARD_WIDTH,
		height: CARD_HEIGHT,
		borderRadius: 24,
		overflow: "hidden",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 32,
		elevation: 12,
		position: "relative",
	},
	cardImage: {
		width: "100%",
		height: "100%",
		resizeMode: "cover",
	},
	cardOverlay: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		backgroundColor: "rgba(0, 0, 0, 0.1)",
		padding: 24,
		justifyContent: "space-between",
	},
	topButtons: {
		alignSelf: "flex-end",
		gap: 12,
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
	cardContent: {
		flex: 1,
		justifyContent: "flex-end",
	},
	cardTitle: {
		fontSize: 32,
		fontWeight: "700",
		color: "#FFFFFF",
		marginBottom: 16,
		textShadowColor: "rgba(0, 0, 0, 0.8)",
		textShadowOffset: { width: 0, height: 2 },
		textShadowRadius: 4,
		lineHeight: 40,
		letterSpacing: -0.5,
	},
	cardDescription: {
		fontSize: 18,
		color: "#FFFFFF",
		lineHeight: 28,
		marginBottom: 16,
		textShadowColor: "rgba(0, 0, 0, 0.8)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 3,
		fontWeight: "500",
	},
});
