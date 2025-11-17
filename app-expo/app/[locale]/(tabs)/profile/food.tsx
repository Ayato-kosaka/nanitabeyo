import React, { useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { useDishMediaEntriesStore, selectEntriesByKey, selectMyReviewEntriesByKey } from "@/stores/useDishMediaEntriesStore";
import { ActivityIndicator, View, Text, StyleSheet } from "react-native";
import { GroupName } from "@/features/profile/components/ProfileTabsBar";
// import { mockDishItems } from "@/data/searchMockData";

export default function ProfileFoodScreen() {
	const { startIndex, tabName } = useLocalSearchParams<{ startIndex?: string; tabName?: GroupName }>();
	const initialIndex = startIndex ? parseInt(String(startIndex), 10) : 0;
	
	// #443 【設計】新 Store API を使用（reviews の場合は専用 selector を使用）
	const entriesData = useDishMediaEntriesStore(
		tabName === "reviews" ? selectMyReviewEntriesByKey("reviews") : selectEntriesByKey(tabName || "")
	);
	const { entries: items, isLoading, error } = entriesData;

	const keyExtractor = useMemo(
		() => (tabName === "reviews" ? (item: any) => String(item.myReview?.id || item.dish_reviews?.[0]?.id) : undefined),
		[tabName],
	);

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
				<Text style={styles.errorText}>{error.message}</Text>
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
		<DishMediaFeed
			items={items}
			initialIndex={isNaN(initialIndex) ? 0 : initialIndex}
			source={`profile-${tabName}`}
			keyExtractor={keyExtractor}
		/>
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
