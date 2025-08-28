import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowLeft } from "lucide-react-native";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import FoodContentFeed from "@/components/FoodContentFeed";
import i18n from "@/lib/i18n";
import type { DishMediaEntry } from "@shared/api/v1/res";

export default function ProfileSearchResultScreen() {
	const { locale, topicId } = useLocalSearchParams<{
		locale: string;
		topicId: string;
	}>();

	const [dishes, setDishes] = useState<DishMediaEntry[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const dishPromisesMap = useDishMediaEntriesStore((state) => state.dishPromisesMap);

	useEffect(() => {
		const loadDishes = async () => {
			if (!topicId || !dishPromisesMap[topicId]) {
				setError("No data available");
				setIsLoading(false);
				return;
			}

			try {
				const dishItems = await dishPromisesMap[topicId];
				setDishes(dishItems);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to load dishes");
			} finally {
				setIsLoading(false);
			}
		};

		loadDishes();
	}, [topicId, dishPromisesMap]);

	const handleBack = () => {
		router.back();
	};

	if (isLoading) {
		return (
			<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
				<View style={styles.loadingContainer}>
					<Text style={styles.loadingText}>{i18n.t("Profile.loading")}</Text>
				</View>
			</LinearGradient>
		);
	}

	if (error) {
		return (
			<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
				<View style={styles.errorContainer}>
					<Text style={styles.errorText}>{error}</Text>
				</View>
			</LinearGradient>
		);
	}

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<FoodContentFeed items={dishes} />
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	loadingContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	loadingText: {
		fontSize: 16,
		color: "#666",
	},
	errorContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 32,
	},
	errorText: {
		fontSize: 16,
		color: "#666",
		textAlign: "center",
	},
});
