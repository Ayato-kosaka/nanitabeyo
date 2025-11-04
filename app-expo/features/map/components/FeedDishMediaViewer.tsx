import React, { useState, useEffect } from "react";
import FoodContentFeed from "@/components/FoodContentFeed";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { ActivityIndicator, View, Text, StyleSheet } from "react-native";
import type { DishMediaEntry } from "@shared/api/v1/res";
import { useSafeAreaFrame } from "react-native-safe-area-context";

type FeedDishMediaViewerProps = {
	initialIndex: number;
	source: string;
};

export function FeedDishMediaViewer({ initialIndex, source }: FeedDishMediaViewerProps) {
	const { dishPromisesMap } = useDishMediaEntriesStore();
	const [items, setItems] = useState<DishMediaEntry[] | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const frame = useSafeAreaFrame(); // Safe Area を除いたフレームの高さ

	useEffect(() => {
		const loadData = async () => {
			setIsLoading(true);
			setError(null);
			try {
				const dishMediaEntries = await dishPromisesMap[source];
				setItems(dishMediaEntries);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to load data");
			} finally {
				setIsLoading(false);
			}
		};

		loadData();
	}, [dishPromisesMap]);

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

	return (
		<View style={{ height: frame.height }}>
			<FoodContentFeed items={items} initialIndex={isNaN(initialIndex) ? 0 : initialIndex} source={source} />
		</View>
	);
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
