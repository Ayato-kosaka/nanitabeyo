import React, { useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { useDishMediaEntriesStore, selectEntriesByKey } from "@/stores/useDishMediaEntriesStore";
import { ActivityIndicator, View, Text, StyleSheet } from "react-native";
import { GroupName } from "@/features/profile/components/ProfileTabsBar";
import { DishMediaEntry } from "@shared/api/v1/res";
// import { mockDishItems } from "@/data/searchMockData";

export default function ProfileFoodScreen() {
	const { startIndex, tabName } = useLocalSearchParams<{ startIndex?: string; tabName?: GroupName }>();
	const initialIndex = startIndex ? parseInt(String(startIndex), 10) : 0;

	const { entries: items, isLoading, error } = useDishMediaEntriesStore(selectEntriesByKey(tabName || ""));

	const keyExtractor = useMemo(
		() => (tabName === "reviews" ? (item: DishMediaEntry) => String(item.dish_reviews[0]?.id) : undefined),
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
