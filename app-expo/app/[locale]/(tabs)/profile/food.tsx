import React, { useState, useEffect } from "react";
import { useLocalSearchParams } from "expo-router";
import FoodContentFeed from "@/components/FoodContentFeed";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { ActivityIndicator, View, Text, StyleSheet } from "react-native";
import type { DishMediaEntry } from "@shared/api/v1/res";
// import { mockDishItems } from "@/data/searchMockData";

export default function ProfileFoodScreen() {
	const { startIndex, tabName } = useLocalSearchParams<{ startIndex?: string; tabName?: string }>();
	const initialIndex = startIndex ? parseInt(String(startIndex), 10) : 0;
	const { dishPromisesMap } = useDishMediaEntriesStore();
	const [items, setItems] = useState<DishMediaEntry[] | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const loadData = async () => {
			try {
				setIsLoading(true);
				setError(null);

				if (tabName && tabName in dishPromisesMap) {
					const dishMediaEntries = await dishPromisesMap[tabName];
					setItems(dishMediaEntries);
				} else {
					// Fallback: use mock data if no data in store
					// setItems(mockDishItems);
					setItems([]);
					setError("No data available for this tab");
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to load data");
			} finally {
				setIsLoading(false);
			}
		};

		loadData();
	}, [tabName, dishPromisesMap]);

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

	return <FoodContentFeed items={items} initialIndex={isNaN(initialIndex) ? 0 : initialIndex} />;
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
