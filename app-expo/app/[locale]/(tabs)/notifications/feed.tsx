import React, { useCallback, useEffect } from "react";
import { useLocalSearchParams } from "expo-router";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { useDishMediaEntriesStore, selectEntriesByKey, DishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { ActivityIndicator, View, Text, StyleSheet } from "react-native";
import { shallow } from "zustand/shallow";
// import { mockDishItems } from "@/data/searchMockData";

export default function NotificationFeedScreen() {
	const { startIndex } = useLocalSearchParams<{ startIndex?: string }>();
	const initialIndex = startIndex ? parseInt(String(startIndex), 10) : 0;
	const selector = useCallback((state: DishMediaEntriesStore) => selectEntriesByKey("notification")(state), []);
	const { entries: items, isLoading, error } = useDishMediaEntriesStore(selector, shallow);

	if (isLoading) {
		return (
			<View style={styles.centerContainer}>
				<ActivityIndicator size="large" color="#5EA2FF" />
				<Text style={styles.loadingText}>Loading...</Text>
			</View>
		);
	}

	if (error) {
		return (
			<View style={styles.centerContainer}>
				<Text style={styles.errorText}>{error}</Text>
			</View>
		);
	}

	if (!items || items.length === 0) {
		return (
			<View style={styles.centerContainer}>
				<Text style={styles.emptyText}>No items available</Text>
			</View>
		);
	}

	return <DishMediaFeed items={items} initialIndex={isNaN(initialIndex) ? 0 : initialIndex} source="notification" />;
}

const styles = StyleSheet.create({
	centerContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "#000",
	},
	loadingText: {
		marginTop: 16,
		color: "#FFF",
		fontSize: 16,
	},
	errorText: {
		color: "#FF6B6B",
		fontSize: 16,
		textAlign: "center",
		paddingHorizontal: 20,
	},
	emptyText: {
		color: "#FFF",
		fontSize: 16,
		textAlign: "center",
	},
});
