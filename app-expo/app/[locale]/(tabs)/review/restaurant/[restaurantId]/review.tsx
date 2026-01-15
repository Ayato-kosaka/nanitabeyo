import React, { useEffect, useState } from "react";
import { View, StyleSheet, ActivityIndicator, Text } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ReviewForm } from "@/features/map/components/ReviewForm";
import { useRestaurantStore, type RestaurantEntry } from "@/features/review/stores/useRestaurantStore";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLogger } from "@/hooks/useLogger";
import type { GetRestaurantByIdResponse } from "@shared/api/v1/res";
import i18n from "@/lib/i18n";
import { ReviewHeader } from "@/features/review/components/ReviewHeader";

export default function ReviewScreen() {
	const { restaurantId } = useLocalSearchParams<{ restaurantId: string }>();
	const { lightImpact } = useHaptics();
	const { callBackend } = useAPICall();
	const { showSnackbar } = useSnackbar();
	const { logFrontendEvent } = useLogger();

	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [restaurant, setRestaurant] = useState<RestaurantEntry | undefined>(undefined);

	// #644 【設計】restaurant.id でレストラン詳細を取得（ストアキャッシュ優先）
	useEffect(() => {
		if (!restaurantId) return;

		// まずストアから取得し、あればそれを使う
		const { getById, upsert } = useRestaurantStore.getState();
		const cached = getById(restaurantId);
		if (cached) {
			setRestaurant(cached);
			return;
		}

		// キャッシュがない場合は最新情報を取得して更新
		const fetchRestaurant = async () => {
			setIsLoading(true);

			try {
				const response = await callBackend<Record<string, never>, GetRestaurantByIdResponse>(
					`v1/restaurants/${restaurantId}`,
					{
						method: "GET",
						requestPayload: {},
					},
				);

				const entry: RestaurantEntry = {
					restaurant: response.restaurant,
					meta: response.meta,
				};

				// ストアに保存
				upsert(entry);
				setRestaurant(entry);
				setError(null);

				logFrontendEvent({
					event_name: "review_screen_restaurant_loaded",
					error_level: "log",
					payload: { restaurantId, fromCache: !!cached },
				});
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Failed to load restaurant";
				setError(errorMessage);
				showSnackbar(i18n.t("Common.errors.unexpected"));

				logFrontendEvent({
					event_name: "review_screen_load_error",
					error_level: "error",
					payload: { restaurantId, error: errorMessage },
				});
			} finally {
				setIsLoading(false);
			}
		};

		fetchRestaurant();
	}, [restaurantId, callBackend, showSnackbar, logFrontendEvent]);

	// #644 【設計】ローディング表示（キャッシュがない場合のみ）
	if (isLoading && !restaurant) {
		return (
			<SafeAreaView edges={["top"]} style={styles.container}>
				<ReviewHeader
					title={i18n.t("Review.title")}
					onPressBack={() => {
						lightImpact();
						router.back();
					}}
				/>
				<View style={styles.loadingContainer}>
					<ActivityIndicator size="large" color="#5EA2FF" />
				</View>
			</SafeAreaView>
		);
	}

	// #644 【設計】エラー表示（レストランが見つからない場合など）
	if (error && !restaurant) {
		return (
			<SafeAreaView edges={["top"]} style={styles.container}>
				<ReviewHeader
					title={i18n.t("Review.title")}
					onPressBack={() => {
						lightImpact();
						router.back();
					}}
				/>
				<View style={styles.errorContainer}>
					<Text style={styles.errorText}>{i18n.t("Common.errors.notFound")}</Text>
				</View>
			</SafeAreaView>
		);
	}

	if (!restaurant) {
		return null;
	}

	return (
		<SafeAreaView edges={["top", "bottom"]} style={styles.container}>
			<ReviewHeader
				title={i18n.t("Review.title")}
				onPressBack={() => {
					lightImpact();
					router.back();
				}}
			/>

			{/* #644 【設計】ReviewForm をメディア選択ありモードで表示 */}
			<ReviewForm restaurant={restaurant.restaurant} onCancel={() => router.back()} />
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#FFFFFF",
	},
	loadingContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	errorContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		padding: 16,
	},
	errorText: {
		fontSize: 16,
		color: "#666",
		textAlign: "center",
	},
});
