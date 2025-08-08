import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { X } from "lucide-react-native";
import { useLocalSearchParams } from "expo-router";
import FoodContentMap from "@/components/FoodContentMap";
import { LinearGradient } from "expo-linear-gradient";
import { useSearchResult } from "@/features/search/hooks/useSearchResult";
import { useHaptics } from "@/hooks/useHaptics";

export default function ResultScreen() {
	const { topicId } = useLocalSearchParams<{ topicId: string }>();
	const { lightImpact } = useHaptics();

	const { currentIndex, showCompletionModal, dishesPromise, handleIndexChange, handleClose, handleReturnToCards } =
		useSearchResult(topicId as string);

	const handleCloseWithHaptic = () => {
		lightImpact();
		handleClose();
	};

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			{/* Header with Back Button */}
			<View style={styles.closeButtonContainer}>
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
		top: 0,
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
