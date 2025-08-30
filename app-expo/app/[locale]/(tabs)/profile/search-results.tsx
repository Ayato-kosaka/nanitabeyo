import React, { useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { X } from "lucide-react-native";
import { useLocalSearchParams } from "expo-router";
import FoodContentMap from "@/components/FoodContentMap";
import { LinearGradient } from "expo-linear-gradient";
import { useSearchResult } from "@/features/search/hooks/useSearchResult";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";

export default function ProfileSearchResultScreen() {
	const { topicId } = useLocalSearchParams<{ topicId: string }>();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

	const { currentIndex, showCompletionModal, dishesPromise, handleIndexChange, handleClose, handleReturnToCards } =
		useSearchResult(topicId as string);

	useEffect(() => {
		// Log screen view with search parameters
		logFrontendEvent({
			event_name: "screen_view",
			error_level: "log",
			payload: {
				screen: "search_result",
				topicId,
				hasTopicId: !!topicId,
			},
		});
	}, [topicId, logFrontendEvent]);

	const handleCloseWithHaptic = () => {
		lightImpact();
		logFrontendEvent({
			event_name: "search_result_closed",
			error_level: "log",
			payload: { topicId, currentIndex },
		});
		handleClose();
	};

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			{/* Header with Back Button */}
			<View style={{ ...styles.closeButtonContainer, top: Platform.OS === "ios" ? 40 : 0 }}>
				<TouchableOpacity style={styles.closeButton} onPress={handleCloseWithHaptic}>
					<X size={24} color="#000" />
				</TouchableOpacity>
			</View>

			{/* Feed Content */}
			{/* <FoodContentFeed items={dishes} onIndexChange={handleIndexChange} /> */}
			<FoodContentMap itemsPromise={dishesPromise} onIndexChange={handleIndexChange} />
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	closeButtonContainer: {
		position: "absolute",
		right: 0,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		padding: 16,
		zIndex: 10,
	},
	closeButton: {
		padding: 8,
		borderRadius: 24,
		backgroundColor: "#FFFFFF",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 12,
		elevation: 6,
	},
});
