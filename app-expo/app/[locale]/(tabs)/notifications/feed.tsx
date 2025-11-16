import React, { useState, useEffect, useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { ActivityIndicator, View, Text, StyleSheet } from "react-native";
import type { DishMediaEntry } from "@shared/api/v1/res";
// import { mockDishItems } from "@/data/searchMockData";

export default function NotificationFeedScreen() {
	const { startIndex } = useLocalSearchParams<{ startIndex?: string }>();
	const initialIndex = startIndex ? parseInt(String(startIndex), 10) : 0;
	const { dishPromisesMap, dishEntriesById } = useDishMediaEntriesStore();
	const [items, setItems] = useState<DishMediaEntry[] | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const loadData = async () => {
			setIsLoading(true);
			setError(null);
			try {
				const dishMediaEntries = await dishPromisesMap["notification"];
				setItems(dishMediaEntries);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to load data");
			} finally {
				setIsLoading(false);
			}
		};

		loadData();
	}, [dishPromisesMap]);

	// #433 【設計】表示用データはストアから取得（いいね/保存状態の即時反映）
	const displayItems = useMemo(() => {
		if (!items) return null;
		return items.map((item) => {
			const storeEntry = dishEntriesById[item.dish_media.id];
			// ストアに最新状態があればそれを使用、なければフェッチ結果を使用
			return storeEntry || item;
		});
	}, [items, dishEntriesById]);

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

	if (!displayItems || displayItems.length === 0) {
		return (
			<View style={styles.centerContainer}>
				<Text style={styles.emptyText}>No items available</Text>
			</View>
		);
	}

	return (
		<DishMediaFeed items={displayItems} initialIndex={isNaN(initialIndex) ? 0 : initialIndex} source="notification" />
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
