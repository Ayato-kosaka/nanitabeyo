import React from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, SafeAreaView } from "react-native";
import { X, RotateCcw, Search } from "lucide-react-native";
import { useLocalSearchParams } from "expo-router";
import FoodContentFeed from "@/components/FoodContentFeed";
import FoodContentMap from "@/components/FoodContentMap";
import { LinearGradient } from "expo-linear-gradient";
import { useSearchResult } from "@/features/search/hooks/useSearchResult";

export default function ResultScreen() {
        const { topicId } = useLocalSearchParams<{ topicId: string }>();

        const {
                currentIndex,
                showCompletionModal,
                dishes,
                handleIndexChange,
                handleClose,
                handleReturnToCards,
        } = useSearchResult(topicId as string);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			{/* Header with Back Button */}
			<View style={styles.closeButtonContainer}>
				<TouchableOpacity style={styles.closeButton} onPress={handleClose}>
					<X size={24} color="#000" />
				</TouchableOpacity>
			</View>

			{/* Feed Content */}
			{/* <FoodContentFeed items={dishes} onIndexChange={handleIndexChange} /> */}
			<FoodContentMap items={dishes} onIndexChange={handleIndexChange} />
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
